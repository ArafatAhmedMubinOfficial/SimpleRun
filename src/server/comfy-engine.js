// src/server/comfy-engine.js
// Real ComfyUI multi-GPU local engine installer (official ComfyUI release + Python venv + PyTorch CUDA/CPU)
// and multi-worker child-process supervisor (1 worker per CUDA GPU via CUDA_VISIBLE_DEVICES + least-busy scheduler).

import fs from "node:fs";
import path from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { ensureModelDirectories } from "./model-manager.js";

const execFileAsync = promisify(execFile);

export const COMFYUI_RELEASE_VERSION = "v0.3.14";
export const COMFYUI_TARBALL_URL = `https://codeload.github.com/comfyanonymous/ComfyUI/tar.gz/refs/tags/${COMFYUI_RELEASE_VERSION}`;

export class ComfyEngineManager {
  constructor({ engineDir, modelsDir, comfyUrl = "http://127.0.0.1:8188", externalComfyDir = "" }) {
    this.engineDir = engineDir;
    this.modelsDir = modelsDir;
    this.comfyUrl = comfyUrl;
    this.externalComfyDir = externalComfyDir;
    this.child = null;
    this.workers = []; // [{ gpuIndex, gpuName, port, comfyUrl, child, attachedExternal, activeJobs, totalCompleted, running, stats }]
    this.rrCursor = 0;
    this.attachedExternal = false;
    this.installing = false;
    this.installStage = null;
    this.logs = [];
  }

  log(line) {
    const entry = `[${new Date().toISOString()}] ${line}`;
    this.logs.push(entry);
    if (this.logs.length > 400) this.logs.shift();
  }

  parseConfiguredUrls() {
    const parts = String(this.comfyUrl || "http://127.0.0.1:8188")
      .split(",")
      .map((s) => s.trim().replace(/\/+$/, ""))
      .filter(Boolean);
    return parts.length > 0 ? parts : ["http://127.0.0.1:8188"];
  }

  getComfyDir() {
    if (this.externalComfyDir && fs.existsSync(path.join(this.externalComfyDir, "main.py"))) {
      return this.externalComfyDir;
    }
    const embedded = path.join(this.engineDir, "ComfyUI");
    if (fs.existsSync(path.join(embedded, "main.py"))) {
      return embedded;
    }
    return null;
  }

  getPythonBin() {
    const isWin = process.platform === "win32";
    const venvPython = isWin
      ? path.join(this.engineDir, "venv", "Scripts", "python.exe")
      : path.join(this.engineDir, "venv", "bin", "python");
    if (fs.existsSync(venvPython)) return venvPython;
    return isWin ? "python" : "python3";
  }

  isInstalled() {
    return Boolean(this.getComfyDir());
  }

