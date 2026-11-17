// src/server/comfy-engine.js
// Real ComfyUI local engine installer (official ComfyUI release + Python venv + PyTorch CUDA/CPU)
// and real child-process supervisor with attach-to-existing ComfyUI support.

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

  async probeHttp() {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 1200);
      const res = await fetch(`${this.comfyUrl}/system_stats`, { signal: controller.signal });
      clearTimeout(t);
      if (!res.ok) return { running: false };
      const stats = await res.json();
      return { running: true, stats };
    } catch {
      return { running: false };
    }
  }

  writeExtraModelPathsConfig(comfyDir) {
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

  async #runLoggedCommand(cmd, args, cwd) {
    return new Promise((resolve, reject) => {
      this.log(`$ ${cmd} ${args.join(" ")}`);
      const proc = spawn(cmd, args, { cwd, windowsHide: true });
      proc.stdout.on("data", (d) => {
        for (const l of d.toString("utf8").split(/\r?\n/)) {
          if (l.trim()) this.log(l);
        }
      });
      proc.stderr.on("data", (d) => {
        for (const l of d.toString("utf8").split(/\r?\n/)) {
          if (l.trim()) this.log(l);
        }
      });
      proc.on("error", reject);
      proc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`${cmd} exited with code ${code}`));
      });
    });
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
        this.log(`Downloading ComfyUI ${COMFYUI_RELEASE_VERSION} from ${COMFYUI_TARBALL_URL}...`);
        const res = await fetch(COMFYUI_TARBALL_URL, { redirect: "follow" });
        if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
        await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tgzPath));

        this.installStage = "extracting_comfyui";
        this.log("Extracting ComfyUI archive...");
        await execFileAsync("tar", ["-xzf", tgzPath, "-C", this.engineDir], { timeout: 60000 });
        const extracted = path.join(this.engineDir, `ComfyUI-${COMFYUI_RELEASE_VERSION.replace(/^v/, "")}`);
        if (fs.existsSync(extracted) && !fs.existsSync(comfyTarget)) {
          fs.renameSync(extracted, comfyTarget);
        }
      }

      const venvDir = path.join(this.engineDir, "venv");
      if (!fs.existsSync(venvDir)) {
        this.installStage = "creating_python_venv";
        this.log("Creating isolated Python virtual environment...");
        const sysPy = process.platform === "win32" ? "python" : "python3";
        await this.#runLoggedCommand(sysPy, ["-m", "venv", venvDir], this.engineDir);
      }

      const pyBin = this.getPythonBin();
      this.installStage = "installing_pytorch";
      if (cudaSupported) {
        this.log("Installing PyTorch with CUDA 12.4 support...");
        await this.#runLoggedCommand(
          pyBin,
          ["-m", "pip", "install", "--upgrade", "torch", "torchvision", "torchaudio", "--index-url", "https://download.pytorch.org/whl/cu124"],
          comfyTarget
        );
      } else {
        this.log("No NVIDIA CUDA GPU detected — installing CPU PyTorch wheels...");
        await this.#runLoggedCommand(
          pyBin,
          ["-m", "pip", "install", "--upgrade", "torch", "torchvision", "torchaudio"],
          comfyTarget
        );
      }

      this.installStage = "installing_requirements";
      this.log("Installing ComfyUI requirements.txt...");
      await this.#runLoggedCommand(pyBin, ["-m", "pip", "install", "-r", "requirements.txt"], comfyTarget);

      this.writeExtraModelPathsConfig(comfyTarget);
      this.installStage = "installed";
      this.log("ComfyUI engine installation complete!");
      return { status: "installed", comfyDir: comfyTarget };
    } catch (err) {
      this.installStage = `failed: ${err.message}`;
      this.log(`Install error: ${err.message}`);
      throw err;
    } finally {
      this.installing = false;
    }
  }

  async startEngine({ allowCpuFallback = true, cudaSupported = false } = {}) {
    const probe = await this.probeHttp();
    if (probe.running) {
      this.attachedExternal = !this.child;
      return {
        engineRunning: true,
        alreadyRunning: true,
        engineStarting: false,
        mode: this.child ? "managed" : "attached-external",
        systemStats: probe.stats,
      };
    }

    const comfyDir = this.getComfyDir();
    if (!comfyDir) {
      const err = new Error(
        "ComfyUI engine is not installed. Click 'Install Local Engine' in Settings or start ComfyUI on port 8188."
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

    const yamlPath = this.writeExtraModelPathsConfig(comfyDir);
    const pyBin = this.getPythonBin();
    const port = new URL(this.comfyUrl).port || "8188";
    const args = [
      "main.py",
      "--listen",
      "127.0.0.1",
      "--port",
      port,
      "--extra-model-paths-config",
      yamlPath,
    ];
    if (!cudaSupported) {
      args.push("--cpu");
    }

    this.log(`Starting ComfyUI: ${pyBin} ${args.join(" ")}`);
    const child = spawn(pyBin, args, { cwd: comfyDir, windowsHide: true });
    this.child = child;
    this.attachedExternal = false;

    child.stdout.on("data", (d) => {
      for (const l of d.toString("utf8").split(/\r?\n/)) {
        if (l.trim()) this.log(`[ComfyUI] ${l}`);
      }
    });
    child.stderr.on("data", (d) => {
      for (const l of d.toString("utf8").split(/\r?\n/)) {
        if (l.trim()) this.log(`[ComfyUI] ${l}`);
      }
    });
    child.on("exit", (code) => {
      this.log(`[ComfyUI] Process exited with code ${code}`);
      if (this.child === child) this.child = null;
    });

    // Wait up to 6 seconds for cold boot readiness; if still booting return engineStarting: true (202)
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 400));
      if (!this.child) break;
      const p = await this.probeHttp();
      if (p.running) {
        return { engineRunning: true, engineStarting: false, mode: "managed", systemStats: p.stats };
      }
    }

    return { engineRunning: false, engineStarting: Boolean(this.child), mode: "managed" };
  }

  async stopEngine() {
    try {
      await fetch(`${this.comfyUrl}/free`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unload_models: true, free_memory: true }),
      });
    } catch {
      // ignore if unreachable
    }
    if (this.child) {
      this.child.kill();
      this.child = null;
      this.log("Stopped managed ComfyUI process.");
    }
    this.attachedExternal = false;
    return { engineRunning: false };
  }

  async restartEngine(opts) {
    await this.stopEngine();
    await new Promise((r) => setTimeout(r, 400));
    return this.startEngine(opts);
  }
}
