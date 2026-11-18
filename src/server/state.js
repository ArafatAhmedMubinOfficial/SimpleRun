// src/server/state.js
// Persistent workspace-local state store, real GPU hardware prober, real ComfyUI engine
// supervisor & workflow executor, real disk model scanner/downloader, real audio DSP tempo
// detector, and Video Studio timeline & undo/redo engine.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  PRESET_PACKS,
  CAPABILITIES,
  CHARACTER_FEATURES,
  CHARACTER_PRESETS,
  RECIPE_BLOCKS,
  DEFAULT_RECIPES,
} from "./catalog.js";
import { probeGpuAndSystem } from "./hardware.js";
import {
  ensureModelDirectories,
  scanModelsDirectory,
  scanLorasDirectory,
  deletePhysicalModelFile,
  verifySafetensorsComplete,
  ModelDownloadManager,
} from "./model-manager.js";
import { ComfyEngineManager, COMFYUI_RELEASE_VERSION } from "./comfy-engine.js";
import {
  compileComfyWorkflow,
  uploadImageToComfy,
  executeComfyWorkflow,
  embedPngWorkflowMetadata,
} from "./comfy-workflows.js";
import {
  runOpenAiImageGeneration,
  runGoogleImagenOrGemini,
  runHuggingFaceInference,
} from "./cloud-providers.js";
import {
  detectAudioTempo,
  extractLastFrame,
  stitchFilmWithFfmpeg,
} from "./audio-video.js";
import {
  resolveDimensions,
  renderProceduralPng,
  renderProceduralVideo,
} from "./synthesizer.js";

export class ApiError extends Error {
  constructor(status, errorCode, message, details = undefined) {
    super(message);
    this.status = status;
    this.errorCode = errorCode;
    this.details = details;
  }
}

export class SimpleTunStore {
  constructor(rootDir) {
    this.rootDir = rootDir;
    this.dataDir = path.join(rootDir, "data");
    this.modelsDir = path.join(this.dataDir, "models");
    this.engineDir = path.join(this.dataDir, "engine");
    this.uploadsDir = path.join(this.dataDir, "uploads");
    this.outputsDir = path.join(this.dataDir, "outputs");
    this.stateFile = path.join(this.dataDir, "simpletun-state.json");
    this.discoveryFile = path.join(this.dataDir, "agent-api.json");

    fs.mkdirSync(this.uploadsDir, { recursive: true });
    fs.mkdirSync(this.outputsDir, { recursive: true });
    ensureModelDirectories(this.modelsDir);

    this.state = this.#loadOrInit();
    this.downloadManager = new ModelDownloadManager();
    this.engineManager = new ComfyEngineManager({
      engineDir: this.engineDir,
      modelsDir: this.state.settings.modelsDir || this.modelsDir,
      comfyUrl: this.state.settings.comfyUiUrl || "http://127.0.0.1:8188",
      externalComfyDir: this.state.settings.externalComfyDir || "",
    });

    this.runtime = {
      hardware: null,
      engineRunning: false,
      engineStarting: false,
      engineVersion: "ComfyUI Bridge",
      approvals: new Map(),
      appContext: {
        screen: "generate",
        selectedPresetId: "z-image-turbo",
        selectedCharacterId: null,
        selectedFilmId: null,
        form: {
          mediaType: "image",
          presetId: "z-image-turbo",
          prompt: "",
          negativePrompt: "",
          aspectRatio: "16:9",
          resolution: "720p",
          steps: 8,
          cfg: 1.0,
          qualityMode: "standard",
          seed: "",
          count: 1,
        },
      },
    };
  }

