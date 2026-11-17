<div align="center">

# SimpleTun

**Open-source ComfyUI orchestration studio, multi-clip AI video timeline, and 74-tool MCP server**

[![License: MIT](https://img.shields.io/badge/License-MIT-cyan.svg)](./LICENSE)
[![Node.js >= 20](https://img.shields.io/badge/Node.js-%E2%89%A5%2020-339933.svg?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Dependencies](https://img.shields.io/badge/Runtime%20Dependencies-0%20(Zero%20npm%20deps)-blue.svg)](#quick-start-any-computer)
[![MCP Tools](https://img.shields.io/badge/MCP%20Tools-74%20Implemented-8b5cf6.svg)](#connecting-ai-agents-mcp)
[![REA Audited](https://img.shields.io/badge/REA-Verified%20%26%20Audited-10b981.svg)](./docs/REA_FORENSIC_REPORT.md)

*An MIT-licensed clean-room open-source clone of [SimpliGen](https://www.simpligen.io/), architected and verified using [REA (`rea-agents`)](https://github.com/morluto/rea).*

</div>

---

## Table of Contents

- [Features](#features)
- [How Execution Modes Work](#how-execution-modes-work)
- [Quick Start (Any Computer)](#quick-start-any-computer)
  - [Windows Setup](#windows)
  - [macOS Setup](#macos)
  - [Linux Setup](#linux)
- [Running on an NVIDIA GPU PC (Real Local ComfyUI)](#running-on-an-nvidia-gpu-pc)
- [Running in Electron Desktop Mode](#running-in-electron-desktop-mode)
- [Connecting AI Agents (MCP)](#connecting-ai-agents-mcp)
- [Environment Variables & Control API](#environment-variables--control-api)
- [Testing & REA Forensics](#testing--rea-forensics)
- [Architecture](#architecture)

---

## Features

| Studio / Component | What It Does |
|---|---|
| **3-Step Prompt Builder** | Guided workflow (`Media Type` -> `Style Preset` -> `Prompt & Render`) supporting Text-to-Image, Image Editing, Text-to-Video, Image-to-Video, negative prompts, and LoRA stacking. |
| **Real Hardware & ComfyUI Supervisor** | Probes GPUs (`nvidia-smi` CSV query + Windows CIM `Win32_VideoController` fallback), system RAM, and free disk space; installs ComfyUI (`v0.3.14`) + Python `venv` + PyTorch CUDA/CPU or attaches to an existing ComfyUI server. |
| **ComfyUI Graph Compiler & PNG Metadata** | Compiles clean-room node graphs (`checkpoint-t2i`, `flux-unet`, `wan-video`, `ltx-video`, `upscale`), executes over HTTP (`/upload/image`, `/prompt`, `/history`, `/view`) and WebSocket (`/ws`), and embeds `prompt` `tEXt` metadata into output PNGs. |
| **Disk Model Manager & Downloader** | Recursively scans `checkpoints/`, `diffusion_models/`, `unet/`, `vae/`, `loras/`, etc., parses binary `.safetensors` headers (`8`-byte LE length + JSON metadata), labels `Managed` vs `External` vs `Not in a model folder`, and streams resumable HuggingFace / Civitai downloads. |
| **Character Studio** | Creates consistent identity-anchored characters (`generate` or uploaded reference), scene stills, facial/image enhancement, and steady-face animation. |
| **Video Studio (`/video-studio`)** | Multi-lane film timeline (`Clips`, `Audio`, `Markers`), `ffmpeg` + WAV PCM onset autocorrelation BPM & beat-offset detector (`400 no_pulse` on silent tracks), `@Cast` mentions, dialogue lip-sync metadata, `link: "continue"` last-frame extraction, `Ctrl+Z`/`Ctrl+Y` undo/redo, and `ffmpeg` MP4 stitching. |
| **Product, UGC & Recipe Studio** | Multi-step node pipelines with `{{variable}}` template interpolation, atomic plan validation, and batch product/UGC ad generation. |
| **BYOK Cloud Providers** | Direct REST execution against OpenAI Images (`GPT Image`), Google AI Studio (`Imagen` / `Veo`), and HuggingFace Inference API using your own API keys. |
| **74-Tool MCP Server** | Zero-dependency stdio JSON-RPC server (`packages/mcp-server/src/bin.js`) compatible with Claude Code, Cursor, Windsurf, Codex, and Gemini CLI. |

---

## How Execution Modes Work

SimpleTun runs cleanly on **any computer** by choosing the backend that matches your hardware:

1. **Real Local GPU Engine (`comfyui`)** — Runs ComfyUI (`127.0.0.1:8188` by default) on NVIDIA CUDA hardware (or CPU if enabled). Enable **Strict Real Engine Mode** in the top-left Engine popover so local jobs explicitly require a live ComfyUI process + model weights on disk and refuse any procedural fallback.
2. **Cloud / BYOK REST APIs (`openai`, `google`, `huggingface-cloud`)** — Add your own API keys in **Model Manager -> Download Tokens & BYOK API Keys** to run remote inference with zero local VRAM.
3. **Zero-Setup Sandbox (`fallback-synthesizer`)** — When no ComfyUI server is running and **Strict Real Engine Mode** is off, local jobs generate synthetic PNGs (`zlib`) and MP4 clips (`ffmpeg` or synthetic frames) embedded with compiled ComfyUI workflow metadata so you can test the UI, Video Studio timeline, and MCP tool automation on laptops/VMs without a GPU.

> For a deep dive into multi-OS installation, ComfyUI configuration, and troubleshooting, read the full **[Cross-Platform Setup Guide](./docs/SETUP_GUIDE.md)**.

---

## Quick Start (Any Computer)

**Core Prerequisites:**
- **Node.js `>= 20`** (`node -v`) — SimpleTun has **zero required npm runtime dependencies**.
- **`ffmpeg`** — Required for Video Studio audio MP3/OGG decoding, last-frame extraction, and MP4 stitching.
- **Python `3.10–3.12` + NVIDIA CUDA GPU** *(optional — only needed for local ComfyUI image/video weights)*.

### Windows

```powershell
# 1. Verify Node.js (>= 20) and install ffmpeg if missing
winget install OpenJS.NodeJS.LTS
winget install Gyan.FFmpeg

# 2. Clone and run SimpleTun (no npm install required for core server)
git clone https://github.com/ArafatAhmedMubinOfficial/SimpleRun.git
cd SimpleRun
npm start
```

### macOS

```bash
# 1. Install Node.js (>= 20) and ffmpeg via Homebrew
brew install node ffmpeg

# 2. Clone and run SimpleTun
git clone https://github.com/ArafatAhmedMubinOfficial/SimpleRun.git
cd SimpleRun
npm start
```

*(macOS does not support NVIDIA CUDA ComfyUI packs locally; use **BYOK Cloud Keys**, an external remote ComfyUI URL, or sandbox mode.)*

### Linux & Cloud GPU Servers (Ubuntu / Debian / Arch)

> **Important:** Default `apt install nodejs` on Ubuntu/Debian often installs an old **Node v12** build, which fails with `SyntaxError: Unexpected token '.'`. Always install **Node.js 22 LTS** (or `>= 20`) first:

```bash
# 1. Install Node.js 22 LTS + system dependencies (Ubuntu / Debian)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs ffmpeg python3 python3-venv tar

# Running inside a root Docker container without curl/sudo? Use portable binary or install curl first:
# apt-get update && apt-get install -y curl xz-utils && curl -fsSL https://nodejs.org/dist/v22.14.0/node-v22.14.0-linux-x64.tar.xz | tar -xJ -C /usr/local --strip-components=1

node -v   # Confirm v20+ or v22+

# 2. Clone and run SimpleTun
git clone https://github.com/ArafatAhmedMubinOfficial/SimpleRun.git
cd SimpleRun
npm start
```

> **Using a remote PC, Cloud GPU pod (RunPod / Vast.ai), or LAN IP?** Choose either option:
> - **Option 1 — Direct Remote / Proxy Access:** Start with `npm run start:remote` (binds `0.0.0.0` and allows proxy/LAN `Host` headers) or keep loopback binding behind a proxy with `SIMPLETUN_ALLOW_REMOTE=1 npm start`.
> - **Option 2 — SSH Tunnel (Recommended on public networks):** Keep loopback-only mode and run `ssh -L 48199:127.0.0.1:48199 root@YOUR_GPU_SERVER_IP` from your local laptop, then open `http://127.0.0.1:48199/`.

Open **[http://127.0.0.1:48199/](http://127.0.0.1:48199/)** in your browser:
- Studio App: `http://127.0.0.1:48199/`
- Video Studio: `http://127.0.0.1:48199/video-studio`
- Live Hardware & GPU Check: `http://127.0.0.1:48199/gpu-check`
- Documentation & Landing Site: `http://127.0.0.1:48199/docs` and `/landing`

---

## Running on an NVIDIA GPU PC

1. Launch `npm start` and click the **Engine status pill** in the top-left System Strip:
   - **Option A — Managed Install:** Click **Install ComfyUI + PyTorch Engine** to download ComfyUI `v0.3.14`, build `data/engine/venv`, install PyTorch (CUDA 12.4 when CUDA is detected), and write `extra_model_paths.yaml`.
   - **Option B — Existing ComfyUI:** Enter your existing **External ComfyUI Folder Path** (e.g., `C:\ComfyUI_windows_portable\ComfyUI`) or start ComfyUI separately on `http://127.0.0.1:8188` and click **Save Settings & Re-Probe**.
2. Open **Model Manager** in the left rail to scan existing `.safetensors`/`.gguf` files in `data/models/` or download preset weights from HuggingFace. (Add a HuggingFace Read token for gated models such as FLUX.)
3. *(Recommended on GPU PCs)* Check **Strict Real Engine Mode** inside the Engine modal so local jobs only run via live ComfyUI with weights present on disk.

---

## Running in Electron Desktop Mode

`electron` is declared under `optionalDependencies` (`^45.3.3`) so headless/CI environments stay dependency-free. To launch SimpleTun as a native desktop window with system tray controls:

```bash
npm install electron
npm run electron
```

---

## Connecting AI Agents (MCP)

SimpleTun ships a clean-room stdio MCP server implementing all **74 Control API tools**. Add it to **Claude Code**, **Cursor**, **Windsurf**, **Codex**, or **Gemini CLI**:

```json
{
  "mcpServers": {
    "simpletun": {
      "command": "node",
      "args": ["/ABS/PATH/TO/SimpleRun/packages/mcp-server/src/bin.js", "--port", "48199"],
      "env": {
        "SIMPLETUN_TOKEN": "st-agent-simpletun-open"
      }
    }
  }
}
```

- Start SimpleTun (`npm start` or `npm run electron`) before calling MCP tools; it writes its active port to `data/agent-api.json` for automatic port discovery.
- Create additional scoped tokens with optional credit spend caps from **Connect Agent (MCP)** in the UI or `POST /api/ui/tokens`.

---

## Environment Variables & Control API

| Variable | Default | Purpose |
|---|---|---|
| `SIMPLETUN_PORT` / `PORT` | `48199` | Port for HTTP Control API & Studio UI (`0` binds an ephemeral port). |
| `SIMPLETUN_HOST` / `HOST` | `127.0.0.1` | Bind address (`0.0.0.0` for LAN access; automatically enables remote `Host` headers). |
| `SIMPLETUN_ALLOW_REMOTE` | `0` | Set `1` to accept non-loopback proxy/LAN `Host` headers (`npm run start:remote` sets both `--host=0.0.0.0` & remote hosts). |
| `SIMPLETUN_ALLOWED_HOSTS` | — | Comma-separated host allowlist (supports wildcard prefix like `*.proxy.runpod.net`). |
| `SIMPLETUN_TOKEN` | — | Bearer pairing token used by `packages/mcp-server/src/bin.js` (also `--token <tok>`). |
| `SIMPLETUN_API_PORT` | Auto-discovered | Override port used by the MCP client (`--port <num>` also supported). |
| `SIMPLETUN_USERDATA_DIR` | `./data` | Override discovery directory where `agent-api.json` is located. |

**Security Model:**
- Defaults to loopback (`127.0.0.1`) and rejects non-loopback `Host` headers (`403 forbidden_host`) to block DNS-rebinding attacks unless opted into remote/proxy access (`npm run start:remote`, `SIMPLETUN_ALLOW_REMOTE=1`, or `SIMPLETUN_ALLOWED_HOSTS`).
- Control API routes require `Authorization: Bearer <token>` (`401 unauthorized` otherwise); built-in UI default token is `st-agent-simpletun-open`.

---

## Testing & REA Forensics

```bash
# Run the full test suite (Control API, Studios, WAV BPM DSP, Safetensors scanner, Mock ComfyUI WS, 74-tool MCP stdio, Electron syntax)
npm test

# Audit ./src for accidental secret/source-map exposure via rea-agents
npm run rea:audit

# Optional: re-download @simpligen/mcp@0.9.1 and simpligen.io web chunks & regenerate full AST evidence bundles
npm run rea:analyze
```

Latest verified test & REA checks:
- `npm test`: **11/11** passing assertions (`tests/simpletun.test.js`, including multi-GPU detection & 2-GPU ComfyUI distribution).
- `npm run rea:audit`: `exposed: 0`, `no_exposure_observed_in_assessed_checks: true`.
- `rea-agents` AST analysis of `./src`: `10` JS files parsed, `239,875` bytes read, `36,202` AST nodes visited, `185` findings, `0` parse failures.

---

## Architecture

- [`src/server/index.js`](./src/server/index.js) — Loopback/remote HTTP Control API (`127.0.0.1:48199` or `--remote`), DNS-rebinding Host guard, Bearer auth, spend-cap enforcement, and Studio static/SPA server.
- [`src/server/hardware.js`](./src/server/hardware.js) — Multi-GPU CUDA probe (`nvidia-smi` CSV / `-L` / `/proc/driver/nvidia` + Windows `Win32_VideoController`), OS RAM, and `fs.statfsSync` disk metrics.
- [`src/server/model-manager.js`](./src/server/model-manager.js) — Disk scanner across ComfyUI subfolders, binary `.safetensors` header parser, `Managed`/`External`/`Not in a model folder` status classification, and resumable HTTP `Range` downloader.
- [`src/server/comfy-engine.js`](./src/server/comfy-engine.js) — ComfyUI (`v0.3.14`) downloader/extractor, Python `venv` + PyTorch CUDA/CPU installer, `extra_model_paths.yaml` generator, and multi-GPU worker pool (`CUDA_VISIBLE_DEVICES` per GPU, least-busy scheduler).
- [`src/server/comfy-workflows.js`](./src/server/comfy-workflows.js) — Node-graph compiler (`checkpoint-t2i`, `flux-unet`, `wan-video`, `ltx-video`, `upscale`), HTTP/WebSocket executor, and PNG `tEXt` metadata chunk injector.
- [`src/server/cloud-providers.js`](./src/server/cloud-providers.js) — Direct REST clients for OpenAI Images, Google Imagen/Veo, and HuggingFace Inference API.
- [`src/server/audio-video.js`](./src/server/audio-video.js) — PCM decode + RMS onset autocorrelation tempo detector (`400 no_pulse` guard), `ffmpeg` last-frame extractor, and multi-clip MP4 film stitcher.
- [`src/server/catalog.js`](./src/server/catalog.js) — Preset packs, capability matrix, HuggingFace model URLs & workflow architecture mappings (`PRESET_MODEL_SPECS`), 36 prompting guide families, Character/Recipe blocks, and GPU tier reference data.
- [`src/server/synthesizer.js`](./src/server/synthesizer.js) — Non-GPU/dev fallback PNG (`zlib`) & MP4 (`ffmpeg`) generator used only when ComfyUI is offline and **Strict Real Engine Mode** is disabled.
- [`src/server/state.js`](./src/server/state.js) — Persistent state (`data/simpletun-state.json`), async job execution queue, Character Studio, Recipe runner, and Video Studio timeline/undo-redo stack.
- [`electron/main.js`](./electron/main.js) & [`electron/preload.js`](./electron/preload.js) — Desktop window, system tray, and folder picker IPC bridge.
- [`packages/mcp-server/`](./packages/mcp-server/src/tools.js) — Standalone zero-dependency 74-tool stdio MCP server.
- [`public/`](./public/index.html) — Dark-mode Studio web UI, Video Studio timeline, Live GPU Check, Docs, and REA Forensics view.
- [`docs/`](./docs/SETUP_GUIDE.md) — Cross-platform setup guide and [`REA_FORENSIC_REPORT.md`](./docs/REA_FORENSIC_REPORT.md) verification report (`npm run rea:analyze` populates local `rea-evidence/`).
