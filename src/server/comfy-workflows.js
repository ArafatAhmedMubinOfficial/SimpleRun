// src/server/comfy-workflows.js
// Compiles preset capabilities + user prompts/options/LoRAs into real ComfyUI API node graphs,
// executes them over ComfyUI HTTP + WebSocket (/ws) with live step progress, downloads outputs,
// and embeds ComfyUI workflow JSON into PNG tEXt metadata chunks.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function makeTextChunk(keyword, text) {
  const keyBuf = Buffer.from(keyword, "latin1");
  const nullByte = Buffer.from([0]);
  const textBuf = Buffer.from(text, "utf8");
  const data = Buffer.concat([keyBuf, nullByte, textBuf]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const type = Buffer.from("tEXt", "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([type, data])), 0);
  return Buffer.concat([len, type, data, crc]);
}

/**
 * Injects ComfyUI-compatible `prompt` and `workflow` tEXt metadata chunks right before IEND
 * so generated PNGs can be dragged straight into ComfyUI Desktop.
 */
export function embedPngWorkflowMetadata(pngPath, workflowObj) {
  const buf = fs.readFileSync(pngPath);
  if (buf.length < 24) return;
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== sig[i]) return;
  }
  const iendOffset = buf.lastIndexOf(Buffer.from([0, 0, 0, 0, 73, 69, 78, 68]));
  if (iendOffset === -1) return;

  const jsonStr = JSON.stringify(workflowObj);
  const promptChunk = makeTextChunk("prompt", jsonStr);
  const metaChunk = makeTextChunk("Software", "SimpleTun Open Engine");
  const patched = Buffer.concat([buf.subarray(0, iendOffset), promptChunk, metaChunk, buf.subarray(iendOffset)]);
  fs.writeFileSync(pngPath, patched);
}

export function resolveComfyPixelDims(aspectRatio = "1:1", resolution = "720p") {
  const tierBase = resolution === "1080p" ? 1024 : resolution === "480p" ? 512 : 768;
  const ratios = {
    "1:1": [1, 1],
    "16:9": [16, 9],
    "9:16": [9, 16],
    "4:3": [4, 3],
    "3:4": [3, 4],
  };
  const [rw, rh] = ratios[aspectRatio] || [1, 1];
  let w, h;
  if (rw >= rh) {
    w = Math.round((tierBase * rw) / rh);
    h = tierBase;
  } else {
    w = tierBase;
    h = Math.round((tierBase * rh) / rw);
  }
  // ComfyUI latent dimensions must be multiples of 16 (or 32 for video)
  w = Math.max(256, Math.round(w / 32) * 32);
  h = Math.max(256, Math.round(h / 32) * 32);
  return { width: w, height: h };
}

/**
 * Compiles a clean-room ComfyUI API prompt graph tailored to the selected preset architecture.
 */
