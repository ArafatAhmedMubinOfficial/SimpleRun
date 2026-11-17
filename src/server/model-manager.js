// src/server/model-manager.js
// Real ComfyUI model filesystem layout, recursive disk scanner, .safetensors binary header
// parser, Managed-vs-External dependency reconciliation, and resumable HTTP model downloader.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { getDiskStats } from "./hardware.js";

export const MODEL_SUBFOLDERS = [
  "checkpoints",
  "diffusion_models",
  "unet",
  "vae",
  "loras",
  "clip",
  "text_encoders",
  "upscale_models",
  "controlnet",
];

export const MODEL_EXTENSIONS = new Set([".safetensors", ".ckpt", ".pt", ".pth", ".bin", ".gguf"]);

export function ensureModelDirectories(modelsRoot) {
  fs.mkdirSync(modelsRoot, { recursive: true });
  for (const sub of MODEL_SUBFOLDERS) {
    fs.mkdirSync(path.join(modelsRoot, sub), { recursive: true });
  }
}

/**
 * Reads the binary header of a .safetensors file (8-byte LE uint64 length + JSON header)
 * without loading the multi-GB tensor weights into RAM.
 */
export function parseSafetensorsHeader(filePath) {
  let fd;
  try {
    const stat = fs.statSync(filePath);
    if (stat.size < 16) return null;
    fd = fs.openSync(filePath, "r");
    const lenBuf = Buffer.alloc(8);
    fs.readSync(fd, lenBuf, 0, 8, 0);
    const headerLenBig = lenBuf.readBigUInt64LE(0);
    if (headerLenBig <= 0n || headerLenBig > 16n * 1024n * 1024n) return null;
    const headerLen = Number(headerLenBig);
    const headerBuf = Buffer.alloc(headerLen);
    const bytesRead = fs.readSync(fd, headerBuf, 0, headerLen, 8);
    if (bytesRead !== headerLen) return null;
    const parsed = JSON.parse(headerBuf.toString("utf8"));
    const metadata = parsed.__metadata__ || {};
    const tensorKeys = Object.keys(parsed).filter((k) => k !== "__metadata__");
    return {
      tensorCount: tensorKeys.length,
      baseModel: metadata.ss_base_model_version || metadata.modelspec_architecture || null,
      author: metadata.ss_author || metadata.modelspec_author || null,
      triggerWords: metadata.ss_tag_frequency ? Object.keys(metadata.ss_tag_frequency).slice(0, 5).join(", ") : null,
      metadata,
    };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* ignore */ }
    }
  }
}

export function scanModelsDirectory(modelsRoot, installedPacks = [], capabilities = []) {
  ensureModelDirectories(modelsRoot);

  const installedPackIds = new Set(installedPacks.filter((p) => p.installed).map((p) => p.packId));
  // Build reverse index: filename -> [presetIds]
  const claimedBy = new Map();
  for (const cap of capabilities) {
    if (!installedPackIds.has(cap.packId)) continue;
    for (const req of cap.requiredModels || []) {
      const list = claimedBy.get(req.filename) || [];
      list.push(cap.presetId);
      claimedBy.set(req.filename, list);
    }
  }

  const files = [];
  let totalBytes = 0;

  function walk(dir, relFolder) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, relFolder ? `${relFolder}/${entry.name}` : entry.name);
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name.endsWith(".part")) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!MODEL_EXTENSIONS.has(ext)) continue;

      const stat = fs.statSync(fullPath);
      totalBytes += stat.size;
      const usedByPresets = claimedBy.get(entry.name) || [];
      const inRoot = !relFolder;
      let status = "External";
      if (inRoot) status = "Not in a model folder";
      else if (usedByPresets.length > 0) status = "Managed";

      const safetensorsInfo = ext === ".safetensors" ? parseSafetensorsHeader(fullPath) : null;

      files.push({
        filename: entry.name,
        relativePath: relFolder ? `${relFolder}/${entry.name}` : entry.name,
        fullPath,
        folder: relFolder || "(root)",
        sizeBytes: stat.size,
        sizeGb: Number((stat.size / (1024 ** 3)).toFixed(3)),
        sizeMb: Number((stat.size / (1024 ** 2)).toFixed(1)),
        usedByPresets,
        status,
        safetensors: safetensorsInfo
          ? { tensorCount: safetensorsInfo.tensorCount, baseModel: safetensorsInfo.baseModel }
          : null,
        modifiedAt: stat.mtime.toISOString(),
      });
    }
  }

  walk(modelsRoot, "");
  const disk = getDiskStats(modelsRoot);

  return {
    modelsRoot,
    totalUsedGb: Number((totalBytes / (1024 ** 3)).toFixed(3)),
    totalUsedBytes: totalBytes,
    freeDiskGb: disk.freeDiskGb,
    totalDiskGb: disk.totalDiskGb,
    files,
  };
}

