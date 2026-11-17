// src/server/hardware.js
// Real hardware & NVIDIA CUDA GPU detection via nvidia-smi, Windows CIM/WMI, and Node os/fs.

import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function queryNvidiaSmi() {
  try {
    const { stdout } = await execFileAsync(
      "nvidia-smi",
      [
        "--query-gpu=index,name,memory.total,memory.free,driver_version,compute_cap",
        "--format=csv,noheader,nounits",
      ],
      { timeout: 4000 }
    );
    const lines = String(stdout)
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) return [];

    return lines.map((line) => {
      const parts = line.split(",").map((p) => p.trim());
      const index = Number(parts[0]) || 0;
      const name = parts[1] || "NVIDIA GPU";
      const totalMib = Number(parts[2]) || 0;
      const freeMib = Number(parts[3]) || 0;
      const driverVersion = parts[4] || null;
      const computeCapRaw = parts[5] || "0";
      const computeCap = Number.parseFloat(computeCapRaw) || 0;
      const vramGb = Number((totalMib / 1024).toFixed(2));
      const freeVramGb = Number((freeMib / 1024).toFixed(2));
      const cudaSupported = computeCap >= 7.5; // Turing (sm_75, GTX 16-series+) minimum for CUDA engine
      return {
        index,
        vendor: "nvidia",
        name,
        vramGb,
        freeVramGb,
        totalMib,
        freeMib,
        driverVersion,
        computeCap: computeCapRaw,
        cudaSupported,
      };
    });
  } catch {
    return [];
  }
}

async function queryWindowsVideoControllers() {
  if (process.platform !== "win32") return [];
  try {
    const { stdout } = await execFileAsync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        "Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM,DriverVersion | ConvertTo-Json -Compress",
      ],
      { timeout: 4500 }
    );
    const trimmed = String(stdout).trim();
    if (!trimmed) return [];
    const parsed = JSON.parse(trimmed);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return arr
      .filter((a) => a && a.Name)
      .map((a, idx) => {
        const name = String(a.Name);
        const isNvidia = /nvidia|geforce|rtx|gtx|quadro/i.test(name);
        const ramBytes = Number(a.AdapterRAM) || 0;
        const vramGb = ramBytes > 0 ? Number((ramBytes / (1024 ** 3)).toFixed(2)) : 0;
        return {
          index: idx,
          vendor: isNvidia ? "nvidia" : /amd|radeon/i.test(name) ? "amd" : /intel/i.test(name) ? "intel" : "virtual",
          name,
          vramGb,
          freeVramGb: vramGb,
          driverVersion: a.DriverVersion || null,
          computeCap: null,
          cudaSupported: false,
        };
      });
  } catch {
    return [];
  }
}

export function getDiskStats(targetDir) {
  try {
    const checkPath = fs.existsSync(targetDir) ? targetDir : path.dirname(targetDir);
    const stats = fs.statfsSync(checkPath);
    const totalBytes = Number(stats.blocks) * Number(stats.bsize);
    const freeBytes = Number(stats.bavail) * Number(stats.bsize);
    return {
      totalDiskGb: Number((totalBytes / (1024 ** 3)).toFixed(2)),
      freeDiskGb: Number((freeBytes / (1024 ** 3)).toFixed(2)),
    };
  } catch {
    return { totalDiskGb: 0, freeDiskGb: 0 };
  }
}

export async function probeGpuAndSystem(storageDir = process.cwd()) {
  const nvidiaGpus = await queryNvidiaSmi();
  let gpus = nvidiaGpus;
  if (gpus.length === 0) {
    gpus = await queryWindowsVideoControllers();
  }

  // Pick the most capable GPU (matching SimpliGen's multi-GPU primary selection)
  const sorted = [...gpus].sort((a, b) => {
    if (a.cudaSupported !== b.cudaSupported) return a.cudaSupported ? -1 : 1;
    return (b.vramGb || 0) - (a.vramGb || 0);
  });

  const primary = sorted[0] || {
    index: 0,
    vendor: "cpu",
    name: os.cpus()[0]?.model || "No Dedicated GPU Detected",
    vramGb: 0,
    freeVramGb: 0,
    driverVersion: null,
    computeCap: null,
    cudaSupported: false,
  };

  const totalRamGb = Number((os.totalmem() / (1024 ** 3)).toFixed(2));
  const freeRamGb = Number((os.freemem() / (1024 ** 3)).toFixed(2));
  const disk = getDiskStats(storageDir);

  let tier = "unsupported";
  if (primary.cudaSupported) {
    if (primary.vramGb >= 16) tier = "16+";
    else if (primary.vramGb >= 12) tier = "12";
    else if (primary.vramGb >= 8) tier = "8";
    else if (primary.vramGb >= 4) tier = "4-6";
  }

  return {
    platform: process.platform,
    arch: process.arch,
    cpuModel: os.cpus()[0]?.model || "Unknown CPU",
    cpuCores: os.cpus().length,
    totalRamGb,
    freeRamGb,
    ...disk,
    gpus: sorted,
    primaryGpu: primary,
    gpuName: primary.name,
    vramGb: primary.vramGb,
    cudaSupported: Boolean(primary.cudaSupported),
    computeCap: primary.computeCap,
    driverVersion: primary.driverVersion,
    tier,
  };
}