export function compileComfyWorkflow({
  preset,
  prompt = "",
  negativePrompt = "",
  seed = 123456,
  steps,
  cfg,
  denoise = 1.0,
  aspectRatio = "1:1",
  resolution = "720p",
  durationSeconds = 4,
  scale = 2,
  keepResolution = false,
  loras = [],
  inputImageName = null,
}) {
  const { width, height } = resolveComfyPixelDims(aspectRatio, resolution);
  const numSteps = Number(steps) || preset?.options?.steps?.default || 20;
  const numCfg = Number(cfg) || preset?.options?.cfg?.default || 4.0;
  const numSeed = Number.isFinite(Number(seed)) ? Math.abs(Math.floor(Number(seed))) : Math.floor(Math.random() * 1e9);
  const primaryModel = preset?.requiredModels?.[0]?.filename || "model.safetensors";
  const clipModel = preset?.requiredModels?.[1]?.filename || null;
  const vaeModel = preset?.requiredModels?.[2]?.filename || null;

  const arch = preset?.workflowArch || "checkpoint-t2i";

  // 1. Upscaler / Enhancer graph
  if (arch === "upscale") {
    const graph = {
      "1": { class_type: "LoadImage", inputs: { image: inputImageName || "input.png" } },
      "2": { class_type: "UpscaleModelLoader", inputs: { model_name: primaryModel } },
      "3": { class_type: "ImageUpscaleWithModel", inputs: { upscale_model: ["2", 0], image: ["1", 0] } },
    };
    let finalOut = ["3", 0];
    if (keepResolution) {
      graph["4"] = {
        class_type: "ImageScale",
        inputs: { image: ["3", 0], upscale_method: "lanczos", width, height, crop: "disabled" },
      };
      finalOut = ["4", 0];
    }
    graph["5"] = { class_type: "SaveImage", inputs: { images: finalOut, filename_prefix: "SimpleTun_Enhanced" } };
    return graph;
  }

  // 2. Video generation graphs (Wan 2.2 / LTX 2.3 & 2.5)
  if (arch === "wan-video" || arch === "ltx-video") {
    const fps = arch === "ltx-video" ? 24 : 16;
    const frameCount = Math.max(17, Math.round(durationSeconds * fps / 8) * 8 + 1);
    const graph = {
      "1": { class_type: "UNETLoader", inputs: { unet_name: primaryModel, weight_dtype: "fp8_e4m3fn" } },
      "2": {
        class_type: "CLIPLoader",
        inputs: {
          clip_name: clipModel || (arch === "ltx-video" ? "t5xxl_fp8_e4m3fn.safetensors" : "umt5_xxl_fp8_e4m3fn_scaled.safetensors"),
          type: arch === "ltx-video" ? "ltxv" : "wan",
        },
      },
      "3": {
        class_type: "VAELoader",
        inputs: { vae_name: vaeModel || (arch === "ltx-video" ? "ltxv_vae.safetensors" : "wan_2.1_vae.safetensors") },
      },
      "4": { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["2", 0] } },
      "5": { class_type: "CLIPTextEncode", inputs: { text: negativePrompt || "flicker, blurry, distorted", clip: ["2", 0] } },
    };

    let latentOut;
    let posOut = ["4", 0];
    let negOut = ["5", 0];

    if (inputImageName) {
      graph["6"] = { class_type: "LoadImage", inputs: { image: inputImageName } };
      graph["7"] = {
        class_type: arch === "ltx-video" ? "LTXVImgToVideo" : "WanImageToVideo",
        inputs: {
          positive: ["4", 0],
          negative: ["5", 0],
          vae: ["3", 0],
          image: ["6", 0],
          width,
          height,
          length: frameCount,
          batch_size: 1,
        },
      };
      posOut = ["7", 0];
      negOut = ["7", 1];
      latentOut = ["7", 2];
    } else {
      graph["7"] = {
        class_type: arch === "ltx-video" ? "EmptyLTXVLatentVideo" : "EmptyHunyuanLatentVideo",
        inputs: { width, height, length: frameCount, batch_size: 1 },
      };
      latentOut = ["7", 0];
    }

    graph["8"] = {
      class_type: "KSampler",
      inputs: {
        model: ["1", 0],
        positive: posOut,
        negative: negOut,
        latent_image: latentOut,
        seed: numSeed,
        steps: numSteps,
        cfg: numCfg,
        sampler_name: "euler",
        scheduler: arch === "ltx-video" ? "normal" : "simple",
        denoise: 1.0,
      },
    };
    graph["9"] = { class_type: "VAEDecode", inputs: { samples: ["8", 0], vae: ["3", 0] } };
    graph["10"] = {
      class_type: "SaveAnimatedWEBP",
      inputs: { images: ["9", 0], filename_prefix: "SimpleTun_Video", fps, lossless: false, quality: 88, method: "default" },
    };
    return graph;
  }

  // 3. FLUX / DualCLIP / SD3 Diffusion Model graph
  if (arch === "flux-unet") {
    const graph = {
      "1": { class_type: "UNETLoader", inputs: { unet_name: primaryModel, weight_dtype: "fp8_e4m3fn" } },
      "2": {
        class_type: "DualCLIPLoader",
        inputs: { clip_name1: clipModel || "t5xxl_fp8_e4m3fn.safetensors", clip_name2: "clip_l.safetensors", type: "flux" },
      },
      "3": { class_type: "VAELoader", inputs: { vae_name: vaeModel || "ae.safetensors" } },
      "4": { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["2", 0] } },
      "5": { class_type: "CLIPTextEncode", inputs: { text: negativePrompt || "", clip: ["2", 0] } },
    };

    let modelRef = ["1", 0];
    let clipRef = ["2", 0];
    let nextId = 10;
    for (const l of loras) {
      const id = String(nextId++);
      graph[id] = {
        class_type: "LoraLoader",
        inputs: { model: modelRef, clip: clipRef, lora_name: l.filename, strength_model: l.weight ?? 0.85, strength_clip: l.weight ?? 0.85 },
      };
      modelRef = [id, 0];
      clipRef = [id, 1];
    }

    if (inputImageName) {
      graph["6"] = { class_type: "LoadImage", inputs: { image: inputImageName } };
      graph["7"] = { class_type: "VAEEncode", inputs: { pixels: ["6", 0], vae: ["3", 0] } };
    } else {
      graph["7"] = { class_type: "EmptySD3LatentImage", inputs: { width, height, batch_size: 1 } };
    }

    graph["8"] = {
      class_type: "KSampler",
      inputs: {
        model: modelRef,
        positive: ["4", 0],
        negative: ["5", 0],
        latent_image: ["7", 0],
        seed: numSeed,
        steps: numSteps,
        cfg: numCfg,
        sampler_name: "euler",
        scheduler: "simple",
        denoise: inputImageName ? denoise : 1.0,
      },
    };
    graph["9"] = { class_type: "VAEDecode", inputs: { samples: ["8", 0], vae: ["3", 0] } };
    graph["20"] = { class_type: "SaveImage", inputs: { images: ["9", 0], filename_prefix: "SimpleTun_Flux" } };
    return graph;
  }

  // 4. Standard Checkpoint Image Generation / Editing (Z-Image, Krea, SDXL, Character Base)
  const graph = {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: primaryModel } },
  };
  let modelRef = ["1", 0];
  let clipRef = ["1", 1];
  const vaeRef = ["1", 2];

  let nextId = 10;
  for (const l of loras) {
    const id = String(nextId++);
    graph[id] = {
      class_type: "LoraLoader",
      inputs: {
        model: modelRef,
        clip: clipRef,
        lora_name: l.filename,
        strength_model: l.weight ?? 0.85,
        strength_clip: l.weight ?? 0.85,
      },
    };
    modelRef = [id, 0];
    clipRef = [id, 1];
  }

  graph["2"] = { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: clipRef } };
  graph["3"] = { class_type: "CLIPTextEncode", inputs: { text: negativePrompt || "", clip: clipRef } };

  if (inputImageName) {
    graph["4"] = { class_type: "LoadImage", inputs: { image: inputImageName } };
    graph["5"] = { class_type: "VAEEncode", inputs: { pixels: ["4", 0], vae: vaeRef } };
  } else {
    graph["5"] = { class_type: "EmptyLatentImage", inputs: { width, height, batch_size: 1 } };
  }

  graph["6"] = {
    class_type: "KSampler",
    inputs: {
      model: modelRef,
      positive: ["2", 0],
      negative: ["3", 0],
      latent_image: ["5", 0],
      seed: numSeed,
      steps: numSteps,
      cfg: numCfg,
      sampler_name: preset?.sampler || "euler",
      scheduler: preset?.scheduler || "normal",
      denoise: inputImageName ? denoise : 1.0,
    },
  };
  graph["7"] = { class_type: "VAEDecode", inputs: { samples: ["6", 0], vae: vaeRef } };
  graph["8"] = { class_type: "SaveImage", inputs: { images: ["7", 0], filename_prefix: "SimpleTun" } };
  return graph;
}