export function scanLorasDirectory(modelsRoot, registeredLoras = []) {
  const loraDir = path.join(modelsRoot, "loras");
  fs.mkdirSync(loraDir, { recursive: true });
  const regMap = new Map(registeredLoras.map((l) => [l.filename, l]));
  const result = [];

  for (const entry of fs.readdirSync(loraDir, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name.endsWith(".part")) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!MODEL_EXTENSIONS.has(ext)) continue;
    const fullPath = path.join(loraDir, entry.name);
    const stat = fs.statSync(fullPath);
    const meta = regMap.get(entry.name);
    const header = ext === ".safetensors" ? parseSafetensorsHeader(fullPath) : null;

    result.push({
      id: meta?.id || `lora_disk_${crypto.createHash("md5").update(entry.name).digest("hex").slice(0, 8)}`,
      name: meta?.name || entry.name.replace(/\.[^.]+$/, ""),
      filename: entry.name,
      fullPath,
      baseModel: meta?.baseModel || header?.baseModel || "unknown",
      triggerWords: meta?.triggerWords || header?.triggerWords || "",
      defaultStrength: meta?.defaultStrength ?? 1.0,
      sizeMb: Number((stat.size / (1024 ** 2)).toFixed(1)),
      onDisk: true,
    });
  }

  return result;
}

export function deletePhysicalModelFile(modelsRoot, filenameOrRel) {
  const normalized = filenameOrRel.replace(/\\/g, "/").replace(/^\/+/, "");
  const directCandidate = path.resolve(modelsRoot, normalized);
  if (!directCandidate.startsWith(path.resolve(modelsRoot))) {
    throw new Error("Invalid model path.");
  }
  if (fs.existsSync(directCandidate) && fs.statSync(directCandidate).isFile()) {
    const stat = fs.statSync(directCandidate);
    fs.unlinkSync(directCandidate);
    return { deleted: normalized, reclaimedBytes: stat.size, reclaimedGb: Number((stat.size / (1024 ** 3)).toFixed(3)) };
  }
  // Search by basename inside subfolders
  const scanned = scanModelsDirectory(modelsRoot);
  const match = scanned.files.find((f) => f.filename === filenameOrRel || f.relativePath === normalized);
  if (!match) return null;
  fs.unlinkSync(match.fullPath);
  return { deleted: match.filename, reclaimedBytes: match.sizeBytes, reclaimedGb: match.sizeGb };
}

export class ModelDownloadManager {
  constructor() {
    this.active = new Map();
  }

  listDownloads() {
    return Array.from(this.active.values());
  }

  async downloadFile({ id, url, destPath, authToken = "", kind = "huggingface" }) {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    const partPath = `${destPath}.part`;
    let existingBytes = fs.existsSync(partPath) ? fs.statSync(partPath).size : 0;

    const record = {
      id: id || path.basename(destPath),
      filename: path.basename(destPath),
      url,
      destPath,
      status: "downloading",
      bytesDownloaded: existingBytes,
      totalBytes: null,
      percent: 0,
      speedMbps: 0,
      error: null,
      startedAt: new Date().toISOString(),
    };
    this.active.set(record.id, record);

    const headers = { "User-Agent": "SimpleTun/1.0" };
    if (authToken) {
      headers.Authorization = `Bearer ${authToken}`;
    }
    if (existingBytes > 0) {
      headers.Range = `bytes=${existingBytes}-`;
    }

    try {
      const res = await fetch(url, { headers, redirect: "follow" });
      if (res.status === 401 || res.status === 403) {
        record.status = "failed";
        record.error = kind === "huggingface"
          ? "gated_model_auth_required: Enter a valid HuggingFace Read token in Model Manager and accept the model license on huggingface.co."
          : "civitai_auth_required: Enter your Civitai API key in Model Manager.";
        throw Object.assign(new Error(record.error), { status: 401, errorCode: "download_auth_required" });
      }
      if (res.status === 416) {
        // Range not satisfiable; restart from 0
        existingBytes = 0;
        if (fs.existsSync(partPath)) fs.unlinkSync(partPath);
        return this.downloadFile({ id, url, destPath, authToken, kind });
      }
      if (!res.ok) {
        record.status = "failed";
        record.error = `HTTP ${res.status} ${res.statusText}`;
        throw new Error(record.error);
      }

      const contentLen = Number(res.headers.get("content-length") || 0);
      const isResume = res.status === 206;
      if (!isResume) existingBytes = 0;
      record.totalBytes = contentLen > 0 ? existingBytes + contentLen : null;

      const writeStream = fs.createWriteStream(partPath, { flags: isResume ? "a" : "w" });
      const reader = Readable.fromWeb(res.body);
      let lastTick = Date.now();
      let lastBytes = existingBytes;

      reader.on("data", (chunk) => {
        record.bytesDownloaded += chunk.length;
        if (record.totalBytes) {
          record.percent = Math.min(100, Math.round((record.bytesDownloaded / record.totalBytes) * 100));
        }
        const now = Date.now();
        const dt = (now - lastTick) / 1000;
        if (dt >= 0.4) {
          const mbps = ((record.bytesDownloaded - lastBytes) * 8) / (dt * 1_000_000);
          record.speedMbps = Number(mbps.toFixed(2));
          lastTick = now;
          lastBytes = record.bytesDownloaded;
        }
      });

      await pipeline(reader, writeStream);
      fs.renameSync(partPath, destPath);
      record.status = "completed";
      record.percent = 100;
      record.completedAt = new Date().toISOString();
      return record;
    } catch (err) {
      record.status = "failed";
      record.error = err.message;
      throw err;
    }
  }
}
