# SimpleTun Cross-Platform Setup Guide

This guide walks through running **SimpleTun** on any computer—Windows, macOS, or Linux—whether you have a dedicated **NVIDIA CUDA GPU**, want to use **Cloud / BYOK API keys**, or want to run the **Zero-Setup Studio & MCP sandbox** on CPU/VM hardware.

---

## 1. Prerequisites Matrix

| Requirement | Minimum for Studio, MCP & Fallback Mode | Required for Video Studio Stitching / MP3 Audio | Required for Local ComfyUI CUDA Engine |
|---|---|---|---|
| **Node.js** | `>= 20.0` (Node 22+ recommended) | `>= 20.0` | `>= 20.0` |
| **npm packages** | **None** (`0` required runtime deps) | **None** (optional: `electron`) | **None** |
| **FFmpeg** | Optional | **Recommended** (`ffmpeg` on `PATH`) | **Recommended** (`ffmpeg` on `PATH`) |
| **Python + pip** | Not needed | Not needed | **Python 3.10 – 3.12** with `venv` |
| **tar** | Not needed | Not needed | Built into Windows 10/11, macOS, Linux |
| **GPU Hardware** | Any CPU / integrated / VM display | Any CPU | NVIDIA RTX/GTX Turing+ (`compute_cap >= 7.5`), 8–24+ GB VRAM, NVIDIA Driver installed (`nvidia-smi` working) |

---

## 2. Installing System Prerequisites

### Windows 10 / 11

Open **PowerShell** and install Git, Node.js, and FFmpeg (plus Python 3.12 if using local ComfyUI):

```powershell
winget install Git.Git
winget install OpenJS.NodeJS.LTS
winget install Gyan.FFmpeg

# Optional (needed only for local ComfyUI engine installation):
winget install Python.Python.3.12
```

Restart your terminal so `PATH` picks up `node`, `git`, `ffmpeg`, and `python`.

Verify installation:
```powershell
node -v
ffmpeg -version
nvidia-smi   # Only on NVIDIA GPU PCs
```

### macOS (Apple Silicon / Intel)

