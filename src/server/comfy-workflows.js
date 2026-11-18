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

export function resolveComfyPixelDims(aspectRatio = "1:1", resolution = "720p", isVideo = false) {
  if (isVideo) {
    const vidMap = resolution === "1080p" || resolution === "720p"
      ? { "1:1": [768, 768], "16:9": [1024, 576], "9:16": [576, 1024], "4:3": [896, 672], "3:4": [672, 896] }
      : { "1:1": [512, 512], "16:9": [832, 480], "9:16": [480, 832], "4:3": [704, 544], "3:4": [544, 704] };
    const [w, h] = vidMap[aspectRatio] || vidMap["16:9"];
    return { width: w, height: h };
  }

  // Exact native SDXL / Flux 1.0 MP trained aspect buckets (avoids 512px tiling/double-subject artifacts)
  const tier720 = {
    "1:1": [1024, 1024],
    "16:9": [1344, 768],
    "9:16": [768, 1344],
    "4:3": [1152, 896],
    "3:4": [896, 1152],
  };
  const tier1080 = {
    "1:1": [1152, 1152],
    "16:9": [1536, 864],
    "9:16": [864, 1536],
    "4:3": [1280, 992],
    "3:4": [992, 1280],
  };
  const tier480 = {
    "1:1": [768, 768],
    "16:9": [960, 544],
    "9:16": [544, 960],
    "4:3": [896, 672],
    "3:4": [672, 896],
  };
  const table = resolution === "1080p" ? tier1080 : resolution === "480p" ? tier480 : tier720;
  const [w, h] = table[aspectRatio] || table["1:1"];
  return { width: w, height: h };
}

function snap64(n) {
  return Math.max(512, Math.round(n / 64) * 64);
}