export async function uploadImageToComfy(comfyUrl, localImagePath) {
  const bytes = fs.readFileSync(localImagePath);
  const ext = path.extname(localImagePath).toLowerCase();
  const mime = ext === ".webp" ? "image/webp" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png";
  const form = new FormData();
  form.append("image", new Blob([bytes], { type: mime }), path.basename(localImagePath));
  form.append("overwrite", "true");

  const res = await fetch(`${comfyUrl}/upload/image`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`ComfyUI image upload failed: HTTP ${res.status}`);
  const data = await res.json();
  return data.name;
}

async function submitComfyPrompt(comfyUrl, workflow, clientId) {
  const res = await fetch(`${comfyUrl}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: workflow, client_id: clientId }),
  });
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new Error(json.error?.message || `ComfyUI /prompt error (${res.status})`);
  }
  return json.prompt_id;
}

async function collectComfyOutputFromHistory(comfyUrl, promptId, workflow, outPath, { allowPending = false } = {}) {
  const hRes = await fetch(`${comfyUrl}/history/${encodeURIComponent(promptId)}`);
  if (!hRes.ok) throw new Error(`Failed reading ComfyUI history: HTTP ${hRes.status}`);
  const hJson = await hRes.json();
  const entry = hJson[promptId];
  if (!entry) {
    if (allowPending) return null;
    throw new Error("ComfyUI produced no history entry.");
  }
  if (entry.status?.status_str === "error") {
    throw new Error("ComfyUI reported an execution error.");
  }
  if (!entry.outputs) {
    if (allowPending) return null;
    throw new Error("ComfyUI produced no outputs.");
  }

  for (const nodeOut of Object.values(entry.outputs)) {
    const media = (nodeOut.images && nodeOut.images[0]) || (nodeOut.gifs && nodeOut.gifs[0]);
    if (media && media.filename) {
      const qs = new URLSearchParams({
        filename: media.filename,
        subfolder: media.subfolder || "",
        type: media.type || "output",
      });
      const viewRes = await fetch(`${comfyUrl}/view?${qs.toString()}`);
      if (!viewRes.ok) throw new Error(`Failed fetching ComfyUI output view: HTTP ${viewRes.status}`);
      const buf = Buffer.from(await viewRes.arrayBuffer());
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, buf);
      if (outPath.endsWith(".png")) {
        embedPngWorkflowMetadata(outPath, workflow);
      }
      return { outPath, bytes: buf.length, comfyFilename: media.filename };
    }
  }
  if (allowPending) return null;
  throw new Error("ComfyUI completed without image or video output files.");
}

export async function executeComfyWorkflow({
  comfyUrl,
  workflow,
  outPath,
  onProgress = () => {},
  timeoutMs = 15 * 60 * 1000,
}) {
  const clientId = crypto.randomUUID();

  // Node 20 compatibility fallback: poll /history when global WebSocket is unavailable
  if (typeof globalThis.WebSocket !== "function") {
    const promptId = await submitComfyPrompt(comfyUrl, workflow, clientId);
    onProgress(15, "queued_in_comfyui");
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 350));
      const res = await collectComfyOutputFromHistory(comfyUrl, promptId, workflow, outPath, { allowPending: true });
      if (res) {
        onProgress(100, "completed");
        return res;
      }
    }
    throw new Error("ComfyUI execution timed out.");
  }

  const wsUrl = comfyUrl.replace(/^http/, "ws") + `/ws?clientId=${encodeURIComponent(clientId)}`;

  return new Promise((resolve, reject) => {
    let settled = false;
    let promptId = null;
    const ws = new globalThis.WebSocket(wsUrl);

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { ws.close(); } catch { /* ignore */ }
        reject(new Error("ComfyUI execution timed out."));
      }
    }, timeoutMs);

    const finishError = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* ignore */ }
      reject(err);
    };

    const collectFromHistory = async () => {
      const result = await collectComfyOutputFromHistory(comfyUrl, promptId, workflow, outPath);
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* ignore */ }
      resolve(result);
    };

    ws.addEventListener("open", async () => {
      try {
        promptId = await submitComfyPrompt(comfyUrl, workflow, clientId);
        onProgress(10, "queued_in_comfyui");
      } catch (err) {
        finishError(err);
      }
    });

    ws.addEventListener("message", async (evt) => {
      try {
        if (typeof evt.data !== "string") return;
        const msg = JSON.parse(evt.data);
        if (msg.type === "progress" && msg.data?.max) {
          const pct = Math.max(10, Math.min(98, Math.round((msg.data.value / msg.data.max) * 100)));
          onProgress(pct, `step ${msg.data.value}/${msg.data.max}`);
        } else if (msg.type === "execution_error" && (!promptId || msg.data?.prompt_id === promptId)) {
          finishError(new Error(msg.data?.exception_message || "ComfyUI execution_error"));
        } else if (msg.type === "executing" && msg.data?.node === null && (!promptId || msg.data?.prompt_id === promptId)) {
          await collectFromHistory();
        } else if (msg.type === "executed" && (!promptId || msg.data?.prompt_id === promptId)) {
          await collectFromHistory();
        }
      } catch (err) {
        finishError(err);
      }
    });

    ws.addEventListener("error", () => {
      finishError(new Error(`WebSocket connection failed to ComfyUI at ${comfyUrl}`));
    });
  });
}