Using [Homebrew](https://brew.sh/):

```bash
brew install git node ffmpeg
node -v
ffmpeg -version
```

> **macOS note:** ComfyUI PyTorch CUDA wheels require Windows/Linux NVIDIA GPUs. On macOS, run SimpleTun using **BYOK Cloud keys** (OpenAI, Google Imagen/Veo, HuggingFace Inference), point **ComfyUI Endpoint URL** at a Linux/Windows GPU box on your LAN, or use fallback mode for timeline & MCP development.

### Linux & Cloud GPU Pods (Ubuntu / Debian / Docker)

**Ubuntu / Debian (Do NOT rely on distro `apt install nodejs` if it provides Node v12/v18):**
```bash
# Install Node.js 22 LTS via NodeSource + FFmpeg + Python venv
sudo apt update && sudo apt install -y git curl ffmpeg python3 python3-venv python3-pip tar
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # Verify v22.x
```

**Fast portable Linux install (for root Docker / RunPod / Vast.ai containers with no `sudo` or old `apt` Node):**
```bash
apt-get update && apt-get install -y curl xz-utils ffmpeg python3 python3-venv git
curl -fsSL https://nodejs.org/dist/v22.14.0/node-v22.14.0-linux-x64.tar.xz | tar -xJ -C /usr/local --strip-components=1
hash -r
node -v   # Should print v22.14.0
```

**Remote GPU Pod / Cloud Proxy / LAN Access:**
By default SimpleTun rejects non-loopback `Host` headers (`403 forbidden_host`) to block DNS-rebinding attacks. When connecting from another computer:
- **Cloud proxy URL (RunPod, Vast.ai, Cloudflare Tunnel, nginx) or LAN IP:**
  ```bash
  npm run start:remote
  # Or allow specific proxy hosts only:
  SIMPLETUN_ALLOWED_HOSTS="*.proxy.runpod.net" SIMPLETUN_HOST=127.0.0.1 npm start
  ```
- **Or SSH tunnel (keeps strict loopback-only mode):**
  ```bash
  ssh -L 48199:127.0.0.1:48199 root@YOUR_SERVER_IP
  ```
  Then open `http://127.0.0.1:48199/` on your local computer's browser.

**Fedora:**
```bash
sudo dnf install -y git nodejs npm ffmpeg python3 python3-pip tar
```

**Arch Linux:**
```bash
sudo pacman -S git nodejs npm ffmpeg python python-pip tar
```

---

## 3. Clone & Start SimpleTun

```bash
git clone https://github.com/ArafatAhmedMubinOfficial/SimpleRun.git
cd SimpleRun
npm start
```

Expected console output:
```text
[SimpleTun] Control API & Studio running at http://127.0.0.1:48199 (port 48199)
[SimpleTun] Open-Source Pairing Token: st-agent-simpletun-open
```

Then open **`http://127.0.0.1:48199/`** in any browser.

### Optional: Custom Port or Data Directory

```bash
# Run on a custom port (use 0 for an auto-assigned free port)
SIMPLETUN_PORT=49000 npm start

# Windows PowerShell equivalent:
$env:SIMPLETUN_PORT="49000"; npm start
```

---

## 4. Setting Up Real GPU Generation (NVIDIA ComfyUI)

You have two ways to connect SimpleTun to a real ComfyUI backend:

### Option A: Automatic One-Click Managed Install
1. Open SimpleTun in your browser (`http://127.0.0.1:48199/`).
2. Click the **Engine Status Card** in the top-left System Strip (`Engine Missing` / `Engine Stopped`).
3. Click **Install ComfyUI + PyTorch Engine**.
   - SimpleTun downloads ComfyUI (`v0.3.14`), extracts it to `data/engine/ComfyUI`, creates a Python virtual environment (`data/engine/venv`), installs PyTorch (`--index-url https://download.pytorch.org/whl/cu124` when `cudaSupported` is detected, otherwise CPU wheels), installs `requirements.txt`, and writes `data/engine/extra_model_paths.yaml` pointing ComfyUI to `data/models/`.
   - Live installer logs appear directly in the Engine modal.
4. Once installed, click **Start Engine** (or call `POST /engine/start`).

### Option B: Connect Your Existing ComfyUI Install
Already have ComfyUI Portable or a custom ComfyUI installation?
1. Click the **Engine Status Card** in the top-left System Strip.
2. Either:
   - Set **ComfyUI Endpoint URL** (default `http://127.0.0.1:8188`) if ComfyUI is already running, OR
   - Set **External ComfyUI Folder Path** (e.g., `C:\ComfyUI_windows_portable\ComfyUI` or `/opt/ComfyUI`) so SimpleTun can spawn and supervise it with `extra_model_paths.yaml`.
3. Click **Save Settings & Re-Probe**.

### Downloading Model Weights & LoRAs
1. Click **Model Manager** in the left navigation rail.
2. Under **Download Missing Preset Weights (HuggingFace)**, click **Download** on the preset you want (e.g., `z-image-turbo`, `flux-2-dev`, `wan-2.2-t2v`, `ltx-2.5-video`).
   - Downloads support automatic HTTP `Range` resume into `data/models/<subfolder>/` (`checkpoints/`, `diffusion_models/`, `text_encoders/`, `vae/`, `loras/`, etc.).
   - For gated HuggingFace repositories (such as FLUX), paste your HuggingFace Read Token (`hf_...`) under **Download Tokens & BYOK API Keys** and click **Save API Keys**.
3. Alternatively, copy existing `.safetensors` / `.gguf` files directly into `data/models/checkpoints/` or `data/models/loras/`—the Model Manager parses their binary headers and picks them up automatically.

### Strict Real Engine Mode
Open the **Engine Status Card** -> check **Strict Real Engine Mode** -> **Save Settings & Re-Probe**.
When enabled:
- Local presets cannot run unless their required model weights exist on disk (`preset_not_installed` error otherwise).
- Jobs fail cleanly with an explicit error instead of falling back to synthetic previews if ComfyUI is offline.

---

## 5. Setting Up BYOK Cloud Keys (No GPU Needed)

1. Open **Model Manager** -> scroll to **Download Tokens & BYOK API Keys**.
2. Enter keys for the providers you use:
   - **Google AI Studio Key**: Enables `Google Imagen / Gemini Image` (`gemini-nano-banana`) and `Google Veo / Gemini Video`.
   - **OpenAI API Key**: Enables `OpenAI GPT Image` (`gpt-image-2`).
   - **HuggingFace Read Token (`hf_...`)**: Enables gated weight downloads AND HuggingFace Inference API cloud runs for presets configured with `hfInferenceModel`.
3. Click **Save API Keys**.

---

## 6. Electron Desktop App (Optional)

Electron is kept optional so headless servers need zero `node_modules`:

```bash
npm install electron
npm run electron
```

- Launches a Chromium desktop shell at `http://127.0.0.1:48199/` with a system tray menu, native directory picker IPC (`dialog:selectFolder`), and automatic ComfyUI process cleanup when clicking **Quit SimpleTun** in the tray.

---

## 7. Connecting MCP AI Clients (Claude Code, Cursor, Codex, Windsurf, Gemini CLI)

1. Make sure SimpleTun is running (`npm start`).
2. Add the following MCP server configuration to your client:

```json
{
  "mcpServers": {
    "simpletun": {
      "command": "node",
      "args": ["/absolute/path/to/SimpleRun/packages/mcp-server/src/bin.js", "--port", "48199"],
      "env": {
        "SIMPLETUN_TOKEN": "st-agent-simpletun-open"
      }
    }
  }
}
```

- On Windows, use forward slashes or escaped backslashes (e.g., `"C:/path/to/SimpleRun/packages/mcp-server/src/bin.js"`).
- Your agent now has access to all **74 MCP tools** (`generate`, `create_character`, `apply_film_plan`, `export_film`, `prepare_preset`, etc.).

---

## 8. Troubleshooting

| Symptom | Cause & Fix |
|---|---|
| `409 engine_not_installed` on Start Engine | Neither managed `data/engine/ComfyUI` nor an external running ComfyUI at `comfyUiUrl` exists yet. Click **Install ComfyUI + PyTorch Engine** in the Engine modal, or point **External ComfyUI Folder Path** / **ComfyUI Endpoint URL** at your ComfyUI install. |
| `401 download_auth_required` from HuggingFace / Civitai | The weight repo is gated or requires authentication. Save your `hf_...` Read Token (and accept the model license on huggingface.co) or Civitai API key in **Model Manager**. |
| `400 no_pulse` in Video Studio Tempo Detection | Uploaded audio is silent, under 1.5s, or has no rhythmic onset periodicity between 68 and 165 BPM. Upload an audio track with clear percussive/melodic transients, or verify `ffmpeg` is on `PATH` for `.mp3`/`.m4a`/`.ogg`. |
| Video export fails in Video Studio | Ensure `ffmpeg` is installed and accessible (`ffmpeg -version`). SimpleTun falls back to synthetic container output only if `ffmpeg` cannot write the merged MP4. |
| `403 forbidden_host` when accessing API | SimpleTun rejects non-loopback `Host` headers (`127.0.0.1`, `localhost`, `[::1]`) for DNS-rebinding protection. Access strictly over loopback. |