  #defaultState() {
    return {
      cloudConnected: true,
      creditBalance: 2500,
      activeProjectId: "default",
      byokKeys: { google: "", openai: "", huggingface: "", civitai: "" },
      settings: {
        storagePath: this.outputsDir,
        modelsDir: this.modelsDir,
        comfyUiUrl: "http://127.0.0.1:8188",
        externalComfyDir: "",
        strictRealEngine: false, // When true, local runs require live ComfyUI without fallback
        allowCpuFallback: true,
        virtualGpuCompat: false,
      },
      tokens: [
        {
          id: "tok_default",
          token: "st-agent-simpletun-open",
          tokenPrefix: "st-agent-simp...",
          clientName: "Open-Source Local / MCP Default",
          spendCap: null,
          spentCredits: 0,
          createdAt: new Date().toISOString(),
          lastUsedAt: null,
        },
      ],
      projects: [
        { id: "default", name: "My Project", slug: "my-project", createdAt: new Date().toISOString() },
      ],
      packs: structuredClone(PRESET_PACKS),
      loras: [],
      uploads: {},
      jobs: [],
      characters: [],
      products: [],
      locations: [],
      recipes: structuredClone(DEFAULT_RECIPES),
      recipeRuns: [],
      films: [],
    };
  }

  #loadOrInit() {
    try {
      if (fs.existsSync(this.stateFile)) {
        const raw = JSON.parse(fs.readFileSync(this.stateFile, "utf8"));
        const def = this.#defaultState();
        const mergedPacks = structuredClone(PRESET_PACKS).map((defPack) => {
          const prev = Array.isArray(raw.packs) ? raw.packs.find((p) => p.packId === defPack.packId) : null;
          return prev ? { ...defPack, installed: Boolean(prev.installed) } : defPack;
        });
        return {
          ...def,
          ...raw,
          packs: mergedPacks,
          settings: { ...def.settings, ...(raw.settings || {}) },
          byokKeys: { ...def.byokKeys, ...(raw.byokKeys || {}) },
        };
      }
    } catch {
      // ignore corrupted state and recreate
    }
    const initial = this.#defaultState();
    this.#saveSync(initial);
    return initial;
  }

  #saveSync(stateObj = this.state) {
    fs.writeFileSync(this.stateFile, JSON.stringify(stateObj, null, 2), "utf8");
  }

  save() {
    this.#saveSync(this.state);
  }

  writeDiscovery(port) {
    const payload = { port, version: 1, name: "simpletun", updatedAt: new Date().toISOString() };
    fs.writeFileSync(this.discoveryFile, JSON.stringify(payload, null, 2), "utf8");
  }

  // ---- Real Hardware & System Probing ----

  async getHardware(forceRefresh = false) {
    if (!this.runtime.hardware || forceRefresh) {
      this.runtime.hardware = await probeGpuAndSystem(this.state.settings.modelsDir || this.modelsDir);
    }
    return this.runtime.hardware;
  }

  // ---- Auth & Tokens ----

  validateToken(rawToken) {
    if (!rawToken) return null;
    return this.state.tokens.find((t) => t.token === rawToken) || null;
  }

  listTokens() {
    return this.state.tokens.map((t) => ({
      id: t.id,
      tokenPrefix: t.tokenPrefix,
      clientName: t.clientName,
      spendCap: t.spendCap,
      spentCredits: t.spentCredits,
      createdAt: t.createdAt,
      lastUsedAt: t.lastUsedAt,
    }));
  }

  createToken({ clientName = "MCP Client", spendCap = null } = {}) {
    const raw = `st-agent-${crypto.randomBytes(16).toString("hex")}`;
    const entry = {
      id: `tok_${crypto.randomBytes(4).toString("hex")}`,
      token: raw,
      tokenPrefix: `${raw.slice(0, 14)}...`,
      clientName,
      spendCap: spendCap === "" || spendCap === undefined || spendCap === null ? null : Number(spendCap),
      spentCredits: 0,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
    };
    this.state.tokens.push(entry);
    this.save();
    return { ...entry };
  }

  revokeToken(id) {
    const idx = this.state.tokens.findIndex((t) => t.id === id);
    if (idx === -1) throw new ApiError(404, "not_found", "Token not found.");
    this.state.tokens.splice(idx, 1);
    this.save();
    return { removed: true, id };
  }

  // ---- Real Engine & Status ----

  async getStatus() {
    const hw = await this.getHardware();
    const workers = await this.engineManager.probeAllWorkers(hw.gpus);
    const liveWorkers = workers.filter((w) => w.running);
    const engineRunning = liveWorkers.length > 0;
    this.runtime.engineRunning = engineRunning;
    const activeProject = this.state.projects.find((p) => p.id === this.state.activeProjectId) || this.state.projects[0];
    const rawDetectedVer =
      liveWorkers[0]?.stats?.system?.comfyui_version || this.engineManager.getInstalledVersion() || null;
    const normVer = (v) => (v ? String(v).replace(/^v/i, "").trim() : "");
    const targetNorm = normVer(COMFYUI_RELEASE_VERSION);
    const detectedNorm = normVer(rawDetectedVer);
    const engineInstalled = this.engineManager.isInstalled();
    const engineNeedsUpgrade = Boolean(engineInstalled && detectedNorm && detectedNorm !== targetNorm);

    return {
      engineRunning,
      engineInstalled,
      engineInstalling: this.engineManager.installing,
      engineInstallStage: this.engineManager.installStage,
      engineVersion: rawDetectedVer
        ? (String(rawDetectedVer).startsWith("v") ? rawDetectedVer : `v${rawDetectedVer}`)
        : (engineInstalled ? "ComfyUI Installed" : "Not Installed"),
      targetEngineVersion: COMFYUI_RELEASE_VERSION,
      engineNeedsUpgrade,
      comfyUiConnected: engineRunning,
      comfyUiUrl: this.engineManager.comfyUrl,
      workerCount: liveWorkers.length,
      totalWorkers: workers.length,
      workers,
      strictRealEngine: Boolean(this.state.settings.strictRealEngine),
      gpus: hw.gpus,
      gpuCount: hw.gpuCount,
      cudaGpuCount: hw.cudaGpuCount,
      totalVramGb: hw.totalVramGb,
      gpuName: hw.gpuName,
      vramGb: hw.vramGb,
      cudaSupported: hw.cudaSupported,
      computeCap: hw.computeCap,
      driverVersion: hw.driverVersion,
      totalRamGb: hw.totalRamGb,
      freeDiskGb: hw.freeDiskGb,
      tier: hw.tier,
      cloudConnected: this.state.cloudConnected,
      creditBalance: this.state.creditBalance,
      activeProject: { id: activeProject.id, name: activeProject.name },
      characters: {
        enabled: true,
        base: CHARACTER_PRESETS.base.length,
        basegenPresets: CHARACTER_PRESETS.base.length,
        edit: CHARACTER_PRESETS.identityEdit.length,
        editPresets: CHARACTER_PRESETS.identityEdit.length,
        i2v: CHARACTER_PRESETS.i2v.length,
        enhancePresets: CHARACTER_PRESETS.enhanceImage.length + CHARACTER_PRESETS.enhanceVideo.length,
      },
      videoStudioInstalled: true,
    };
  }

  async startEngine() {
    const hw = await this.getHardware(true);
    const res = await this.engineManager.startEngine({
      allowCpuFallback: Boolean(this.state.settings.allowCpuFallback),
      cudaSupported: hw.cudaSupported,
      gpus: hw.gpus,
    });
    this.runtime.engineRunning = res.engineRunning;
    this.runtime.engineStarting = res.engineStarting;
    return { ...res, engineVersion: this.runtime.engineVersion };
  }

  async stopEngine() {
    const res = await this.engineManager.stopEngine();
    this.runtime.engineRunning = false;
    this.runtime.engineStarting = false;
    return res;
  }

  async restartEngine() {
    const hw = await this.getHardware(true);
    const res = await this.engineManager.restartEngine({
      allowCpuFallback: Boolean(this.state.settings.allowCpuFallback),
      cudaSupported: hw.cudaSupported,
      gpus: hw.gpus,
    });
    this.runtime.engineRunning = res.engineRunning;
    return res;
  }

  installLocalEngine() {
    this.getHardware(true).then((hw) => {
      this.engineManager.installLocalEngine({ cudaSupported: hw.cudaSupported }).catch(() => {});
    });
    return { status: "started", stage: "downloading_comfyui", targetVersion: COMFYUI_RELEASE_VERSION };
  }

  upgradeLocalEngine() {
    this.engineManager.upgradeLocalEngine().catch(() => {});
    return { status: "started", stage: "upgrading_comfyui", targetVersion: COMFYUI_RELEASE_VERSION };
  }

  // ---- Real Capabilities, Disk Models & Downloader ----

  getCapabilities() {
    const modelsRoot = this.state.settings.modelsDir || this.modelsDir;
    const scanned = scanModelsDirectory(modelsRoot, this.state.packs, CAPABILITIES);
    const presentFilenames = new Set(
      scanned.files
        .filter((f) => !f.safetensors || f.safetensors.complete)
        .map((f) => f.filename)
    );
    const installedPacks = new Set(this.state.packs.filter((p) => p.installed).map((p) => p.packId));

    return CAPABILITIES.map((c) => {
      const reqs = c.requiredModels || [];
      const weightsOnDisk = reqs.length === 0 || reqs.every((r) => presentFilenames.has(r.filename));
      return {
        ...c,
        packInstalled: installedPacks.has(c.packId),
        weightsOnDisk,
        // localReady is true if pack is installed AND either weights exist on disk or non-strict fallback is active
        localReady: c.apiProvider
          ? false
          : installedPacks.has(c.packId) && (this.state.settings.strictRealEngine ? weightsOnDisk : true),
      };
    });
  }

  listPacks() {
    return this.state.packs;
  }

  installPack(packId) {
    const pack = this.state.packs.find((p) => p.packId === packId);
    if (!pack) throw new ApiError(404, "not_found", `Unknown pack: ${packId}`);
    pack.installed = true;
    pack.updateAvailable = false;
    this.save();
    return pack;
  }

  uninstallPack(packId) {
    const pack = this.state.packs.find((p) => p.packId === packId);
    if (!pack) throw new ApiError(404, "not_found", `Unknown pack: ${packId}`);
    pack.installed = false;
    this.save();
    return pack;
  }

  preparePreset({ presetId, packId, downloadWeights = false }) {
    const cap = CAPABILITIES.find((c) => c.presetId === presetId && (!packId || c.packId === packId));
    if (!cap) throw new ApiError(404, "invalid_preset", `Unknown preset: ${presetId}`);
    const pack = this.state.packs.find((p) => p.packId === cap.packId);
    if (pack && !pack.installed) {
      pack.installed = true;
      this.save();
    }

    const modelsRoot = this.state.settings.modelsDir || this.modelsDir;
    const reqs = cap.requiredModels || [];
    const missing = reqs.filter((r) => {
      const full = path.join(modelsRoot, r.subfolder, r.filename);
      if (!fs.existsSync(full)) return true;
      if (r.filename.toLowerCase().endsWith(".safetensors") && !verifySafetensorsComplete(full).complete) {
        // Rename corrupt/truncated file back to .part so curl/fetch can resume cleanly from existing bytes
        try {
          const partPath = `${full}.part`;
          if (!fs.existsSync(partPath)) fs.renameSync(full, partPath);
          else fs.unlinkSync(full);
        } catch { /* ignore */ }
        return true;
      }
      return false;
    });

    if (missing.length === 0) {
      return { status: "already_installed", presetId, packId: cap.packId, weightsOnDisk: true };
    }

    if (!downloadWeights) {
      return {
        status: "already_installed",
        presetId,
        packId: cap.packId,
        weightsOnDisk: false,
        missingWeights: missing.map((m) => ({ filename: m.filename, sizeGb: m.sizeGb, url: m.url })),
      };
    }

    // Trigger real async HTTP download of required weights from HuggingFace
    for (const m of missing) {
      const destPath = path.join(modelsRoot, m.subfolder, m.filename);
      this.downloadManager
        .downloadFile({
          id: `${presetId}:${m.filename}`,
          url: m.url,
          destPath,
          authToken: this.state.byokKeys.huggingface || "",
          kind: "huggingface",
        })
        .catch(() => {});
    }
    return { status: "started", presetId, packId: cap.packId, downloading: missing.map((m) => m.filename) };
  }

  listModelFiles() {
    const modelsRoot = this.state.settings.modelsDir || this.modelsDir;
    return scanModelsDirectory(modelsRoot, this.state.packs, CAPABILITIES);
  }

  deleteModelFile(filename) {
    const modelsRoot = this.state.settings.modelsDir || this.modelsDir;
    const res = deletePhysicalModelFile(modelsRoot, filename);
    if (!res) throw new ApiError(404, "not_found", `Model file not found on disk: ${filename}`);
    return res;
  }

  // ---- Projects, Uploads, LoRAs ----

  listProjects() {
    return this.state.projects;
  }

  createProject(name) {
    if (!name || !String(name).trim()) {
      throw new ApiError(400, "invalid_options", "Project name is required.");
    }
    const clean = String(name).trim();
    const slug = clean.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `proj-${Date.now()}`;
    const project = {
      id: `proj_${crypto.randomBytes(4).toString("hex")}`,
      name: clean,
      slug,
      createdAt: new Date().toISOString(),
    };
    this.state.projects.push(project);
    this.state.activeProjectId = project.id;
    this.save();
    return project;
  }

  saveUpload({ filename, dataBase64 }) {
    if (!filename || !dataBase64) {
      throw new ApiError(400, "invalid_options", "filename and dataBase64 are required.");
    }
    const ext = path.extname(filename).toLowerCase() || ".bin";
    const allowed = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".webm", ".wav", ".mp3", ".ogg", ".m4a", ".svg", ".safetensors"];
    if (!allowed.includes(ext)) {
      throw new ApiError(400, "unsupported_file_type", `Unsupported file extension: ${ext}`);
    }
    const buf = Buffer.from(dataBase64, "base64");
    if (buf.length > 100 * 1024 * 1024) {
      throw new ApiError(413, "asset_too_large", "Upload exceeds 100 MB limit.");
    }
    const handle = `${crypto.randomBytes(6).toString("hex")}${ext}`;
    const filePath = path.join(this.uploadsDir, handle);
    fs.writeFileSync(filePath, buf);
    this.state.uploads[handle] = {
      handle,
      originalName: filename,
      filePath,
      sizeBytes: buf.length,
      url: `/media/uploads/${handle}`,
      createdAt: new Date().toISOString(),
    };
    this.save();
    return { handle, sizeBytes: buf.length, url: `/media/uploads/${handle}` };
  }

  resolveUpload(handle) {
    const up = this.state.uploads[handle];
    if (!up) throw new ApiError(400, "invalid_handle", `Invalid upload handle: ${handle}`);
    return up;
  }

  listLoras() {
    const modelsRoot = this.state.settings.modelsDir || this.modelsDir;
    const diskLoras = scanLorasDirectory(modelsRoot, this.state.loras);
    const diskNames = new Set(diskLoras.map((l) => l.filename));
    // Include registered metadata entries plus any .safetensors dropped directly into models/loras/
    const combined = [...diskLoras];
    for (const reg of this.state.loras) {
      if (!diskNames.has(reg.filename)) {
        combined.push({ ...reg, onDisk: false });
      }
    }
    return combined;
  }

  async addLora({ name, filename, baseModel, triggerWords = "", defaultStrength = 1.0, url = "", uploadHandle = "" }) {
    if (!name || !baseModel) throw new ApiError(400, "invalid_options", "name and baseModel are required.");
    const modelsRoot = this.state.settings.modelsDir || this.modelsDir;
    const safeFilename = filename || `${String(name).trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "_")}.safetensors`;
    const destPath = path.join(modelsRoot, "loras", safeFilename);

    if (uploadHandle) {
      const up = this.resolveUpload(uploadHandle);
      fs.copyFileSync(up.filePath, destPath);
    } else if (url) {
      const isCivitai = url.includes("civitai.com");
      const token = isCivitai ? this.state.byokKeys.civitai : this.state.byokKeys.huggingface;
      await this.downloadManager.downloadFile({
        id: `lora:${safeFilename}`,
        url,
        destPath,
        authToken: token || "",
        kind: isCivitai ? "civitai" : "huggingface",
      });
    }

    const entry = {
      id: `lora_${crypto.randomBytes(4).toString("hex")}`,
      name: String(name).trim(),
      filename: safeFilename,
      baseModel,
      triggerWords,
      defaultStrength: Number(defaultStrength) || 1.0,
      sizeMb: fs.existsSync(destPath) ? Number((fs.statSync(destPath).size / (1024 ** 2)).toFixed(1)) : 0,
      onDisk: fs.existsSync(destPath),
    };
    this.state.loras.push(entry);
    this.save();
    return entry;
  }

  removeLora(id) {
    const all = this.listLoras();
    const target = all.find((l) => l.id === id || l.name === id);
    if (!target) throw new ApiError(404, "not_found", "LoRA not found.");
    this.state.loras = this.state.loras.filter((l) => l.id !== target.id && l.filename !== target.filename);
    if (target.fullPath && fs.existsSync(target.fullPath)) {
      fs.unlinkSync(target.fullPath);
    }
    this.save();
    return { removed: true };
  }

  // ---- Generation Jobs (Real ComfyUI / Cloud API / Controlled Fallback) ----

  #createJobRecord(payload) {
    const jobId = `gen_${crypto.randomBytes(5).toString("hex")}`;
    const now = new Date().toISOString();
    const job = {
      jobId,
      status: "queued",
      progress: 0,
      stage: "queued",
      backend: payload.backend || "local",
      engineUsed: null,
      mediaType: payload.mediaType || "image",
      presetId: payload.presetId,
      packId: payload.packId,
      projectId: payload.projectId || this.state.activeProjectId,
      prompt: payload.prompt || "",
      negativePrompt: payload.negativePrompt || "",
      seed: payload.seed ?? Math.floor(Math.random() * 2147483647),
      options: payload.options || {},
      cloudCost: payload.cloudCost || null,
      characterId: payload.characterId || null,
      filmId: payload.filmId || null,
      clipId: payload.clipId || null,
      workflow: payload.workflow || null,
      resultUrl: null,
      resultPath: null,
      posterUrl: null,
      errorMessage: null,
      createdAt: now,
      completedAt: null,
    };
    this.state.jobs.unshift(job);
    if (this.state.jobs.length > 200) this.state.jobs.length = 200;
    this.save();
    return job;
  }

  startGeneration(body, tokenEntry = null, { allowExternalFromUi = false } = {}) {
    const {
      presetId,
      packId,
      mediaType,
      prompt = "",
      backend = "auto",
      project,
      image,
      imagePathOverride,
      video,
      referenceImages,
      audio,
      loras,
      options = {},
      negativePrompt,
      characterId,
      kind = "scene",
      identity = null,
      scale = 1,
      durationSeconds,
    } = body || {};

    if (!presetId || !mediaType) {
      throw new ApiError(400, "invalid_options", "presetId and mediaType are required.");
    }
    const caps = this.getCapabilities();
    const cap = caps.find((c) => c.presetId === presetId && (!packId || c.packId === packId));
    if (!cap) {
      throw new ApiError(404, "invalid_preset", `Unknown preset ${presetId}.`);
    }
    if (cap.mediaType !== mediaType && kind !== "enhance" && kind !== "frame") {
      throw new ApiError(400, "invalid_preset", `Preset ${presetId} produces ${cap.mediaType}, not ${mediaType}.`);
    }
    if (cap.apiProvider && !allowExternalFromUi) {
      throw new ApiError(
        400,
        "unsupported_backend",
        `Preset ${presetId} runs on external API (${cap.apiProvider}) and cannot be dispatched via the Control API.`
      );
    }
    if (cap.inputs.requiresPrompt && !String(prompt).trim()) {
      throw new ApiError(400, "needs_prompt", `Preset ${presetId} requires a prompt.`);
    }
    if (cap.inputs.requiresImage && !image && !imagePathOverride) {
      throw new ApiError(400, "needs_image", `Preset ${presetId} requires an image upload handle.`);
    }
    if (cap.inputs.acceptsAudio === true && !audio) {
      throw new ApiError(400, "needs_audio", `Preset ${presetId} requires an audio upload handle.`);
    }

    let inputFilePath = imagePathOverride || null;
    if (image) {
      inputFilePath = this.resolveUpload(image).filePath;
    }
    if (video) this.resolveUpload(video);
    if (audio) this.resolveUpload(audio);
    if (Array.isArray(referenceImages)) {
      for (const r of referenceImages) {
        const up = this.resolveUpload(typeof r === "string" ? r : r.handle);
        if (!inputFilePath) inputFilePath = up.filePath;
      }
    }

    // Validate & resolve LoRAs
    let resolvedPrompt = String(prompt);
    const resolvedLoras = [];
    if (Array.isArray(loras) && loras.length > 0) {
      const avail = this.listLoras();
      for (const l of loras) {
        const found = avail.find((x) => x.name === l.name || x.filename === l.name);
        if (!found) {
          throw new ApiError(400, "unknown_lora", `Unknown LoRA: ${l.name}`);
        }
        resolvedLoras.push({ ...found, weight: l.weight ?? found.defaultStrength });
        if (found.triggerWords && !resolvedPrompt.includes(found.triggerWords)) {
          resolvedPrompt = `${resolvedPrompt}, ${found.triggerWords}`;
        }
      }
    }

    // Resolve backend
    let chosenBackend = backend;
    if (chosenBackend === "auto") {
      chosenBackend = cap.localReady ? "local" : this.state.cloudConnected ? "cloud" : "local";
    }
    if (chosenBackend === "local" && !cap.apiProvider && !cap.localReady) {
      throw new ApiError(400, "preset_not_installed", `Preset ${presetId} is not ready locally. Prepare or download weights first.`);
    }

    let cloudCost = null;
    if (chosenBackend === "cloud") {
      if (!this.state.cloudConnected) {
        throw new ApiError(400, "cloud_not_connected", "Cloud account is not connected.");
      }
      if (!cap.cloudEligible) {
        throw new ApiError(400, "unsupported_backend", `Preset ${presetId} is not cloud-eligible.`);
      }
      cloudCost = cap.cloudCost || 5;
      if (tokenEntry && tokenEntry.spendCap !== null && tokenEntry.spendCap !== undefined) {
        if (tokenEntry.spentCredits + cloudCost > tokenEntry.spendCap) {
          throw new ApiError(402, "exceeds_spend_cap", `Cloud cost (${cloudCost}) exceeds token spend cap (${tokenEntry.spendCap}).`);
        }
      }
      if (this.state.creditBalance < cloudCost) {
        throw new ApiError(402, "exceeds_balance", `Insufficient cloud credits (${this.state.creditBalance} < ${cloudCost}).`);
      }
      this.state.creditBalance -= cloudCost;
      if (tokenEntry) tokenEntry.spentCredits += cloudCost;
    }

    let projectId = this.state.activeProjectId;
    if (project) {
      const pObj = this.state.projects.find((p) => p.id === project || p.slug === project);
      if (pObj) projectId = pObj.id;
    }

    const negParts = [];
    if (options.usePresetDefaults && cap.defaultNegativePrompt) {
      negParts.push(cap.defaultNegativePrompt);
    }
    const extraNeg = negativePrompt || options.negativePrompt;
    if (extraNeg) negParts.push(extraNeg);

    const jobOptions = {
      aspectRatio: options.aspectRatio || (mediaType === "video" ? "16:9" : "1:1"),
      resolution: options.resolution || "720p",
      durationSeconds: durationSeconds || options.durationSeconds || 4,
      steps: options.steps,
      cfg: options.cfg,
      denoise: options.denoise,
      scale: scale || options.scale || 2,
      qualityMode: options.qualityMode || "standard",
      keepResolution: options.keepResolution,
      ...options,
    };

    const compiledWorkflow = !cap.apiProvider
      ? compileComfyWorkflow({
          preset: cap,
          prompt: resolvedPrompt,
          negativePrompt: negParts.join(", "),
          seed: options.seed,
          steps: jobOptions.steps,
          cfg: jobOptions.cfg,
          denoise: jobOptions.denoise ?? 0.72,
          aspectRatio: jobOptions.aspectRatio,
          resolution: jobOptions.resolution,
          durationSeconds: jobOptions.durationSeconds,
          scale: jobOptions.scale,
          qualityMode: jobOptions.qualityMode || "standard",
          keepResolution: Boolean(jobOptions.keepResolution),
          loras: resolvedLoras,
          inputImageName: inputFilePath ? path.basename(inputFilePath) : null,
        })
      : null;

    const job = this.#createJobRecord({
      backend: chosenBackend,
      mediaType,
      presetId: cap.presetId,
      packId: cap.packId,
      projectId,
      prompt: resolvedPrompt,
      negativePrompt: negParts.join(", "),
      seed: options.seed,
      options: jobOptions,
      cloudCost,
      characterId,
      workflow: compiledWorkflow,
    });

    this.#executeJobAsync(job, cap, {
      kind,
      identity,
      scale,
      inputFilePath,
      loras: resolvedLoras,
    });

    const resp = { jobId: job.jobId, backend: chosenBackend, status: job.status };
    if (cloudCost !== null) resp.cloudCost = cloudCost;
    if (chosenBackend === "local" && cap.onThisMachine) resp.expectation = cap.onThisMachine;
    return resp;
  }

  #executeJobAsync(job, cap, meta = {}) {
    setImmediate(async () => {
      if (job.status === "cancelled") return;
      try {
        job.status = "processing";
        job.stage = "preparing";
        job.progress = 15;
        this.save();

        const outExt = job.mediaType === "video" ? ".mp4" : ".png";
        const outName = `${job.jobId}${outExt}`;
        const outPath = path.join(this.outputsDir, outName);

        // 1. External BYOK Provider (OpenAI / Google Gemini-Veo)
        if (cap?.apiProvider === "openai") {
          job.stage = "calling_openai_api";
          await runOpenAiImageGeneration({
            apiKey: this.state.byokKeys.openai,
            prompt: job.prompt,
            aspectRatio: job.options.aspectRatio,
            outPath,
          });
          job.engineUsed = "openai";
          job.resultPath = outPath;
          job.resultUrl = `/media/outputs/${outName}`;
        } else if (cap?.apiProvider === "google") {
          job.stage = "calling_google_api";
          await runGoogleImagenOrGemini({
            apiKey: this.state.byokKeys.google,
            prompt: job.prompt,
            aspectRatio: job.options.aspectRatio,
            mediaType: job.mediaType,
            outPath,
          });
          job.engineUsed = "google";
          job.resultPath = outPath;
          job.resultUrl = `/media/outputs/${outName}`;
        } else if (job.backend === "cloud" && this.state.byokKeys.huggingface && cap?.hfInferenceModel && job.mediaType === "image") {
          // 2. Real Cloud GPU Inference via HuggingFace Inference API
          job.stage = "huggingface_cloud_gpu";
          await runHuggingFaceInference({
            hfToken: this.state.byokKeys.huggingface,
            hfModelId: cap.hfInferenceModel,
            prompt: job.prompt,
            negativePrompt: job.negativePrompt,
            outPath,
          });
          job.engineUsed = "huggingface-cloud";
          job.resultPath = outPath;
          job.resultUrl = `/media/outputs/${outName}`;
        } else {
          // 3. Distribute across live local ComfyUI GPU workers (least-busy scheduler)
          const hw = await this.getHardware();
          const worker = await this.engineManager.acquireWorker(hw.gpus);
          if (worker) {
            let workerSucceeded = false;
            try {
              job.gpuIndex = worker.gpuIndex;
              job.gpuName = worker.gpuName;
              job.comfyPort = worker.port;
              job.stage = `comfyui_gpu_${worker.gpuIndex}`;
              let uploadedComfyName = null;
              if (meta.inputFilePath && fs.existsSync(meta.inputFilePath)) {
                uploadedComfyName = await uploadImageToComfy(worker.comfyUrl, meta.inputFilePath);
              }
              const workflow = compileComfyWorkflow({
                preset: cap,
                prompt: job.prompt,
                negativePrompt: job.negativePrompt,
                seed: job.seed,
                steps: job.options.steps,
                cfg: job.options.cfg,
                denoise: job.options.denoise ?? 0.72,
                aspectRatio: job.options.aspectRatio,
                resolution: job.options.resolution,
                durationSeconds: job.options.durationSeconds || 4,
                scale: meta.scale || 2,
                qualityMode: job.options.qualityMode || "standard",
                keepResolution: Boolean(job.options.keepResolution),
                loras: meta.loras || [],
                inputImageName: uploadedComfyName,
              });
              job.workflow = workflow;
              const targetComfyOut = job.mediaType === "video" ? outPath.replace(/\.mp4$/, ".webp") : outPath;
              await executeComfyWorkflow({
                comfyUrl: worker.comfyUrl,
                workflow,
                outPath: targetComfyOut,
                onProgress: (pct, stage) => {
                  job.progress = pct;
                  job.stage = `gpu${worker.gpuIndex}:${stage}`;
                },
              });
              workerSucceeded = true;
              job.engineUsed = "comfyui";
              job.resultPath = targetComfyOut;
              job.resultUrl = `/media/outputs/${path.basename(targetComfyOut)}`;
            } finally {
              worker.release(workerSucceeded);
            }
          } else if (this.state.settings.strictRealEngine) {
            throw new Error(
              `Strict Real Engine is enabled, but ComfyUI is not running at ${this.engineManager.comfyUrl}. Start or install Local Engine first.`
            );
          } else {
            // 4. Controlled Fallback Synthesizer (non-GPU/dev mode) with real ComfyUI workflow metadata embedded
            const { width, height } = resolveDimensions(
              job.options.aspectRatio,
              job.options.resolution,
              meta.scale || 1
            );
            await new Promise((r) => setTimeout(r, 60));
            if (job.status === "cancelled") return;
            if (job.mediaType === "video") {
              const posterName = `${job.jobId}.poster.png`;
              const posterPath = path.join(this.outputsDir, posterName);
              await renderProceduralVideo({
                outPath,
                posterPath,
                width,
                height,
                durationSeconds: job.options.durationSeconds || 4,
                seed: job.seed,
                presetId: job.presetId,
                prompt: job.prompt,
              });
              job.resultPath = outPath;
              job.resultUrl = `/media/outputs/${outName}`;
              job.posterUrl = `/media/outputs/${posterName}`;
            } else {
              renderProceduralPng({
                outPath,
                width,
                height,
                seed: job.seed,
                presetId: job.presetId,
                prompt: job.prompt,
                kind: meta.kind || "scene",
                identity: meta.identity || null,
              });
              if (job.workflow) embedPngWorkflowMetadata(outPath, job.workflow);
              job.resultPath = outPath;
              job.resultUrl = `/media/outputs/${outName}`;
            }
            job.engineUsed = "fallback-synthesizer";
          }
        }

        if (job.status === "cancelled") return;
        job.status = "completed";
        job.stage = "completed";
        job.progress = 100;
        job.completedAt = new Date().toISOString();
        this.save();
        if (typeof meta.onComplete === "function") {
          meta.onComplete(job);
        }
      } catch (err) {
        job.status = "failed";
        job.stage = "failed";
        job.errorMessage = err.message;
        job.completedAt = new Date().toISOString();
        if (job.backend === "cloud" && job.cloudCost) {
          this.state.creditBalance += job.cloudCost;
        }
        this.save();
        if (typeof meta.onError === "function") {
          meta.onError(err);
        }
      }
    });
  }

  getJob(jobId) {
    const job = this.state.jobs.find((j) => j.jobId === jobId);
    if (!job) throw new ApiError(404, "job_not_found", `Job not found: ${jobId}`);
    return job;
  }

  listJobs() {
    return this.state.jobs.slice(0, 50);
  }

  cancelJob(jobId) {
    const job = this.getJob(jobId);
    if (job.status === "completed" || job.status === "failed") {
      return { jobId, status: job.status, note: "Job already finished." };
    }
    job.status = "cancelled";
    job.stage = "cancelled";
    job.completedAt = new Date().toISOString();
    this.save();
    return { jobId, status: "cancelled" };
  }

  // ---- Character Studio ----

  listCharacters() {
    return this.state.characters;
  }

  getCharacter(id) {
    const c = this.state.characters.find((x) => x.id === id || x.name.toLowerCase() === String(id).toLowerCase());
    if (!c) throw new ApiError(404, "cast_not_found", `Character not found: ${id}`);
    return c;
  }

  createCharacter({ name, gender = "woman", mode = "generate", identity = {}, baseHandle, basePresetId }) {
    if (!name || !String(name).trim()) throw new ApiError(400, "invalid_options", "Character name is required.");
    const charId = `char_${crypto.randomBytes(4).toString("hex")}`;
    const char = {
      id: charId,
      characterId: charId,
      name: String(name).trim(),
      gender,
      identity: identity || {},
      base_image_url: null,
      base_image_path: null,
      defaultImagePresetId: "char-identity-edit",
      defaultVideoPresetId: "char-i2v-steady",
      generations: [],
      createdAt: new Date().toISOString(),
    };

    if (mode === "upload") {
      if (!baseHandle) throw new ApiError(400, "invalid_options", "baseHandle is required for upload mode.");
      const up = this.resolveUpload(baseHandle);
      char.base_image_url = up.url;
      char.base_image_path = up.filePath;
      this.state.characters.push(char);
      this.save();
      return { characterId: charId, character: char };
    }

    this.state.characters.push(char);
    const identityDesc = Object.entries(identity || {})
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");
    const prompt = `Studio headshot portrait of ${char.name}, ${gender}, ${identityDesc || "natural lighting"}`;
    const pid = basePresetId || "char-base-photoreal";
    const cap = CAPABILITIES.find((c) => c.presetId === pid) || CAPABILITIES[0];
    const job = this.#createJobRecord({
      backend: "local",
      mediaType: "image",
      presetId: cap.presetId,
      packId: cap.packId,
      prompt,
      options: { aspectRatio: "3:4", resolution: "720p" },
      characterId: charId,
    });
    this.#executeJobAsync(job, cap, {
      kind: "character",
      identity: char.identity,
      onComplete: (doneJob) => {
        char.base_image_url = doneJob.resultUrl;
        char.base_image_path = doneJob.resultPath;
        char.generations.unshift(doneJob.jobId);
        this.save();
      },
    });
    this.save();
    return { characterId: charId, baseJobId: job.jobId, character: char };
  }

  generateCharacterImage(charId, { prompt, aspect = "1:1", count = 1, presetId }) {
    const char = this.getCharacter(charId);
    if (!prompt) throw new ApiError(400, "needs_prompt", "Scene prompt is required.");
    const n = Math.max(1, Math.min(Number(count) || 1, 4));
    const pid = presetId || char.defaultImagePresetId || "char-identity-edit";
    const cap = CAPABILITIES.find((c) => c.presetId === pid) || CAPABILITIES.find((c) => c.presetId === "char-identity-edit");
    const jobIds = [];
    for (let i = 0; i < n; i++) {
      const job = this.#createJobRecord({
        backend: "local",
        mediaType: "image",
        presetId: cap.presetId,
        packId: cap.packId,
        prompt: `${char.name}, ${prompt}`,
        options: { aspectRatio: aspect, resolution: "720p" },
        characterId: char.id,
      });
      this.#executeJobAsync(job, cap, {
        kind: "character",
        identity: char.identity,
        inputFilePath: char.base_image_path,
        onComplete: (doneJob) => {
          char.generations.unshift(doneJob.jobId);
          this.save();
        },
      });
      jobIds.push(job.jobId);
    }
    return { jobIds };
  }

  generateCharacterFrame(charId, { prompt, aspect = "16:9", presetId }) {
    return this.generateCharacterImage(charId, { prompt, aspect, count: 1, presetId });
  }

  animateCharacter(charId, { frameJobId, framePath, motion = "natural subtle movement", aspect = "16:9", presetId }) {
    const char = this.getCharacter(charId);
    let sourcePath = framePath || null;
    if (frameJobId) {
      sourcePath = this.getJob(frameJobId).resultPath;
    }
    if (!sourcePath) {
      throw new ApiError(400, "needs_image", "frameJobId or framePath is required.");
    }
    const pid = presetId || char.defaultVideoPresetId || "char-i2v-steady";
    const cap = CAPABILITIES.find((c) => c.presetId === pid) || CAPABILITIES.find((c) => c.presetId === "char-i2v-steady");
    const job = this.#createJobRecord({
      backend: "local",
      mediaType: "video",
      presetId: cap.presetId,
      packId: cap.packId,
      prompt: `${char.name}, ${motion}`,
      options: { aspectRatio: aspect, resolution: "720p", durationSeconds: 4 },
      characterId: char.id,
    });
    this.#executeJobAsync(job, cap, {
      kind: "character",
      identity: char.identity,
      inputFilePath: sourcePath,
      onComplete: (doneJob) => {
        char.generations.unshift(doneJob.jobId);
        this.save();
      },
    });
    return { jobIds: [job.jobId] };
  }

  setCharacterPreset(charId, { imagePresetId, videoPresetId }) {
    const char = this.getCharacter(charId);
    if (imagePresetId !== undefined) char.defaultImagePresetId = imagePresetId;
    if (videoPresetId !== undefined) char.defaultVideoPresetId = videoPresetId;
    this.save();
    return { character: char };
  }

  enhanceCharacterMedia(charId, { jobId, filePath, target, mediaType, presetId = "rtx-upscaler", scale = 2, keepResolution = false, applyAsBase = false }) {
    const char = this.getCharacter(charId);
    let mType = mediaType || "image";
    let inputPath = filePath || null;
    if (jobId) {
      const srcJob = this.getJob(jobId);
      mType = srcJob.mediaType;
      inputPath = srcJob.resultPath;
    } else if (target === "base") {
      mType = "image";
      inputPath = char.base_image_path;
    } else if (!filePath) {
      throw new ApiError(400, "invalid_options", "Provide one of jobId, filePath, or target: 'base'.");
    }

    const cap = CAPABILITIES.find((c) => c.presetId === presetId) || CAPABILITIES.find((c) => c.presetId === "rtx-upscaler");
    const job = this.#createJobRecord({
      backend: "local",
      mediaType: mType,
      presetId: cap.presetId,
      packId: cap.packId,
      prompt: `Enhanced ${scale}x ${keepResolution ? "(keep resolution) " : ""}for ${char.name}`,
      options: { aspectRatio: "3:4", resolution: scale >= 4 ? "4K" : "1080p", scale, keepResolution },
      characterId: char.id,
    });
    this.#executeJobAsync(job, cap, {
      kind: "character",
      identity: char.identity,
      inputFilePath: inputPath,
      scale: keepResolution ? 1 : Math.min(2, scale),
      onComplete: (doneJob) => {
        char.generations.unshift(doneJob.jobId);
        if (applyAsBase && doneJob.mediaType === "image") {
          char.base_image_url = doneJob.resultUrl;
          char.base_image_path = doneJob.resultPath;
        }
        this.save();
      },
    });
    return { jobId: job.jobId };
  }

  regenerateCharacterBase(charId, { basePresetId, identity }) {
    const char = this.getCharacter(charId);
    if (identity) char.identity = { ...char.identity, ...identity };
    const pid = basePresetId || "char-base-photoreal";
    const cap = CAPABILITIES.find((c) => c.presetId === pid) || CAPABILITIES[0];
    const job = this.#createJobRecord({
      backend: "local",
      mediaType: "image",
      presetId: cap.presetId,
      packId: cap.packId,
      prompt: `Regenerated portrait of ${char.name}`,
      options: { aspectRatio: "3:4", resolution: "720p" },
      characterId: char.id,
    });
    this.#executeJobAsync(job, cap, {
      kind: "character",
      identity: char.identity,
      onComplete: (doneJob) => {
        char.generations.unshift(doneJob.jobId);
        this.save();
      },
    });
    this.save();
    return { baseJobId: job.jobId, characterId: char.id };
  }

  acceptCharacterBase(charId, { altImageId }) {
    const char = this.getCharacter(charId);
    const job = this.getJob(altImageId);
    char.base_image_url = job.resultUrl;
    char.base_image_path = job.resultPath;
    this.save();
    return { character: char };
  }

  removeCharacter(charId) {
    const idx = this.state.characters.findIndex((c) => c.id === charId);
    if (idx === -1) throw new ApiError(404, "cast_not_found", `Character not found: ${charId}`);
    this.state.characters.splice(idx, 1);
    this.save();
    return { removed: true, characterId: charId };
  }

  // ---- Products, Locations & Subjects ----

  listProducts() {
    return this.state.products;
  }

  getProduct(id) {
    const p = this.state.products.find((x) => x.id === id);
    if (!p) throw new ApiError(404, "not_found", `Product not found: ${id}`);
    return p;
  }

  createProduct({ name, image, description = "", category = "general" }) {
    if (!name || !image) throw new ApiError(400, "invalid_options", "name and image upload handle are required.");
    const up = this.resolveUpload(image);
    const prod = {
      id: `prod_${crypto.randomBytes(4).toString("hex")}`,
      name: String(name).trim(),
      description,
      category,
      imageHandle: image,
      imageUrl: up.url,
      imagePath: up.filePath,
      createdAt: new Date().toISOString(),
    };
    this.state.products.push(prod);
    this.save();
    return { productId: prod.id, product: prod };
  }

  removeProduct(id) {
    const idx = this.state.products.findIndex((p) => p.id === id);
    if (idx === -1) throw new ApiError(404, "not_found", `Product not found: ${id}`);
    this.state.products.splice(idx, 1);
    this.save();
    return { removed: true, id };
  }

  listSubjects() {
    return [
      ...this.state.characters.map((c) => ({ id: c.id, type: "character", name: c.name, status: c.base_image_url ? "ready" : "pending" })),
      ...this.state.products.map((p) => ({ id: p.id, type: "product", name: p.name, status: "ready" })),
    ];
  }

  listLocations() {
    return this.state.locations;
  }

  getLocation(nameOrId) {
    return this.state.locations.find(
      (l) => l.id === nameOrId || l.name.toLowerCase() === String(nameOrId).toLowerCase()
    );
  }

  createLocation({ name, description = "", upload, fromJob }) {
    if (!name) throw new ApiError(400, "invalid_options", "Location name is required.");
    let imageUrl = null;
    let imagePath = null;
    if (upload) {
      const up = this.resolveUpload(upload);
      imageUrl = up.url;
      imagePath = up.filePath;
    } else if (fromJob) {
      const job = this.getJob(fromJob);
      if (job.status !== "completed" || !job.resultPath) {
        throw new ApiError(400, "invalid_options", `Job ${fromJob} is not completed.`);
      }
      imageUrl = job.resultUrl;
      imagePath = job.resultPath;
    } else {
      throw new ApiError(400, "invalid_options", "Provide upload handle or fromJob.");
    }
    const loc = {
      id: `loc_${crypto.randomBytes(4).toString("hex")}`,
      name: String(name).trim(),
      description,
      hasPicture: true,
      imageUrl,
      imagePath,
      createdAt: new Date().toISOString(),
    };
    this.state.locations.push(loc);
    this.save();
    return { location: loc };
  }

  // ---- Recipes & Flows ----

  listRecipes() {
    return this.state.recipes;
  }

  getRecipe(id) {
    const r = this.state.recipes.find((x) => x.id === id);
    if (!r) throw new ApiError(404, "not_found", `Recipe not found: ${id}`);
    const caps = this.getCapabilities();
    const readiness = r.steps.map((s) => {
      const [packId, presetId] = (s.preset || "").includes(":") ? s.preset.split(":") : [null, s.preset];
      const cap = caps.find((c) => c.presetId === presetId && (!packId || c.packId === packId));
      return {
        stepId: s.id,
        preset: s.preset,
        localReady: cap ? cap.localReady : false,
        cloudEligible: cap ? cap.cloudEligible : false,
      };
    });
    return { ...r, readiness };
  }

  validateRecipe({ spec, config }) {
    const errors = [];
    const target = spec || config;
    if (!target) {
      errors.push("Provide spec or config.");
      return { valid: false, errors };
    }
    if (!target.name || !String(target.name).trim()) {
      errors.push("Recipe name is required.");
    }
    const steps = target.steps || target.blocks || [];
    if (!Array.isArray(steps) || steps.length === 0) {
      errors.push("Recipe must declare at least one step.");
    } else {
      const caps = this.getCapabilities();
      steps.forEach((step, idx) => {
        const ref = step.preset || "";
        const [packId, presetId] = ref.includes(":") ? ref.split(":") : [null, ref];
        const cap = caps.find((c) => c.presetId === presetId && (!packId || c.packId === packId));
        if (!cap) errors.push(`Step ${idx + 1}: unknown preset "${ref}".`);
      });
    }
    return { valid: errors.length === 0, errors };
  }

  composeRecipe({ spec }) {
    const validation = this.validateRecipe({ spec });
    const id = `rec_${crypto.randomBytes(4).toString("hex")}`;
    const autoInputs = [...(spec?.inputs || [])];
    const steps = (spec?.steps || []).map((st, i) => {
      const stepId = `n${i + 1}`;
      const promptKey = st.promptInput?.key || `prompt_${i + 1}`;
      if (!autoInputs.find((x) => x.key === promptKey)) {
        autoInputs.push({
          key: promptKey,
          kind: "text",
          label: st.promptInput?.label || `Step ${i + 1} Prompt`,
          required: false,
        });
      }
      return { id: stepId, ...st, promptKey };
    });
    const lastStep = steps[steps.length - 1];
    const [, lpid] = (lastStep?.preset || "").split(":");
    const lastCap = CAPABILITIES.find((c) => c.presetId === lpid);
    const config = {
      blocks: steps.map((s) => s.preset),
      inputs: autoInputs.map((i) => i.key),
      output: { from: `${lastStep?.id || "n1"}.${lastCap?.mediaType || "image"}` },
    };
    const recipe = {
      id,
      name: spec?.name || "Untitled Recipe",
      description: spec?.description || "",
      category: spec?.category || "custom",
      version: spec?.version || "1.0.0",
      published: false,
      priceTokens: 0,
      author: "Local Creator",
      inputs: autoInputs,
      steps,
      config,
      createdAt: new Date().toISOString(),
    };
    if (validation.valid) {
      this.state.recipes.push(recipe);
      this.save();
    }
    return {
      recipeId: id,
      valid: validation.valid,
      errors: validation.errors,
      config,
    };
  }

  publishRecipe(id, { changelog = "", priceTokens = 0 } = {}) {
    const rec = this.state.recipes.find((r) => r.id === id);
    if (!rec) throw new ApiError(404, "not_found", `Recipe not found: ${id}`);
    if (!this.state.cloudConnected) {
      throw new ApiError(400, "not_connected", "Connect an account to publish to the marketplace.", { needsConnect: true });
    }
    rec.published = true;
    rec.priceTokens = Math.max(0, Math.min(10000, Number(priceTokens) || 0));
    rec.changelog = changelog;
    this.save();
    return { recipeId: id, status: "submitted_for_review", published: true, priceTokens: rec.priceTokens };
  }

  runRecipe(id, { inputs = {}, engine = "local" }) {
    const rec = this.getRecipe(id);
    const runId = `run_${crypto.randomBytes(5).toString("hex")}`;
    const chosenEngine = engine === "auto" ? "local" : engine;
    const run = {
      runId,
      recipeId: rec.id,
      recipeName: rec.name,
      status: "running",
      engine: chosenEngine,
      inputs,
      steps: rec.steps.map((s, idx) => ({
        stepIndex: idx,
        stepId: s.id,
        preset: s.preset,
        status: "queued",
        jobId: null,
        resultPath: null,
        resultUrl: null,
      })),
      resultPath: null,
      resultUrl: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
    };
    this.state.recipeRuns.unshift(run);
    this.save();

    (async () => {
      let lastMediaPath = null;
      // Seed initial subject image if available
      for (const v of Object.values(inputs)) {
        const prod = this.state.products.find((p) => p.id === v);
        const char = this.state.characters.find((c) => c.id === v);
        if (prod?.imagePath) lastMediaPath = prod.imagePath;
        else if (char?.base_image_path) lastMediaPath = char.base_image_path;
      }

      for (let i = 0; i < rec.steps.length; i++) {
        if (run.status === "cancelled") break;
        const step = rec.steps[i];
        const stepState = run.steps[i];
        stepState.status = "running";
        const [packId, presetId] = (step.preset || "").split(":");
        const cap = CAPABILITIES.find((c) => c.presetId === presetId) || CAPABILITIES[0];
        const mediaType = cap?.mediaType || (step.entry === "create-video" ? "video" : "image");

        let promptText = step.promptTemplate || inputs[step.promptKey] || `${rec.name} step ${i + 1}`;
        for (const [k, v] of Object.entries(inputs)) {
          if (typeof v === "string") {
            const char = this.state.characters.find((c) => c.id === v);
            const prod = this.state.products.find((p) => p.id === v);
            const obj = char || prod;
            if (obj) {
              promptText = promptText
                .replaceAll(`{{${k}.name}}`, obj.name)
                .replaceAll(`{{${k}.description}}`, obj.description || obj.name);
            }
            promptText = promptText.replaceAll(`{{${k}}}`, v);
          }
        }

        const job = this.#createJobRecord({
          backend: chosenEngine,
          mediaType,
          presetId: cap.presetId,
          packId: cap.packId || packId,
          prompt: promptText,
          options: {
            aspectRatio: inputs.aspectRatio || "16:9",
            resolution: "720p",
            durationSeconds: 4,
          },
        });
        stepState.jobId = job.jobId;
        await new Promise((resolve) => {
          this.#executeJobAsync(job, cap, {
            kind: rec.category === "product" ? "product" : "scene",
            inputFilePath: lastMediaPath,
            onComplete: (done) => {
              stepState.status = "completed";
              stepState.resultPath = done.resultPath;
              stepState.resultUrl = done.resultUrl;
              if (done.mediaType === "image") lastMediaPath = done.resultPath;
              run.resultPath = done.resultPath;
              run.resultUrl = done.resultUrl;
              resolve();
            },
            onError: (err) => {
              stepState.status = "failed";
              run.status = "failed";
              run.errorMessage = err.message;
              resolve();
            },
          });
        });
        if (run.status === "failed") break;
      }
      if (run.status === "running") {
        run.status = "completed";
        run.completedAt = new Date().toISOString();
      }
      this.save();
    })();

    return {
      runId,
      status: "running",
      engine: chosenEngine,
      steps: run.steps,
      ...(chosenEngine === "cloud" ? { cloudCost: 18 } : {}),
    };
  }

  getRecipeRun(runId) {
    const run = this.state.recipeRuns.find((r) => r.runId === runId);
    if (!run) throw new ApiError(404, "not_found", `Recipe run not found: ${runId}`);
    return run;
  }

  listRecipeRuns(recipeId) {
    return this.state.recipeRuns.filter((r) => r.recipeId === recipeId);
  }

  cancelRecipeRun(runId) {
    const run = this.getRecipeRun(runId);
    run.status = "cancelled";
    run.completedAt = new Date().toISOString();
    this.save();
    return { runId, status: "cancelled" };
  }

  // ---- Video Studio ----

  listFilms(projectId) {
    const pid = projectId || this.state.activeProjectId;
    return this.state.films
      .filter((f) => !projectId || f.projectId === pid)
      .map((f) => ({
        id: f.id,
        title: f.name,
        name: f.name,
        aspect: f.aspect,
        quality: f.quality,
        clipCount: f.clips.length,
        bpm: f.tempo?.bpm || null,
      }));
  }

  #getFilmRaw(filmId) {
    const f = this.state.films.find((x) => x.id === filmId);
    if (!f) throw new ApiError(404, "film_not_found", `Film not found: ${filmId}`);
    return f;
  }

  #pushUndoSnapshot(film) {
    if (!film._undo) film._undo = [];
    if (!film._redo) film._redo = [];
    const snap = JSON.stringify({
      aspect: film.aspect,
      quality: film.quality,
      hires2x: film.hires2x,
      renderOn: film.renderOn,
      presets: film.presets,
      subject: film.subject,
      cast: film.cast,
      location: film.location,
      tempo: film.tempo,
      tracks: film.tracks,
      clips: film.clips,
      markers: film.markers,
      exportRange: film.exportRange,
    });
    film._undo.push(snap);
    if (film._undo.length > 40) film._undo.shift();
    film._redo = [];
  }

  undoFilm(filmId) {
    const film = this.#getFilmRaw(filmId);
    if (!film._undo || film._undo.length === 0) return { change: "nothing_to_undo", timeline: this.getFilm(filmId) };
    const current = JSON.stringify({
      aspect: film.aspect, quality: film.quality, hires2x: film.hires2x, renderOn: film.renderOn,
      presets: film.presets, subject: film.subject, cast: film.cast, location: film.location,
      tempo: film.tempo, tracks: film.tracks, clips: film.clips, markers: film.markers, exportRange: film.exportRange,
    });
    film._redo.push(current);
    Object.assign(film, JSON.parse(film._undo.pop()));
    this.save();
    return { change: "undo", timeline: this.getFilm(filmId) };
  }

  redoFilm(filmId) {
    const film = this.#getFilmRaw(filmId);
    if (!film._redo || film._redo.length === 0) return { change: "nothing_to_redo", timeline: this.getFilm(filmId) };
    const current = JSON.stringify({
      aspect: film.aspect, quality: film.quality, hires2x: film.hires2x, renderOn: film.renderOn,
      presets: film.presets, subject: film.subject, cast: film.cast, location: film.location,
      tempo: film.tempo, tracks: film.tracks, clips: film.clips, markers: film.markers, exportRange: film.exportRange,
    });
    film._undo.push(current);
    Object.assign(film, JSON.parse(film._redo.pop()));
    this.save();
    return { change: "redo", timeline: this.getFilm(filmId) };
  }

  #resolveSeconds(film, val, isLength = false) {
    if (val === undefined || val === null) return null;
    if (typeof val === "number") return val;
    if (typeof val === "object") {
      if (Number.isFinite(val.seconds)) return val.seconds;
      if (Number.isFinite(val.bar)) {
        if (!film.tempo) throw new ApiError(400, "no_tempo", "Detect tempo first before positioning by bar.");
        const barSec = (60 / film.tempo.bpm) * 4;
        return Number(((film.tempo.offset || 0) + (val.bar - 1) * barSec).toFixed(3));
      }
      if (Number.isFinite(val.bars)) {
        if (!film.tempo) throw new ApiError(400, "no_tempo", "Detect tempo first before sizing by bars.");
        const barSec = (60 / film.tempo.bpm) * 4;
        return Number((val.bars * barSec).toFixed(3));
      }
    }
    throw new ApiError(400, "invalid_options", `Invalid ${isLength ? "length" : "time"} value.`);
  }

  #secondsToBar(film, sec) {
    if (!film.tempo) return null;
    const barSec = (60 / film.tempo.bpm) * 4;
    return Number((1 + (sec - (film.tempo.offset || 0)) / barSec).toFixed(2));
  }

  getFilm(filmId) {
    const f = this.#getFilmRaw(filmId);
    const sorted = [...f.clips].sort((a, b) => a.at - b.at);
    const barSec = f.tempo ? (60 / f.tempo.bpm) * 4 : null;
    return {
      id: f.id,
      name: f.name,
      projectId: f.projectId,
      aspect: f.aspect,
      quality: f.quality,
      hires2x: f.hires2x,
      renderOn: f.renderOn,
      presets: f.presets,
      subject: f.subject,
      cast: f.cast,
      location: f.location,
      tempo: f.tempo,
      tracks: f.tracks,
      videoLanes: f.videoLanes,
      markers: f.markers,
      exportRange: f.exportRange,
      rendersRunning: Boolean(f.rendersRunning),
      lastExportUrl: f.lastExportUrl || null,
      lastExportPath: f.lastExportPath || null,
      canUndo: Boolean(f._undo && f._undo.length > 0),
      canRedo: Boolean(f._redo && f._redo.length > 0),
      clips: sorted.map((c, idx) => ({
        ...c,
        number: idx + 1,
        bar: barSec ? this.#secondsToBar(f, c.at) : null,
        bars: barSec ? Number((c.length / barSec).toFixed(2)) : null,
      })),
    };
  }

  createFilm({ name = "Untitled Film", projectId, aspect = "16:9", quality = "720p", renderOn = "local", presets = {} }) {
    const id = `film_${crypto.randomBytes(4).toString("hex")}`;
    const film = {
      id,
      name: String(name).trim() || "Untitled Film",
      projectId: projectId || this.state.activeProjectId,
      aspect,
      quality,
      hires2x: false,
      renderOn,
      presets: {
        t2v: presets.t2v || "ltx-2-video-pack:ltx-2.5-video",
        i2v: presets.i2v || "wan-2.2-video-pack:wan-2.2-i2v",
        r2v: presets.r2v || "minimax-h3-pack:minimax-h3-video",
      },
      subject: "",
      cast: [],
      location: null,
      tempo: null,
      tracks: [],
      videoLanes: [{ id: "main", name: "Main Track" }, { id: "overlay", name: "B-Roll Overlay" }],
      clips: [],
      markers: [],
      exportRange: null,
      rendersRunning: false,
      lastExportUrl: null,
      lastExportPath: null,
      createdAt: new Date().toISOString(),
    };
    this.state.films.push(film);
    this.save();
    return this.getFilm(id);
  }

  updateFilmSettings(filmId, args) {
    const film = this.#getFilmRaw(filmId);
    this.#pushUndoSnapshot(film);
    if (args.aspect) film.aspect = args.aspect;
    if (args.quality) film.quality = args.quality;
    if (args.hires2x !== undefined) film.hires2x = Boolean(args.hires2x);
    if (args.renderOn) film.renderOn = args.renderOn;
    if (args.presets) film.presets = { ...film.presets, ...args.presets };
    if (args.subject !== undefined) film.subject = args.subject;
    if (args.cast) film.cast = args.cast.map((cRef) => this.getCharacter(cRef).name);
    if (args.location !== undefined) {
      if (args.location === null) film.location = null;
      else {
        const loc = this.getLocation(args.location);
        if (!loc) throw new ApiError(404, "location_not_found", `Location not found: ${args.location}`);
        film.location = loc.name;
      }
    }
    this.save();
    return { change: "updated_settings", timeline: this.getFilm(filmId) };
  }

  addTrack(filmId, { upload, name, kind, at = 0 }) {
    const film = this.#getFilmRaw(filmId);
    const up = this.resolveUpload(upload);
    this.#pushUndoSnapshot(film);
    const startSec = this.#resolveSeconds(film, at) ?? 0;
    const guessedKind = kind || (up.originalName.toLowerCase().includes("vocal") ? "singing" : "music");
    const track = {
      id: `trk_${crypto.randomBytes(4).toString("hex")}`,
      name: name || up.originalName,
      kind: guessedKind,
      uploadHandle: upload,
      filePath: up.filePath,
      url: up.url,
      at: startSec,
      muted: false,
      volume: 1.0,
      fadeIn: 0,
      fadeOut: 0,
    };
    film.tracks.push(track);
    this.save();
    return { change: "added_track", track, timeline: this.getFilm(filmId) };
  }

  #findTrack(film, ref) {
    const t = film.tracks.find((x) => x.id === ref || x.name === ref);
    if (!t) throw new ApiError(404, "track_not_found", `Track not found: ${ref}`);
    return t;
  }

  moveTrack(filmId, trackRef, { at, muted, volume }) {
    const film = this.#getFilmRaw(filmId);
    const tr = this.#findTrack(film, trackRef);
    this.#pushUndoSnapshot(film);
    if (at !== undefined) tr.at = this.#resolveSeconds(film, at) ?? tr.at;
    if (muted !== undefined) tr.muted = Boolean(muted);
    if (volume !== undefined) tr.volume = Math.max(0, Math.min(1, Number(volume)));
    this.save();
    return { change: "moved_track", timeline: this.getFilm(filmId) };
  }

  async detectTempo(filmId, { track } = {}) {
    const film = this.#getFilmRaw(filmId);
    if (film.tracks.length === 0) throw new ApiError(400, "no_audio", "Film has no audio track to detect tempo from.");
    const chosen = track ? this.#findTrack(film, track) : film.tracks.find((t) => !t.muted) || film.tracks[0];

    // Real DSP onset autocorrelation BPM & offset analysis
    const { bpm, offset, confidence } = await detectAudioTempo(chosen.filePath);

    this.#pushUndoSnapshot(film);
    film.tempo = { bpm, offset, confidence, trackId: chosen.id, trackName: chosen.name };
    this.save();
    return { bpm, offset, confidence, track: chosen.name, timeline: this.getFilm(filmId) };
  }

  #findClip(film, clipRef) {
    const sorted = [...film.clips].sort((a, b) => a.at - b.at);
    const num = Number(clipRef);
    if (Number.isInteger(num) && num >= 1 && num <= sorted.length && String(clipRef).trim() === String(num)) {
      return sorted[num - 1];
    }
    const found = film.clips.find((c) => c.id === clipRef || c.name === clipRef);
    if (!found) throw new ApiError(404, "clip_not_found", `Clip not found: ${clipRef}`);
    return found;
  }

  addClip(filmId, { at, length = 4, name, lane = "main" } = {}) {
    const film = this.#getFilmRaw(filmId);
    this.#pushUndoSnapshot(film);
    const lastEnd = film.clips.reduce((m, c) => Math.max(m, c.at + c.length), film.tempo?.offset || 0);
    const startSec = at !== undefined ? this.#resolveSeconds(film, at) : lastEnd;
    const lenSec = this.#resolveSeconds(film, length, true) ?? 4;
    const clip = {
      id: `clip_${crypto.randomBytes(4).toString("hex")}`,
      name: name || `Clip ${film.clips.length + 1}`,
      lane: lane || "main",
      at: startSec,
      length: lenSec,
      trimIn: 0,
      fadeIn: 0,
      fadeOut: 0,
      link: "fresh",
      cast: [...film.cast],
      location: film.location,
      preset: null,
      hears: [],
      shots: [{ prompt: "Establishing shot", seconds: lenSec, framing: "wide" }],
      take: "none",
      takes: [],
      activeTakeId: null,
      resultPath: null,
      resultUrl: null,
      posterUrl: null,
    };
    film.clips.push(clip);
    this.save();
    return { change: "added_clip", clipId: clip.id, timeline: this.getFilm(filmId) };
  }

  importClip(filmId, { generationId, at, length, name, lane = "main" }) {
    const film = this.#getFilmRaw(filmId);
    const job = this.getJob(generationId);
    if (job.status !== "completed" || job.mediaType !== "video") {
      throw new ApiError(400, "invalid_options", "generationId must be a completed video job.");
    }
    this.#pushUndoSnapshot(film);
    const lastEnd = film.clips.reduce((m, c) => Math.max(m, c.at + c.length), 0);
    const startSec = at !== undefined ? this.#resolveSeconds(film, at) : lastEnd;
    const lenSec = length !== undefined ? this.#resolveSeconds(film, length, true) : (job.options?.durationSeconds || 4);
    const clip = {
      id: `clip_${crypto.randomBytes(4).toString("hex")}`,
      name: name || `Imported ${job.jobId}`,
      lane,
      at: startSec,
      length: lenSec,
      trimIn: 0,
      fadeIn: 0,
      fadeOut: 0,
      link: "fresh",
      cast: [],
      location: null,
      preset: null,
      hears: [],
      shots: [{ prompt: job.prompt || "Imported video clip", seconds: lenSec }],
      take: "imported",
      takes: [{ generationId: job.jobId, createdAt: job.completedAt, resultPath: job.resultPath, resultUrl: job.resultUrl, posterUrl: job.posterUrl }],
      activeTakeId: job.jobId,
      resultPath: job.resultPath,
      resultUrl: job.resultUrl,
      posterUrl: job.posterUrl,
    };
    film.clips.push(clip);
    this.save();
    return { change: "imported_clip", clipId: clip.id, timeline: this.getFilm(filmId) };
  }

  updateClip(filmId, clipRef, args) {
    const film = this.#getFilmRaw(filmId);
    const clip = this.#findClip(film, clipRef);
    this.#pushUndoSnapshot(film);
    if (args.shots) {
      clip.shots = args.shots;
      if (clip.take === "current") clip.take = "edited";
    }
    if (args.cast) {
      clip.cast = args.cast.map((c) => this.getCharacter(c).name);
      if (clip.take === "current") clip.take = "edited";
    }
    if (args.location !== undefined) {
      if (args.location === "none") clip.location = null;
      else if (args.location === "film") clip.location = film.location;
      else {
        const loc = this.getLocation(args.location);
        if (!loc) throw new ApiError(404, "location_not_found", `Location not found: ${args.location}`);
        clip.location = loc.name;
      }
      if (clip.take === "current") clip.take = "edited";
    }
    if (args.link) {
      clip.link = args.link === "none" ? "fresh" : args.link === "frame" ? "continue" : args.link;
    }
    if (args.hears) clip.hears = args.hears;
    if (args.preset !== undefined) clip.preset = args.preset;
    this.save();
    return { change: "updated_clip", timeline: this.getFilm(filmId) };
  }

  moveClip(filmId, clipRef, { at, lane }) {
    const film = this.#getFilmRaw(filmId);
    const clip = this.#findClip(film, clipRef);
    this.#pushUndoSnapshot(film);
    if (at !== undefined && at !== null) clip.at = this.#resolveSeconds(film, at);
    if (lane) clip.lane = lane;
    this.save();
    return { change: "moved_clip", timeline: this.getFilm(filmId) };
  }

  trimClip(filmId, clipRef, { length, trimIn }) {
    const film = this.#getFilmRaw(filmId);
    const clip = this.#findClip(film, clipRef);
    this.#pushUndoSnapshot(film);
    if (length !== undefined && length !== null) {
      const newLen = this.#resolveSeconds(film, length, true);
      if (clip.take === "current" && newLen > clip.length) clip.take = "longer";
      clip.length = newLen;
    }
    if (trimIn !== undefined && trimIn !== null) {
      clip.trimIn = this.#resolveSeconds(film, trimIn, true);
    }
    this.save();
    return { change: "trimmed_clip", timeline: this.getFilm(filmId) };
  }

  removeClip(filmId, clipRef) {
    const film = this.#getFilmRaw(filmId);
    const clip = this.#findClip(film, clipRef);
    this.#pushUndoSnapshot(film);
    film.clips = film.clips.filter((c) => c.id !== clip.id);
    this.save();
    return { change: "removed_clip", timeline: this.getFilm(filmId) };
  }

  applyFilmPlan(filmId, plan) {
    const film = this.#getFilmRaw(filmId);
    const problems = [];
    const mode = plan.mode || "append";

    if (mode === "replace" && !plan.discardTakes) {
      const hasTakes = film.clips.some((c) => c.takes && c.takes.length > 0);
      if (hasTakes) {
        problems.push("mode replace refused because existing clips already have rendered takes (pass discardTakes: true to confirm).");
      }
    }

    if (!Array.isArray(plan.clips) || plan.clips.length === 0) {
      problems.push("clips array must contain at least one clip.");
    }

    const resolveCastList = (names = [], prefix = "") => {
      const out = [];
      for (const n of names) {
        try {
          out.push(this.getCharacter(n).name);
        } catch {
          problems.push(`${prefix}cast member "${n}" does not exist in Library.`);
        }
      }
      return out;
    };

    const filmCast = plan.cast ? resolveCastList(plan.cast, "") : [...film.cast];
    let filmLoc = film.location;
    if (plan.location) {
      const loc = this.getLocation(plan.location);
      if (!loc) problems.push(`location "${plan.location}" does not exist in Library.`);
      else filmLoc = loc.name;
    }

    let startCursor = 0;
    try {
      if (plan.start !== undefined) startCursor = this.#resolveSeconds(film, plan.start);
      else if (mode === "replace") startCursor = film.tempo?.offset || 0;
      else if (film.clips.length > 0) startCursor = film.clips.reduce((m, c) => Math.max(m, c.at + c.length), 0);
      else startCursor = film.tempo?.offset || 0;
    } catch (e) {
      problems.push(e.message);
    }

    const preparedClips = [];
    (plan.clips || []).forEach((cSpec, idx) => {
      const num = idx + 1;
      const prefix = `clip ${num}: `;
      let lenSec = null;
      if (cSpec.bars !== undefined) {
        if (!film.tempo) problems.push(`${prefix}bars used before film tempo has been detected.`);
        else lenSec = Number((cSpec.bars * ((60 / film.tempo.bpm) * 4)).toFixed(3));
      } else if (cSpec.seconds !== undefined) {
        lenSec = Number(cSpec.seconds);
      } else {
        problems.push(`${prefix}must specify either bars or seconds.`);
      }

      if (!Array.isArray(cSpec.shots) || cSpec.shots.length === 0) {
        problems.push(`${prefix}must contain at least one shot.`);
      } else if (lenSec !== null) {
        const explicitSum = cSpec.shots.reduce((s, sh) => s + (Number(sh.seconds) || 0), 0);
        if (explicitSum > lenSec + 0.05) {
          problems.push(`${prefix}shot durations (${explicitSum}s) exceed clip length (${lenSec}s).`);
        }
      }

      const clipCast = cSpec.cast ? resolveCastList(cSpec.cast, prefix) : filmCast;
      let clipLoc = filmLoc;
      if (cSpec.location) {
        const l = this.getLocation(cSpec.location);
        if (!l) problems.push(`${prefix}location "${cSpec.location}" not found.`);
        else clipLoc = l.name;
      }

      const normLink = cSpec.link === "none" ? "fresh" : cSpec.link === "frame" ? "continue" : cSpec.link || "fresh";
      if (normLink === "continue" && idx === 0 && (mode === "replace" || film.clips.length === 0)) {
        problems.push(`${prefix}cannot use link "continue" on the very first clip.`);
      }

      if (problems.length === 0) {
        preparedClips.push({
          id: `clip_${crypto.randomBytes(4).toString("hex")}`,
          name: cSpec.name || `Clip ${mode === "replace" ? num : film.clips.length + num}`,
          lane: "main",
          at: Number(startCursor.toFixed(3)),
          length: lenSec,
          trimIn: 0,
          fadeIn: 0,
          fadeOut: 0,
          link: normLink,
          cast: clipCast,
          location: clipLoc,
          preset: null,
          hears: [],
          shots: cSpec.shots,
          take: "none",
          takes: [],
          activeTakeId: null,
          resultPath: null,
          resultUrl: null,
          posterUrl: null,
        });
        startCursor += lenSec;
      }
    });

    if (problems.length > 0) {
      throw new ApiError(400, "invalid_plan", "Film plan validation failed.", { problems });
    }

    this.#pushUndoSnapshot(film);
    if (plan.cast) film.cast = filmCast;
    if (plan.location) film.location = filmLoc;
    if (mode === "replace") film.clips = preparedClips;
    else film.clips.push(...preparedClips);

    this.save();
    return { change: "applied_plan", clipsAdded: preparedClips.length, timeline: this.getFilm(filmId) };
  }

  setFades(filmId, { target, fadeIn, fadeOut }) {
    const film = this.#getFilmRaw(filmId);
    this.#pushUndoSnapshot(film);
    let item = null;
    try {
      item = this.#findClip(film, target);
    } catch {
      item = this.#findTrack(film, target);
    }
    if (fadeIn !== undefined) item.fadeIn = Math.max(0, Number(fadeIn));
    if (fadeOut !== undefined) item.fadeOut = Math.max(0, Number(fadeOut));
    this.save();
    return { change: "set_fades", timeline: this.getFilm(filmId) };
  }

  addMarker(filmId, { at, name = "Marker" }) {
    const film = this.#getFilmRaw(filmId);
    this.#pushUndoSnapshot(film);
    const sec = this.#resolveSeconds(film, at);
    film.markers.push({ id: `mrk_${crypto.randomBytes(3).toString("hex")}`, at: sec, name });
    this.save();
    return { change: "added_marker", timeline: this.getFilm(filmId) };
  }

  setExportRange(filmId, { from, to, clear }) {
    const film = this.#getFilmRaw(filmId);
    this.#pushUndoSnapshot(film);
    if (clear) {
      film.exportRange = null;
    } else {
      if (from === undefined || to === undefined) {
        throw new ApiError(400, "invalid_options", "Both from and to are required unless clear: true.");
      }
      film.exportRange = { from: this.#resolveSeconds(film, from), to: this.#resolveSeconds(film, to) };
    }
    this.save();
    return { change: "set_export_range", timeline: this.getFilm(filmId) };
  }

  renderClips(filmId, { clips = "stale" } = {}, tokenEntry = null) {
    const film = this.#getFilmRaw(filmId);
    const sorted = [...film.clips].sort((a, b) => a.at - b.at);
    const targets =
      clips === "stale"
        ? sorted.filter((c) => ["none", "edited", "longer"].includes(c.take))
        : (Array.isArray(clips) ? clips : [clips]).map((ref) => this.#findClip(film, ref));

    if (targets.length === 0) {
      return { started: [], held: [], credits: 0, note: "All selected clips are already rendered." };
    }

    const perClipCost = film.renderOn === "cloud" ? 20 : 0;
    const totalCredits = targets.length * perClipCost;
    if (film.renderOn === "cloud") {
      if (!this.state.cloudConnected) throw new ApiError(400, "cloud_not_connected", "Cloud not connected.");
      if (tokenEntry && tokenEntry.spendCap !== null && tokenEntry.spentCredits + totalCredits > tokenEntry.spendCap) {
        throw new ApiError(402, "exceeds_spend_cap", "Cloud render exceeds spend cap.");
      }
      if (this.state.creditBalance < totalCredits) {
        throw new ApiError(402, "exceeds_balance", "Insufficient cloud balance.");
      }
      this.state.creditBalance -= totalCredits;
      if (tokenEntry) tokenEntry.spentCredits += totalCredits;
    }

    const started = [];
    const held = [];
    film.rendersRunning = true;

    targets.forEach((c) => {
      if (c.link === "continue" && started.length > 0) {
        held.push({ clipId: c.id, number: sorted.indexOf(c) + 1, reason: "waits_for_previous_take" });
      }
      c.take = "rendering";
      started.push({ clipId: c.id, name: c.name });
    });
    this.save();

    // Parallel multi-GPU rendering when independent clips do not chain via link="continue"
    (async () => {
      const hw = await this.getHardware();
      const workers = await this.engineManager.probeAllWorkers(hw.gpus);
      const maxConcurrency = Math.max(1, workers.filter((w) => w.running).length);

      const renderSingleClip = async (clip, prevVideoPath = null) => {
        let startFramePath = null;
        if (clip.link === "continue" && prevVideoPath && fs.existsSync(prevVideoPath)) {
          try {
            const frameOut = path.join(this.outputsDir, `${clip.id}_continue_frame.png`);
            startFramePath = await extractLastFrame(prevVideoPath, frameOut);
          } catch {
            // fallback if clip cannot extract frame
          }
        }
        const prompt = (clip.shots || [])
          .map((s) => `${s.framing ? `[${s.framing}] ` : ""}${s.prompt || ""}${s.line ? ` "${s.line}"` : ""}`)
          .join(" -> ");
        const presetRef = clip.preset || (startFramePath ? film.presets.i2v : film.presets.r2v) || "ltx-2.5-video";
        const presetId = presetRef.includes(":") ? presetRef.split(":")[1] : presetRef;
        const cap = CAPABILITIES.find((c) => c.presetId === presetId) || CAPABILITIES.find((c) => c.mediaType === "video");

        const job = this.#createJobRecord({
          backend: film.renderOn,
          mediaType: "video",
          presetId: cap.presetId,
          packId: cap.packId,
          projectId: film.projectId,
          prompt,
          options: { aspectRatio: film.aspect, resolution: film.quality, durationSeconds: Math.min(clip.length, 10) },
        });
        return new Promise((resolve) => {
          this.#executeJobAsync(job, cap, {
            kind: "scene",
            inputFilePath: startFramePath,
            onComplete: (doneJob) => {
              const takeEntry = {
                generationId: doneJob.jobId,
                createdAt: doneJob.completedAt,
                resultPath: doneJob.resultPath,
                resultUrl: doneJob.resultUrl,
                posterUrl: doneJob.posterUrl,
              };
              clip.takes.unshift(takeEntry);
              clip.activeTakeId = doneJob.jobId;
              clip.resultPath = doneJob.resultPath;
              clip.resultUrl = doneJob.resultUrl;
              clip.posterUrl = doneJob.posterUrl;
              clip.take = "current";
              resolve(doneJob.resultPath);
            },
            onError: () => {
              clip.take = "none";
              resolve(null);
            },
          });
        });
      };

      // Group clips: linked chains execute sequentially; independent clips fan out across live GPUs
      let idx = 0;
      let lastPath = null;
      while (idx < targets.length) {
        const nextClip = targets[idx + 1];
        if (maxConcurrency > 1 && targets[idx].link !== "continue" && (!nextClip || nextClip.link !== "continue")) {
          const batch = [];
          while (idx < targets.length && batch.length < maxConcurrency) {
            if (targets[idx].link === "continue") break;
            if (targets[idx + 1]?.link === "continue" && batch.length > 0) break;
            batch.push(targets[idx++]);
          }
          const paths = await Promise.all(batch.map((c) => renderSingleClip(c, null)));
          lastPath = paths[paths.length - 1] || lastPath;
        } else {
          lastPath = await renderSingleClip(targets[idx++], lastPath);
        }
      }

      film.rendersRunning = false;
      this.save();
    })();

    return { started, held, credits: totalCredits };
  }

  listTakes(filmId, clipRef) {
    const film = this.#getFilmRaw(filmId);
    const clip = this.#findClip(film, clipRef);
    return {
      clipId: clip.id,
      activeTakeId: clip.activeTakeId,
      takes: clip.takes.map((t, i) => ({
        number: i + 1,
        active: t.generationId === clip.activeTakeId,
        ...t,
      })),
    };
  }

  useTake(filmId, clipRef, generationId) {
    const film = this.#getFilmRaw(filmId);
    const clip = this.#findClip(film, clipRef);
    const take = clip.takes.find((t) => t.generationId === generationId);
    if (!take) throw new ApiError(404, "not_found", `Take not found: ${generationId}`);
    this.#pushUndoSnapshot(film);
    clip.activeTakeId = take.generationId;
    clip.resultPath = take.resultPath;
    clip.resultUrl = take.resultUrl;
    clip.posterUrl = take.posterUrl;
    clip.take = "current";
    this.save();
    return { change: "switched_take", timeline: this.getFilm(filmId) };
  }

  async exportFilm(filmId) {
    const film = this.#getFilmRaw(filmId);
    const sorted = [...film.clips].sort((a, b) => a.at - b.at);
    const notReady = sorted.filter((c) => !c.resultPath || c.take === "rendering" || c.take === "none");
    if (notReady.length > 0) {
      throw new ApiError(409, "clips_not_ready", "Render all clips before exporting.", {
        clips: notReady.map((c) => c.name || c.id),
      });
    }
    const { width, height } = resolveDimensions(film.aspect, film.quality);
    const outName = `${film.id}_export_${Date.now()}.mp4`;
    const outPath = path.join(this.outputsDir, outName);
    await stitchFilmWithFfmpeg({
      outPath,
      clips: sorted,
      tracks: film.tracks,
      width,
      height,
      exportRange: film.exportRange,
    });
    const resultUrl = `/media/outputs/${outName}`;
    film.lastExportUrl = resultUrl;
    film.lastExportPath = outPath;
    this.save();
    return { path: outPath, resultUrl, blanks: [] };
  }
}