function appendLoraChain(graph, startId, initialModelRef, initialClipRef, loras = []) {
  let modelRef = initialModelRef;
  let clipRef = initialClipRef;
  let nextId = startId;
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
  return { modelRef, clipRef, nextId };
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
  qualityMode = "standard",
  keepResolution = false,
  loras = [],
  inputImageName = null,
}) {
  const arch = preset?.workflowArch || "checkpoint-t2i";
  const isVideo = arch === "wan-video" || arch === "ltx-video";
  const { width, height } = resolveComfyPixelDims(aspectRatio, resolution, isVideo);
  const numSteps = Number.isFinite(Number(steps)) && Number(steps) > 0 ? Number(steps) : (preset?.options?.steps?.default || 20);
  const numCfg = Number.isFinite(Number(cfg)) && cfg !== "" && cfg !== null && cfg !== undefined ? Number(cfg) : (preset?.options?.cfg?.default ?? 4.0);
  const numSeed = Number.isFinite(Number(seed)) && String(seed).trim() !== ""
    ? Math.abs(Math.floor(Number(seed)))
    : Math.floor(Math.random() * 1e9);
  const primaryModel = preset?.requiredModels?.[0]?.filename || "model.safetensors";
  const clipModel = preset?.requiredModels?.[1]?.filename || null;
  const vaeModel = preset?.requiredModels?.[2]?.filename || null;
  const useHires = qualityMode === "hires" || qualityMode === "ultra";
  const hiW = snap64(width * 1.5);
  const hiH = snap64(height * 1.5);
  const hiresDenoise = qualityMode === "ultra" ? 0.48 : 0.40;
  const hiresSteps = Math.max(4, Math.round(numSteps * (qualityMode === "ultra" ? 0.85 : 0.65)));

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

  // 2. Video generation graphs (Wan 2.2 split UNET vs LTX-Video all-in-one Checkpoint + T5 CLIP)
  if (arch === "wan-video" || arch === "ltx-video") {
    const fps = arch === "ltx-video" ? 24 : 16;
    const frameCount = Math.max(17, Math.round((durationSeconds * fps) / 8) * 8 + 1);
    const graph = {};
    let modelRef;
    let vaeRef;
    let clipRef;

    if (arch === "ltx-video") {
      graph["1"] = { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: primaryModel } };
      graph["2"] = {
        class_type: "CLIPLoader",
        inputs: { clip_name: clipModel || "t5xxl_fp8_e4m3fn.safetensors", type: "ltxv" },
      };
      modelRef = ["1", 0];
      vaeRef = ["1", 2];
      clipRef = ["2", 0];
    } else {
      graph["1"] = { class_type: "UNETLoader", inputs: { unet_name: primaryModel, weight_dtype: "fp8_e4m3fn" } };
      graph["2"] = {
        class_type: "CLIPLoader",
        inputs: { clip_name: clipModel || "umt5_xxl_fp8_e4m3fn_scaled.safetensors", type: "wan" },
      };
      graph["3"] = { class_type: "VAELoader", inputs: { vae_name: vaeModel || "wan_2.1_vae.safetensors" } };
      modelRef = ["1", 0];
      clipRef = ["2", 0];
      vaeRef = ["3", 0];
    }

    graph["4"] = { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: clipRef } };
    graph["5"] = { class_type: "CLIPTextEncode", inputs: { text: negativePrompt || "flicker, blurry, distorted", clip: clipRef } };

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
          vae: vaeRef,
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
        model: modelRef,
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
    graph["9"] = { class_type: "VAEDecode", inputs: { samples: ["8", 0], vae: vaeRef } };
    graph["10"] = {
      class_type: "SaveAnimatedWEBP",
      inputs: { images: ["9", 0], filename_prefix: "SimpleTun_Video", fps, lossless: false, quality: 88, method: "default" },
    };
    return graph;
  }

  // 3. Modern 2026 Split-Weight Diffusion Graphs (Z-Image-Turbo, Krea-2, Qwen-Image 2.1)
  if (arch === "z-image-turbo" || arch === "krea2-turbo" || arch === "qwen-image-21") {
    const archCfg = {
      "z-image-turbo": {
        clipType: "lumina2",
        defaultClip: "qwen_3_4b_fp8_mixed.safetensors",
        defaultVae: "ae.safetensors",
        latentClass: "EmptySD3LatentImage",
        useAuraShift: true,
        prefix: "SimpleTun_ZImage",
      },
      "krea2-turbo": {
        clipType: "krea2",
        defaultClip: "qwen3vl_4b_fp8_scaled.safetensors",
        defaultVae: "qwen_image_vae.safetensors",
        latentClass: "EmptyLatentImage",
        useAuraShift: false,
        prefix: "SimpleTun_Krea2",
      },
      "qwen-image-21": {
        clipType: "qwen_image",
        defaultClip: "qwen3vl_8b_int8_convrot.safetensors",
        defaultVae: "qwen_image_2.1_vae_bf16.safetensors",
        latentClass: "EmptyLatentImage",
        useAuraShift: false,
        prefix: "SimpleTun_Qwen21",
      },
    }[arch];

    const graph = {
      "1": { class_type: "UNETLoader", inputs: { unet_name: primaryModel, weight_dtype: "default" } },
      "2": {
        class_type: "CLIPLoader",
        inputs: { clip_name: clipModel || archCfg.defaultClip, type: archCfg.clipType, device: "default" },
      },
      "3": { class_type: "VAELoader", inputs: { vae_name: vaeModel || archCfg.defaultVae } },
    };

    const { modelRef: loraModelRef, clipRef } = appendLoraChain(graph, 50, ["1", 0], ["2", 0], loras);
    let sampledModelRef = loraModelRef;
    if (archCfg.useAuraShift) {
      graph["15"] = { class_type: "ModelSamplingAuraFlow", inputs: { model: loraModelRef, shift: 3 } };
      sampledModelRef = ["15", 0];
    }

    graph["4"] = { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: clipRef } };
    if (negativePrompt && numCfg > 1.0) {
      graph["5"] = { class_type: "CLIPTextEncode", inputs: { text: negativePrompt, clip: clipRef } };
    } else {
      graph["5"] = { class_type: "ConditioningZeroOut", inputs: { conditioning: ["4", 0] } };
    }

    if (inputImageName) {
      graph["6"] = { class_type: "LoadImage", inputs: { image: inputImageName } };
      graph["7"] = { class_type: "VAEEncode", inputs: { pixels: ["6", 0], vae: ["3", 0] } };
    } else {
      graph["7"] = { class_type: archCfg.latentClass, inputs: { width, height, batch_size: 1 } };
    }

    const samplerName = preset?.sampler || "euler";
    const schedulerName = preset?.scheduler || "simple";
    graph["8"] = {
      class_type: "KSampler",
      inputs: {
        model: sampledModelRef,
        positive: ["4", 0],
        negative: ["5", 0],
        latent_image: ["7", 0],
        seed: numSeed,
        steps: numSteps,
        cfg: numCfg,
        sampler_name: samplerName,
        scheduler: schedulerName,
        denoise: inputImageName ? denoise : 1.0,
      },
    };

    let finalLatent = ["8", 0];
    if (useHires) {
      graph["20"] = {
        class_type: "LatentUpscale",
        inputs: { samples: ["8", 0], upscale_method: "nearest-exact", width: hiW, height: hiH, crop: "disabled" },
      };
      graph["21"] = {
        class_type: "KSampler",
        inputs: {
          model: sampledModelRef,
          positive: ["4", 0],
          negative: ["5", 0],
          latent_image: ["20", 0],
          seed: numSeed + 1,
          steps: hiresSteps,
          cfg: numCfg,
          sampler_name: samplerName,
          scheduler: schedulerName,
          denoise: hiresDenoise,
        },
      };
      finalLatent = ["21", 0];
    }

    graph["9"] = { class_type: "VAEDecode", inputs: { samples: finalLatent, vae: ["3", 0] } };
    graph["30"] = { class_type: "SaveImage", inputs: { images: ["9", 0], filename_prefix: archCfg.prefix } };
    return graph;
  }

  // 4. FLUX.2 [Klein] 4B graph (EmptyFlux2LatentImage + Flux2Scheduler + CFGGuider + SamplerCustomAdvanced)
  if (arch === "flux2-klein") {
    const graph = {
      "1": { class_type: "UNETLoader", inputs: { unet_name: primaryModel, weight_dtype: "default" } },
      "2": {
        class_type: "CLIPLoader",
        inputs: { clip_name: clipModel || "qwen_3_4b.safetensors", type: "flux2", device: "default" },
      },
      "3": { class_type: "VAELoader", inputs: { vae_name: vaeModel || "flux2-vae.safetensors" } },
    };
    const { modelRef, clipRef } = appendLoraChain(graph, 50, ["1", 0], ["2", 0], loras);

    graph["4"] = { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: clipRef } };
    if (negativePrompt && numCfg > 1.0) {
      graph["5"] = { class_type: "CLIPTextEncode", inputs: { text: negativePrompt, clip: clipRef } };
    } else {
      graph["5"] = { class_type: "ConditioningZeroOut", inputs: { conditioning: ["4", 0] } };
    }

    if (inputImageName) {
      graph["6"] = { class_type: "LoadImage", inputs: { image: inputImageName } };
      graph["7"] = { class_type: "VAEEncode", inputs: { pixels: ["6", 0], vae: ["3", 0] } };
    } else {
      graph["7"] = { class_type: "EmptyFlux2LatentImage", inputs: { width, height, batch_size: 1 } };
    }

    graph["8"] = { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } };
    graph["9"] = { class_type: "Flux2Scheduler", inputs: { steps: numSteps, width, height } };
    let sigmasRef = ["9", 0];
    if (inputImageName && denoise < 1.0) {
      graph["18"] = { class_type: "SplitSigmasDenoise", inputs: { sigmas: ["9", 0], denoise } };
      sigmasRef = ["18", 1];
    }

    graph["14"] = {
      class_type: "CFGGuider",
      inputs: { model: modelRef, positive: ["4", 0], negative: ["5", 0], cfg: numCfg },
    };
    graph["15"] = { class_type: "RandomNoise", inputs: { noise_seed: numSeed } };
    graph["16"] = {
      class_type: "SamplerCustomAdvanced",
      inputs: { noise: ["15", 0], guider: ["14", 0], sampler: ["8", 0], sigmas: sigmasRef, latent_image: ["7", 0] },
    };

    let finalLatent = ["16", 0];
    if (useHires) {
      graph["20"] = {
        class_type: "LatentUpscale",
        inputs: { samples: ["16", 0], upscale_method: "nearest-exact", width: hiW, height: hiH, crop: "disabled" },
      };
      graph["21"] = { class_type: "Flux2Scheduler", inputs: { steps: hiresSteps, width: hiW, height: hiH } };
      graph["22"] = { class_type: "SplitSigmasDenoise", inputs: { sigmas: ["21", 0], denoise: hiresDenoise } };
      graph["23"] = { class_type: "RandomNoise", inputs: { noise_seed: numSeed + 1 } };
      graph["24"] = {
        class_type: "SamplerCustomAdvanced",
        inputs: { noise: ["23", 0], guider: ["14", 0], sampler: ["8", 0], sigmas: ["22", 1], latent_image: ["20", 0] },
      };
      finalLatent = ["24", 0];
    }

    graph["17"] = { class_type: "VAEDecode", inputs: { samples: finalLatent, vae: ["3", 0] } };
    graph["30"] = { class_type: "SaveImage", inputs: { images: ["17", 0], filename_prefix: "SimpleTun_Flux2Klein" } };
    return graph;
  }

  // 5. Legacy FLUX.1 DualCLIP Diffusion Model graph
  if (arch === "flux-unet") {
    const graph = {
      "1": { class_type: "UNETLoader", inputs: { unet_name: primaryModel, weight_dtype: "fp8_e4m3fn" } },
      "2": {
        class_type: "DualCLIPLoader",
        inputs: { clip_name1: clipModel || "t5xxl_fp8_e4m3fn.safetensors", clip_name2: "clip_l.safetensors", type: "flux" },
      },
      "3": { class_type: "VAELoader", inputs: { vae_name: vaeModel || "ae.safetensors" } },
    };
    const { modelRef, clipRef } = appendLoraChain(graph, 50, ["1", 0], ["2", 0], loras);
    graph["4"] = { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: clipRef } };
    graph["5"] = { class_type: "CLIPTextEncode", inputs: { text: negativePrompt || "", clip: clipRef } };

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

  // 6. Standard Checkpoint Image Generation / Editing (RealVisXL Lightning, Juggernaut XL, FLUX fp8, Character Base)
  const graph = {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: primaryModel } },
  };
  const vaeRef = ["1", 2];
  const { modelRef, clipRef } = appendLoraChain(graph, 50, ["1", 0], ["1", 1], loras);

  graph["2"] = { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: clipRef } };
  graph["3"] = { class_type: "CLIPTextEncode", inputs: { text: negativePrompt || "", clip: clipRef } };

  if (inputImageName) {
    graph["4"] = { class_type: "LoadImage", inputs: { image: inputImageName } };
    graph["5"] = { class_type: "VAEEncode", inputs: { pixels: ["4", 0], vae: vaeRef } };
  } else {
    graph["5"] = { class_type: "EmptyLatentImage", inputs: { width, height, batch_size: 1 } };
  }

  const samplerName = preset?.sampler || "euler";
  const schedulerName = preset?.scheduler || "normal";
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
      sampler_name: samplerName,
      scheduler: schedulerName,
      denoise: inputImageName ? denoise : 1.0,
    },
  };

  let finalLatent = ["6", 0];
  if (useHires) {
    graph["20"] = {
      class_type: "LatentUpscale",
      inputs: { samples: ["6", 0], upscale_method: "nearest-exact", width: hiW, height: hiH, crop: "disabled" },
    };
    graph["21"] = {
      class_type: "KSampler",
      inputs: {
        model: modelRef,
        positive: ["2", 0],
        negative: ["3", 0],
        latent_image: ["20", 0],
        seed: numSeed + 1,
        steps: hiresSteps,
        cfg: numCfg,
        sampler_name: samplerName,
        scheduler: schedulerName,
        denoise: hiresDenoise,
      },
    };
    finalLatent = ["21", 0];
  }

  graph["7"] = { class_type: "VAEDecode", inputs: { samples: finalLatent, vae: vaeRef } };
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
  let json = {};
  try {
    json = await res.json();
  } catch {
    throw new Error(`ComfyUI /prompt returned non-JSON response (HTTP ${res.status})`);
  }
  const hasNodeErrors = json.node_errors && Object.keys(json.node_errors).length > 0;
  if (!res.ok || json.error || hasNodeErrors) {
    const nodeErrMsgs = hasNodeErrors
      ? Object.entries(json.node_errors)
          .map(([nid, info]) => `Node ${nid} (${info?.class_type || "unknown"}): ${(info?.errors || []).map((e) => e.details || e.message).join("; ")}`)
          .join(" | ")
      : "";
    throw new Error(nodeErrMsgs || json.error?.message || `ComfyUI /prompt error (${res.status})`);
  }
  if (!json.prompt_id) {
    throw new Error("ComfyUI /prompt succeeded without returning a prompt_id.");
  }
  return json.prompt_id;
}

