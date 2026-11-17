// src/server/hardware.js
// Real hardware & multi-GPU NVIDIA CUDA detection via nvidia-smi (CSV + -L + /proc fallback),
// Windows CIM/WMI, and Node os/fs metrics.

import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function inferCudaFromGpuName(name = "") {
  const n = String(name);
  if (!/nvidia|geforce|rtx|gtx|quadro|tesla|titan|a100|h100|h200|b100|b200|l40|l4\b|a10\b|a16\b|a30\b|a40\b|a6000|t4\b|v100|p100|p40/i.test(n)) {
    return { cudaSupported: false, computeCap: null };
  }
  // Pre-Turing architectures (Pascal/Maxwell/Kepler) are < sm_75
  if (/\b(gtx\s*(9\d0|10\d0)|titan\s*(x|xp)|p100|p40|p4|k80|m40|m60|gt\s*\d+)\b/i.test(n)) {
    return { cudaSupported: false, computeCap: "6.1" };
  }
  // Turing (RTX 20 / GTX 16 / T4), Ampere (RTX 30 / A100 / A10..A6000), Ada (RTX 40 / L4 / L40), Hopper/Blackwell (H100 / RTX 50)
  return { cudaSupported: true, computeCap: "8.0+" };
}

export function parseNvidiaSmiCsv(stdout, hasComputeCap = true) {
  const lines = String(stdout || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const parsed = [];
  for (const line of lines) {
    const parts = line.split(",").map((p) => p.trim());
    if (parts.length < 2) continue;
    const index = Number.parseInt(parts[0], 10);
    if (Number.isNaN(index)) continue;
    const name = parts[1] || `NVIDIA GPU #${index}`;
    const totalMib = Number.parseFloat(parts[2]) || 0;
    const freeMib = Number.parseFloat(parts[3]) || 0;
    const driverVersion = parts[4] && !/n\/a|not supported/i.test(parts[4]) ? parts[4] : null;
    const computeCapRaw = hasComputeCap ? (parts[5] || "") : "";
    const computeNum = Number.parseFloat(computeCapRaw);
    const inferred = inferCudaFromGpuName(name);
    const computeCap = Number.isFinite(computeNum) && computeNum > 0 ? computeCapRaw : inferred.computeCap;
    const cudaSupported = Number.isFinite(computeNum) && computeNum > 0 ? computeNum >= 7.5 : inferred.cudaSupported;
    const vramGb = totalMib > 0 ? Number((totalMib / 1024).toFixed(2)) : 0;
    const freeVramGb = freeMib > 0 ? Number((freeMib / 1024).toFixed(2)) : vramGb;
    parsed.push({
      index,
      vendor: "nvidia",
      name,
      vramGb,
      freeVramGb,
      totalMib,
      freeMib,
      driverVersion,
      computeCap,
      cudaSupported,
    });
  }
  return parsed;
}

export function parseNvidiaSmiList(stdout) {
  const lines = String(stdout || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const gpus = [];
  for (const line of lines) {
    const m = /^GPU\s+(\d+):\s+(.+?)(?:\s+\(UUID:.*\))?$/i.exec(line);
    if (!m) continue;
    const index = Number.parseInt(m[1], 10);
    const name = m[2].trim();
    const inferred = inferCudaFromGpuName(name);
    gpus.push({
      index,
      vendor: "nvidia",
      name,
      vramGb: 0,
      freeVramGb: 0,
      totalMib: 0,
      freeMib: 0,
      driverVersion: null,
      computeCap: inferred.computeCap,
      cudaSupported: inferred.cudaSupported,
    });
  }
  return gpus;
}

function getNvidiaSmiCandidates() {
  const list = ["nvidia-smi"];
  if (process.platform === "win32") {
    list.push("C:\\Windows\\System32\\nvidia-smi.exe");
  } else {
    list.push("/usr/bin/nvidia-smi", "/usr/local/nvidia/bin/nvidia-smi", "/usr/local/bin/nvidia-smi");
  }
  return list;
}

async function queryNvidiaSmi() {
  for (const bin of getNvidiaSmiCandidates()) {
    try {
      const { stdout } = await execFileAsync(
        bin,
        ["--query-gpu=index,name,memory.total,memory.free,driver_version,compute_cap", "--format=csv,noheader,nounits"],
        { timeout: 4000 }
      );
      const gpus = parseNvidiaSmiCsv(stdout, true);
      if (gpus.length > 0) return gpus;
    } catch {
      // Driver/container may reject compute_cap field; try without compute_cap
      try {
        const { stdout } = await execFileAsync(
          bin,
          ["--query-gpu=index,name,memory.total,memory.free,driver_version", "--format=csv,noheader,nounits"],
          { timeout: 4000 }
        );
        const gpus = parseNvidiaSmiCsv(stdout, false);
        if (gpus.length > 0) return gpus;
      } catch {
        // Last nvidia-smi attempt: nvidia-smi -L (detects multi-GPU setups even when metrics are restricted)
        try {
          const { stdout } = await execFileAsync(bin, ["-L"], { timeout: 4000 });
          const gpus = parseNvidiaSmiList(stdout);
          if (gpus.length > 0) return gpus;
        } catch {
          // continue checking next binary candidate
        }
      }
    }
  }

  // Linux kernel procfs fallback if nvidia-smi is absent inside minimal containers
  if (process.platform === "linux" && fs.existsSync("/proc/driver/nvidia/gpus")) {
    try {
      const dirs = fs.readdirSync("/proc/driver/nvidia/gpus").sort();
      const gpus = [];
      dirs.forEach((d, idx) => {
        const infoFile = path.join("/proc/driver/nvidia/gpus", d, "information");
        if (fs.existsSync(infoFile)) {
          const raw = fs.readFileSync(infoFile, "utf8");
          const m = /^Model:\s+(.+)$/im.exec(raw);
          const name = m ? m[1].trim() : `NVIDIA GPU #${idx}`;
          const inferred = inferCudaFromGpuName(name);
          gpus.push({
            index: idx,
            vendor: "nvidia",
            name,
            vramGb: 0,
            freeVramGb: 0,
            driverVersion: null,
            computeCap: inferred.computeCap,
            cudaSupported: inferred.cudaSupported,
          });
        }
      });
      if (gpus.length > 0) return gpus;
    } catch {
      // ignore procfs read errors
    }
  }

  return [];
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
        const isNvidia = /nvidia|geforce|rtx|gtx|quadro|tesla|a100|h100|l40|a6000/i.test(name);
        const ramBytes = Number(a.AdapterRAM) || 0;
        const vramGb = ramBytes > 0 ? Number((ramBytes / (1024 ** 3)).toFixed(2)) : 0;
        const inferred = inferCudaFromGpuName(name);
        return {
          index: idx,
          vendor: isNvidia ? "nvidia" : /amd|radeon/i.test(name) ? "amd" : /intel/i.test(name) ? "intel" : "virtual",
          name,
          vramGb,
          freeVramGb: vramGb,
          driverVersion: a.DriverVersion || null,
          computeCap: isNvidia ? inferred.computeCap : null,
          cudaSupported: isNvidia ? inferred.cudaSupported : false,
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
    if ((b.vramGb || 0) !== (a.vramGb || 0)) return (b.vramGb || 0) - (a.vramGb || 0);
    return (a.index || 0) - (b.index || 0);
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

  const cudaGpus = sorted.filter((g) => g.cudaSupported);
  const totalVramGb = Number(
    (cudaGpus.length > 0 ? cudaGpus : [primary]).reduce((sum, g) => sum + (Number(g.vramGb) || 0), 0).toFixed(2)
  );

  const totalRamGb = Number((os.totalmem() / (1024 ** 3)).toFixed(2));
  const freeRamGb = Number((os.freemem() / (1024 ** 3)).toFixed(2));
  const disk = getDiskStats(storageDir);

  let tier = "unsupported";
  if (primary.cudaSupported) {
    if (primary.vramGb >= 16) tier = "16+";
    else if (primary.vramGb >= 12) tier = "12";
    else if (primary.vramGb >= 8) tier = "8";
    else if (primary.vramGb >= 4) tier = "4-6";
    else tier = "8"; // nvidia-smi -L / restricted VRAM reporting on Turing+ cards
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
    gpuCount: sorted.length,
    cudaGpuCount: cudaGpus.length,
    totalVramGb,
    primaryGpu: primary,
    gpuName: primary.name,
    vramGb: primary.vramGb,
    cudaSupported: Boolean(primary.cudaSupported),
    computeCap: primary.computeCap,
    driverVersion: primary.driverVersion,
    tier,
  };
}