  async #probeSingleUrl(baseUrl) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 1200);
      const res = await fetch(`${baseUrl}/system_stats`, { signal: controller.signal });
      clearTimeout(t);
      if (!res.ok) return { running: false, url: baseUrl };
      const stats = await res.json();
      return { running: true, url: baseUrl, stats };
    } catch {
      return { running: false, url: baseUrl };
    }
  }

  async probeHttp() {
    const urls = this.parseConfiguredUrls();
    const first = await this.#probeSingleUrl(urls[0]);
    if (first.running) return first;
    // Also check if another managed worker is alive
    for (const w of this.workers) {
      const p = await this.#probeSingleUrl(w.comfyUrl);
      if (p.running) return p;
    }
    return first;
  }

  async probeAllWorkers(gpus = []) {
    const urls = this.parseConfiguredUrls();
    const firstParsed = new URL(urls[0]);
    const basePort = Number(firstParsed.port) || 8188;
    const baseOriginPrefix = `${firstParsed.protocol}//${firstParsed.hostname}`;
    const cudaGpus = gpus.filter((g) => g.cudaSupported);

    // If no managed workers exist yet, synthesize probe targets from explicit URLs or GPU count
    if (this.workers.length === 0) {
      const candidates =
        urls.length > 1
          ? urls.map((u, i) => ({
              gpuIndex: cudaGpus[i]?.index ?? i,
              gpuName: cudaGpus[i]?.name || `ComfyUI Worker #${i}`,
              port: Number(new URL(u).port) || basePort + i,
              comfyUrl: u,
            }))
          : Array.from({ length: Math.max(1, cudaGpus.length) }, (_, i) => ({
              gpuIndex: cudaGpus[i]?.index ?? i,
              gpuName: cudaGpus[i]?.name || gpus[0]?.name || "ComfyUI Worker #0",
              port: basePort + i,
              comfyUrl: `${baseOriginPrefix}:${basePort + i}`,
            }));

      const probed = await Promise.all(
        candidates.map(async (c) => {
          const p = await this.#probeSingleUrl(c.comfyUrl);
          return {
            gpuIndex: c.gpuIndex,
            gpuName: c.gpuName,
            port: c.port,
            comfyUrl: c.comfyUrl,
            running: p.running,
            attachedExternal: p.running,
            activeJobs: 0,
            totalCompleted: 0,
            stats: p.stats || null,
          };
        })
      );
      return probed;
    }

    await Promise.all(
      this.workers.map(async (w) => {
        const p = await this.#probeSingleUrl(w.comfyUrl);
        w.running = p.running;
        if (p.stats) w.stats = p.stats;
      })
    );
    return this.workers.map((w) => ({
      gpuIndex: w.gpuIndex,
      gpuName: w.gpuName,
      port: w.port,
      comfyUrl: w.comfyUrl,
      running: Boolean(w.running),
      attachedExternal: Boolean(w.attachedExternal),
      activeJobs: w.activeJobs || 0,
      totalCompleted: w.totalCompleted || 0,
      stats: w.stats || null,
    }));
  }

  /**
   * Picks the least-busy live ComfyUI GPU worker (with round-robin tie breaking)
   * so multi-image batches, concurrent jobs, and multi-clip video renders distribute across all GPUs.
   */
  async acquireWorker(gpus = []) {
    const probed = await this.probeAllWorkers(gpus);
    // Sync worker pool objects when external workers are discovered dynamically
    if (this.workers.length === 0) {
      const liveExternal = probed.filter((w) => w.running);
      if (liveExternal.length > 0) {
        this.workers = liveExternal.map((w) => ({ ...w, child: null }));
      }
    }

    const live = this.workers.filter((w) => w.running);
    if (live.length === 0) return null;

    let minActive = Infinity;
    for (const w of live) {
      if ((w.activeJobs || 0) < minActive) minActive = w.activeJobs || 0;
    }
    const candidates = live.filter((w) => (w.activeJobs || 0) === minActive);
    const picked = candidates[this.rrCursor % candidates.length];
    this.rrCursor = (this.rrCursor + 1) % Math.max(1, candidates.length);
    picked.activeJobs = (picked.activeJobs || 0) + 1;

    let released = false;
    return {
      comfyUrl: picked.comfyUrl,
      port: picked.port,
      gpuIndex: picked.gpuIndex,
      gpuName: picked.gpuName,
      workerCount: live.length,
      release: (succeeded = true) => {
        if (released) return;
        released = true;
        picked.activeJobs = Math.max(0, (picked.activeJobs || 1) - 1);
        if (succeeded) picked.totalCompleted = (picked.totalCompleted || 0) + 1;
      },
    };
  }

  writeExtraModelPathsConfig() {
    ensureModelDirectories(this.modelsDir);
    const yamlPath = path.join(this.engineDir, "extra_model_paths.yaml");
    const normModels = this.modelsDir.replace(/\\/g, "/");
    const content = [
      "simpletun:",
      `    base_path: ${normModels}`,
      "    checkpoints: checkpoints/",
      "    diffusion_models: diffusion_models/",
      "    unet: unet/",
      "    vae: vae/",
      "    loras: loras/",
      "    clip: clip/",
      "    text_encoders: text_encoders/",
      "    upscale_models: upscale_models/",
      "    controlnet: controlnet/",
      "",
    ].join("\n");
    fs.mkdirSync(path.dirname(yamlPath), { recursive: true });
    fs.writeFileSync(yamlPath, content, "utf8");
    return yamlPath;
  }

  async #runLoggedCommand(cmd, args, cwd, timeoutMs = 15 * 60 * 1000) {
    return new Promise((resolve, reject) => {
      this.log(`$ ${cmd} ${args.join(" ")}`);
      const proc = spawn(cmd, args, { cwd, windowsHide: true });
      const timer = setTimeout(() => {
        try { proc.kill(); } catch { /* ignore */ }
        reject(new Error(`${cmd} timed out after ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs);
      const handleOutput = (d) => {
        for (const l of d.toString("utf8").split(/[\r\n]+/)) {
          const clean = l.trim();
          if (clean) this.log(clean);
        }
      };
      proc.stdout.on("data", handleOutput);
      proc.stderr.on("data", handleOutput);
      proc.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      proc.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`${cmd} exited with code ${code}`));
      });
    });
  }

  async #downloadComfyArchive(comfyTarget, tgzPath) {
    // 1. Prefer git clone --depth 1 (fastest, IPv4/HTTP2, live % progress)
    try {
      await this.#runLoggedCommand(
        "git",
        ["clone", "--depth", "1", "--branch", COMFYUI_RELEASE_VERSION, "--progress", "https://github.com/comfyanonymous/ComfyUI.git", comfyTarget],
        this.engineDir,
        3 * 60 * 1000
      );
      if (fs.existsSync(path.join(comfyTarget, "main.py"))) return;
    } catch (gitErr) {
      this.log(`git clone fallback (${gitErr.message}) -> trying curl IPv4 tarball...`);
      if (fs.existsSync(comfyTarget)) fs.rmSync(comfyTarget, { recursive: true, force: true });
    }

    // 2. Prefer curl -4 (forces IPv4 so dual-stack/Docker IPv6 drops never stall)
    let downloaded = false;
    try {
      await this.#runLoggedCommand(
        "curl",
        ["-4", "-fSL", "--connect-timeout", "15", "--max-time", "180", "-o", tgzPath, COMFYUI_TARBALL_URL],
        this.engineDir,
        4 * 60 * 1000
      );
      downloaded = fs.existsSync(tgzPath) && fs.statSync(tgzPath).size > 100000;
    } catch (curlErr) {
      this.log(`curl fallback (${curlErr.message}) -> trying Node fetch with 30s stall timeout...`);
    }

    // 3. Node fetch fallback with stall watchdog and byte progress
    if (!downloaded) {
      const ac = new AbortController();
      let stallTimer = setTimeout(() => ac.abort(new Error("ComfyUI download stalled (>30s no data)")), 30000);
      const resetStall = () => {
        clearTimeout(stallTimer);
        stallTimer = setTimeout(() => ac.abort(new Error("ComfyUI download stalled (>30s no data)")), 30000);
      };
      try {
        const res = await fetch(COMFYUI_TARBALL_URL, { redirect: "follow", signal: ac.signal });
        if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
        const reader = Readable.fromWeb(res.body);
        const ws = fs.createWriteStream(tgzPath);
        let bytes = 0;
        let lastLog = Date.now();
        reader.on("data", (chunk) => {
          resetStall();
          bytes += chunk.length;
          if (Date.now() - lastLog > 1200) {
            lastLog = Date.now();
            this.log(`Downloaded ${(bytes / (1024 * 1024)).toFixed(1)} MB...`);
          }
        });
        await pipeline(reader, ws);
        this.log(`Downloaded archive (${(bytes / (1024 * 1024)).toFixed(1)} MB).`);
      } finally {
        clearTimeout(stallTimer);
      }
    }

    this.installStage = "extracting_comfyui";
    this.log("Extracting ComfyUI archive...");
    await execFileAsync("tar", ["-xzf", tgzPath, "-C", this.engineDir], { timeout: 60000 });
    const extracted = path.join(this.engineDir, `ComfyUI-${COMFYUI_RELEASE_VERSION.replace(/^v/, "")}`);
    if (fs.existsSync(extracted) && !fs.existsSync(comfyTarget)) {
      fs.renameSync(extracted, comfyTarget);
    }
  }

  async #probeTorchInPython(pyCmd) {
    try {
      const { stdout } = await execFileAsync(
        pyCmd,
        ["-c", "import torch; print(torch.__version__); print(1 if torch.cuda.is_available() else 0)"],
        { timeout: 10000 }
      );
      const lines = String(stdout).trim().split(/\r?\n/);
      return { installed: true, version: lines[0] || "unknown", cuda: lines[1] === "1" };
    } catch {
      return { installed: false, version: null, cuda: false };
    }
  }

  async installLocalEngine({ cudaSupported = true } = {}) {
    if (this.installing) {
      return { status: "already_installing", stage: this.installStage };
    }
    this.installing = true;
    this.installStage = "downloading_comfyui";
    fs.mkdirSync(this.engineDir, { recursive: true });

    try {
      const comfyTarget = path.join(this.engineDir, "ComfyUI");
      const tgzPath = path.join(this.engineDir, `ComfyUI-${COMFYUI_RELEASE_VERSION}.tar.gz`);

      if (!fs.existsSync(path.join(comfyTarget, "main.py"))) {
        this.log(`Downloading ComfyUI ${COMFYUI_RELEASE_VERSION} (fast git/curl IPv4)...`);
        await this.#downloadComfyArchive(comfyTarget, tgzPath);
      }

      const sysPy = process.platform === "win32" ? "python" : "python3";
      const sysTorch = await this.#probeTorchInPython(sysPy);
      if (sysTorch.installed) {
        this.log(`Detected pre-installed system PyTorch ${sysTorch.version} (CUDA=${sysTorch.cuda}).`);
      }

      const venvDir = path.join(this.engineDir, "venv");
      if (!fs.existsSync(venvDir)) {
        this.installStage = "creating_python_venv";
        const useSysSite = sysTorch.installed && (!cudaSupported || sysTorch.cuda);
        this.log(`Creating Python virtual environment${useSysSite ? " (--system-site-packages to reuse PyTorch)" : ""}...`);
        try {
          const venvArgs = useSysSite ? ["-m", "venv", "--system-site-packages", venvDir] : ["-m", "venv", venvDir];
          await this.#runLoggedCommand(sysPy, venvArgs, this.engineDir);
        } catch (venvErr) {
          this.log(`venv unavailable (${venvErr.message}); falling back to system ${sysPy}.`);
          if (fs.existsSync(venvDir)) fs.rmSync(venvDir, { recursive: true, force: true });
        }
      }

      const pyBin = this.getPythonBin();
      const envTorch = await this.#probeTorchInPython(pyBin);
      if (envTorch.installed && (!cudaSupported || envTorch.cuda)) {
        this.log(`Reusing PyTorch ${envTorch.version} (CUDA=${envTorch.cuda}) — skipping 3.5 GB wheel download.`);
      } else {
        this.installStage = "installing_pytorch";
        if (cudaSupported) {
          this.log("Installing PyTorch with CUDA 12.4 support...");
          await this.#runLoggedCommand(
            pyBin,
            ["-m", "pip", "install", "--prefer-binary", "--upgrade", "torch", "torchvision", "torchaudio", "--index-url", "https://download.pytorch.org/whl/cu124"],
            comfyTarget
          );
        } else {
          this.log("No NVIDIA CUDA GPU detected — installing CPU PyTorch wheels...");
          await this.#runLoggedCommand(
            pyBin,
            ["-m", "pip", "install", "--prefer-binary", "--upgrade", "torch", "torchvision", "torchaudio"],
            comfyTarget
          );
        }
      }

      this.installStage = "installing_requirements";
      this.log("Installing ComfyUI requirements.txt...");
      await this.#runLoggedCommand(pyBin, ["-m", "pip", "install", "--prefer-binary", "-r", "requirements.txt"], comfyTarget);

      this.writeExtraModelPathsConfig();
      this.installStage = "installed";
      this.log("ComfyUI engine installation complete! Click 'Start Multi-GPU Engine' to boot workers.");
      return { status: "installed", comfyDir: comfyTarget };
    } catch (err) {
      this.installStage = `failed: ${err.message}`;
      this.log(`Install error: ${err.message}`);
      throw err;
    } finally {
      this.installing = false;
    }
  }

  async startEngine({ allowCpuFallback = true, cudaSupported = false, gpus = [] } = {}) {
    // 1. Check already-running external or managed ComfyUI workers first
    const urls = this.parseConfiguredUrls();
    const cudaGpus = gpus.filter((g) => g.cudaSupported);
    const existingProbes = await Promise.all(urls.map((u) => this.#probeSingleUrl(u)));
    const anyAlreadyRunning = existingProbes.some((p) => p.running);
    if (anyAlreadyRunning) {
      this.attachedExternal = !this.child;
      if (this.workers.length === 0) {
        this.workers = existingProbes
          .map((p, i) => ({
            gpuIndex: cudaGpus[i]?.index ?? i,
            gpuName: cudaGpus[i]?.name || gpus[0]?.name || `External GPU #${i}`,
            port: Number(new URL(p.url).port) || 8188 + i,
            comfyUrl: p.url,
            child: null,
            attachedExternal: true,
            activeJobs: 0,
            totalCompleted: 0,
            running: p.running,
            stats: p.stats || null,
          }))
          .filter((w) => w.running);
      }
      return {
        engineRunning: true,
        alreadyRunning: true,
        engineStarting: false,
        workerCount: this.workers.filter((w) => w.running).length || 1,
        mode: this.child ? "managed-multi-gpu" : "attached-external",
        systemStats: existingProbes.find((p) => p.running)?.stats,
      };
    }

    const comfyDir = this.getComfyDir();
    if (!comfyDir) {
      const err = new Error(
        "ComfyUI engine is not installed. Click 'Install ComfyUI + PyTorch Engine' in Settings or start ComfyUI on port 8188."
      );
      err.status = 409;
      err.errorCode = "engine_not_installed";
      throw err;
    }

    if (!cudaSupported && !allowCpuFallback) {
      const err = new Error("Unsupported GPU hardware: CUDA sm_75+ NVIDIA GPU required when CPU fallback is disabled.");
      err.status = 409;
      err.errorCode = "engine_unsupported_hardware";
      throw err;
    }

    const yamlPath = this.writeExtraModelPathsConfig();
    const pyBin = this.getPythonBin();
    const firstUrl = new URL(urls[0]);
    const basePort = Number(firstUrl.port) || 8188;
    const baseHost = firstUrl.hostname || "127.0.0.1";

    const workerSpecs =
      cudaGpus.length > 0
        ? cudaGpus.map((gpu, i) => ({
            gpuIndex: gpu.index,
            gpuName: gpu.name,
            port: basePort + i,
            comfyUrl: `${firstUrl.protocol}//${baseHost}:${basePort + i}`,
            cpuOnly: false,
          }))
        : [
            {
              gpuIndex: 0,
              gpuName: gpus[0]?.name || "CPU",
              port: basePort,
              comfyUrl: `${firstUrl.protocol}//${baseHost}:${basePort}`,
              cpuOnly: true,
            },
          ];

    this.workers = [];
    for (const spec of workerSpecs) {
      const args = [
        "main.py",
        "--listen",
        "127.0.0.1",
        "--port",
        String(spec.port),
        "--extra-model-paths-config",
        yamlPath,
      ];
      const env = { ...process.env };
      if (spec.cpuOnly) {
        args.push("--cpu");
      } else {
        env.CUDA_VISIBLE_DEVICES = String(spec.gpuIndex);
      }

      this.log(`Starting GPU #${spec.gpuIndex} (${spec.gpuName}) on :${spec.port} -> ${pyBin} ${args.join(" ")}`);
      const child = spawn(pyBin, args, { cwd: comfyDir, env, windowsHide: true });
      const worker = {
        gpuIndex: spec.gpuIndex,
        gpuName: spec.gpuName,
        port: spec.port,
        comfyUrl: spec.comfyUrl,
        child,
        attachedExternal: false,
        activeJobs: 0,
        totalCompleted: 0,
        running: false,
        stats: null,
      };
      this.workers.push(worker);
      if (!this.child) this.child = child;

      child.stdout.on("data", (d) => {
        for (const l of d.toString("utf8").split(/\r?\n/)) {
          if (l.trim()) this.log(`[GPU ${spec.gpuIndex}:${spec.port}] ${l}`);
        }
      });
      child.stderr.on("data", (d) => {
        for (const l of d.toString("utf8").split(/\r?\n/)) {
          if (l.trim()) this.log(`[GPU ${spec.gpuIndex}:${spec.port}] ${l}`);
        }
      });
      child.on("exit", (code) => {
        this.log(`[GPU ${spec.gpuIndex}:${spec.port}] Process exited with code ${code}`);
        worker.child = null;
        worker.running = false;
        if (this.child === child) {
          this.child = this.workers.find((w) => w.child)?.child || null;
        }
      });
    }

    // Wait up to 6 seconds for at least 1 worker to pass /system_stats
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 400));
      if (!this.workers.some((w) => w.child)) break;
      const probed = await this.probeAllWorkers(gpus);
      const liveWorkers = probed.filter((w) => w.running);
      if (liveWorkers.length > 0) {
        return {
          engineRunning: true,
          engineStarting: liveWorkers.length < this.workers.length,
          workerCount: liveWorkers.length,
          totalWorkers: this.workers.length,
          mode: this.workers.length > 1 ? "managed-multi-gpu" : "managed",
          systemStats: liveWorkers[0].stats,
        };
      }
    }

    return {
      engineRunning: false,
      engineStarting: this.workers.some((w) => Boolean(w.child)),
      workerCount: 0,
      totalWorkers: this.workers.length,
      mode: this.workers.length > 1 ? "managed-multi-gpu" : "managed",
    };
  }

  async stopEngine() {
    const urlsToFree = new Set([...this.parseConfiguredUrls(), ...this.workers.map((w) => w.comfyUrl)]);
    await Promise.all(
      Array.from(urlsToFree).map(async (u) => {
        try {
          await fetch(`${u}/free`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ unload_models: true, free_memory: true }),
          });
        } catch {
          // ignore if unreachable
        }
      })
    );

    for (const w of this.workers) {
      if (w.child) {
        try { w.child.kill(); } catch { /* ignore */ }
        w.child = null;
      }
      w.running = false;
    }
    this.workers = [];
    if (this.child) {
      try { this.child.kill(); } catch { /* ignore */ }
      this.child = null;
    }
    this.attachedExternal = false;
    this.log("Stopped all managed ComfyUI GPU workers.");
    return { engineRunning: false, workerCount: 0 };
  }

  async restartEngine(opts) {
    await this.stopEngine();
    await new Promise((r) => setTimeout(r, 400));
    return this.startEngine(opts);
  }
}