async function isPromptStillInComfyQueue(comfyUrl, promptId) {
  try {
    const qRes = await fetch(`${comfyUrl}/queue`);
    if (!qRes.ok) return false;
    const q = await qRes.json();
    const inRunning = Array.isArray(q.queue_running) && q.queue_running.some((item) => item?.[1] === promptId);
    const inPending = Array.isArray(q.queue_pending) && q.queue_pending.some((item) => item?.[1] === promptId);
    return inRunning || inPending;
  } catch {
    return false;
  }
}

async function collectComfyOutputFromHistory(comfyUrl, promptId, workflow, outPath, { allowPending = false } = {}) {
  if (!promptId) {
    if (allowPending) return null;
    throw new Error("Missing ComfyUI prompt_id.");
  }
  const hRes = await fetch(`${comfyUrl}/history/${encodeURIComponent(promptId)}`);
  if (!hRes.ok) throw new Error(`Failed reading ComfyUI history: HTTP ${hRes.status}`);
  const hJson = await hRes.json();
  const entry = hJson[promptId];
  if (!entry) {
    if (allowPending) return null;
    throw new Error("ComfyUI produced no history entry.");
  }
  if (entry.status?.status_str === "error") {
    const errMsg = entry.status?.messages?.find((m) => m?.[0] === "execution_error")?.[1]?.exception_message;
    throw new Error(errMsg || "ComfyUI reported an execution error.");
  }
  if (!entry.outputs) {
    if (allowPending) return null;
    throw new Error("ComfyUI produced no outputs.");
  }

  for (const nodeOut of Object.values(entry.outputs)) {
    const media = (nodeOut.images && nodeOut.images[0]) || (nodeOut.gifs && nodeOut.gifs[0]) || (nodeOut.videos && nodeOut.videos[0]);
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
    let collecting = false;
    let promptId = null;
    let pollTimer = null;
    const ws = new globalThis.WebSocket(wsUrl);

    const cleanup = () => {
      clearTimeout(timer);
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      try { ws.close(); } catch { /* ignore */ }
    };

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error("ComfyUI execution timed out."));
      }
    }, timeoutMs);

    const finishError = (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const finishSuccess = (result) => {
      if (settled) return;
      settled = true;
      cleanup();
      onProgress(100, "completed");
      resolve(result);
    };

    // Waits cleanly for ComfyUI's PromptQueue.task_done() to commit /history/{promptId}
    const collectFromHistory = async ({ waitForFlush = false } = {}) => {
      if (settled || collecting || !promptId) return;
      collecting = true;
      try {
        const maxAttempts = waitForFlush ? 25 : 1;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          if (settled) return;
          const result = await collectComfyOutputFromHistory(comfyUrl, promptId, workflow, outPath, { allowPending: true });
          if (result) {
            finishSuccess(result);
            return;
          }
          if (!waitForFlush) return;
          const stillQueued = await isPromptStillInComfyQueue(comfyUrl, promptId);
          if (!stillQueued && attempt >= maxAttempts - 1) break;
          await new Promise((r) => setTimeout(r, stillQueued ? 500 : 200));
        }
        if (waitForFlush && !settled) {
          const stillQueued = await isPromptStillInComfyQueue(comfyUrl, promptId);
          if (!stillQueued) {
            const finalRes = await collectComfyOutputFromHistory(comfyUrl, promptId, workflow, outPath, { allowPending: false });
            if (finalRes) finishSuccess(finalRes);
          }
        }
      } catch (err) {
        finishError(err);
      } finally {
        collecting = false;
      }
    };

    ws.addEventListener("open", async () => {
      try {
        promptId = await submitComfyPrompt(comfyUrl, workflow, clientId);
        onProgress(10, "queued_in_comfyui");
        pollTimer = setInterval(() => {
          collectFromHistory({ waitForFlush: false }).catch(() => {});
        }, 700);
      } catch (err) {
        finishError(err);
      }
    });

    ws.addEventListener("message", async (evt) => {
      try {
        if (typeof evt.data !== "string" || !promptId) return;
        const msg = JSON.parse(evt.data);
        const evtPromptId = msg.data?.prompt_id;
        if (evtPromptId && evtPromptId !== promptId) return;

        if (msg.type === "progress" && msg.data?.max) {
          const pct = Math.max(10, Math.min(98, Math.round((msg.data.value / msg.data.max) * 100)));
          onProgress(pct, `step ${msg.data.value}/${msg.data.max}`);
        } else if (msg.type === "execution_error" && evtPromptId === promptId) {
          finishError(new Error(msg.data?.exception_message || "ComfyUI execution_error"));
        } else if (msg.type === "execution_interrupted" && evtPromptId === promptId) {
          finishError(new Error("ComfyUI execution was interrupted."));
        } else if (
          (msg.type === "execution_success" && evtPromptId === promptId) ||
          (msg.type === "executing" && msg.data?.node === null && evtPromptId === promptId)
        ) {
          await collectFromHistory({ waitForFlush: true });
        } else if (msg.type === "executed" && evtPromptId === promptId) {
          await collectFromHistory({ waitForFlush: false });
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
