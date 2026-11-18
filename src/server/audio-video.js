// src/server/audio-video.js
// Real Audio DSP Tempo Detector (PCM decode + RMS onset envelope + autocorrelation 68-165 BPM),
// real ffmpeg last-frame extractor for Video Studio clip continuity, and ffmpeg film stitcher.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Converts an animated ComfyUI output (.webp/.gif) into a browser-playable H.264 .mp4
 * and extracts its first frame as a poster PNG.
 * Falls back to Pillow frame extraction + ffmpeg when distro ffmpeg lacks WebP ANMF decoding.
 */
export async function transcodeAnimatedToMp4(
  inputPath,
  outMp4Path,
  posterPngPath,
  { fps = 24, pythonBin = process.platform === "win32" ? "python" : "python3" } = {}
) {
  fs.mkdirSync(path.dirname(outMp4Path), { recursive: true });
  const ext = path.extname(inputPath).toLowerCase();

  // If input is already .mp4/.webm/.mov, copy/ensure output and extract poster frame
  if (ext === ".mp4" || ext === ".webm" || ext === ".mov") {
    if (path.resolve(inputPath) !== path.resolve(outMp4Path)) {
      fs.copyFileSync(inputPath, outMp4Path);
    }
    if (posterPngPath) {
      try {
        await execFileAsync("ffmpeg", ["-v", "error", "-y", "-i", outMp4Path, "-frames:v", "1", posterPngPath], {
          timeout: 15000,
        });
      } catch { /* ignore poster failure */ }
    }
    return { outPath: outMp4Path, posterPath: fs.existsSync(posterPngPath) ? posterPngPath : null };
  }

  // 1. Try direct ffmpeg decode (works cleanly on modern ffmpeg builds)
  try {
    await execFileAsync(
      "ffmpeg",
      [
        "-v", "error", "-y", "-i", inputPath,
        "-movflags", "+faststart",
        "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p",
        "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
        outMp4Path,
      ],
      { timeout: 60000 }
    );
    if (fs.existsSync(outMp4Path) && fs.statSync(outMp4Path).size > 256) {
      if (posterPngPath) {
        try {
          await execFileAsync("ffmpeg", ["-v", "error", "-y", "-i", outMp4Path, "-frames:v", "1", posterPngPath], {
            timeout: 15000,
          });
        } catch { /* ignore */ }
      }
      return { outPath: outMp4Path, posterPath: fs.existsSync(posterPngPath) ? posterPngPath : null };
    }
  } catch {
    // Fall through to Pillow frame extraction when distro ffmpeg cannot demux animated WebP chunks
  }

  // 2. Reliable Pillow frame extraction -> ffmpeg x264 encode
  const tmpFramesDir = fs.mkdtempSync(path.join(os.tmpdir(), "simpletun-webp-frames-"));
  try {
    const pyScript = [
      "import sys, os",
      "from PIL import Image, ImageSequence",
      "src, out_dir, poster = sys.argv[1], sys.argv[2], sys.argv[3]",
      "im = Image.open(src)",
      "count = 0",
      "for i, frame in enumerate(ImageSequence.Iterator(im)):",
      "    rgb = frame.convert('RGB')",
      "    if i == 0 and poster:",
      "        rgb.save(poster, format='PNG')",
      "    rgb.save(os.path.join(out_dir, f'frame_{i:05d}.png'), format='PNG')",
      "    count += 1",
      "if count == 0:",
      "    raise RuntimeError('No frames in animated image')",
    ].join("\n");

    await execFileAsync(pythonBin, ["-c", pyScript, inputPath, tmpFramesDir, posterPngPath || ""], {
      timeout: 60000,
    });

    await execFileAsync(
      "ffmpeg",
      [
        "-v", "error", "-y",
        "-framerate", String(Math.max(1, Number(fps) || 24)),
        "-i", path.join(tmpFramesDir, "frame_%05d.png"),
        "-movflags", "+faststart",
        "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p",
        "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
        outMp4Path,
      ],
      { timeout: 60000 }
    );

    if (fs.existsSync(outMp4Path) && fs.statSync(outMp4Path).size > 256) {
      return { outPath: outMp4Path, posterPath: fs.existsSync(posterPngPath) ? posterPngPath : null };
    }
    throw new Error("Encoded MP4 file was empty.");
  } finally {
    fs.rmSync(tmpFramesDir, { recursive: true, force: true });
  }
}

/**
 * Parses an uncompressed RIFF/WAVE PCM16 buffer directly in JS when available,
 * or decodes any audio format (.mp3, .wav, .ogg, .m4a) via ffmpeg into 22050Hz mono s16le PCM.
 */
async function decodeAudioToMono22k(audioPath) {
  // Attempt ffmpeg decode first (supports MP3, OGG, M4A, WAV, etc.)
  try {
    const { stdout } = await execFileAsync(
      "ffmpeg",
      ["-v", "error", "-i", audioPath, "-f", "s16le", "-ac", "1", "-ar", "22050", "-t", "45", "pipe:1"],
      { encoding: "buffer", maxBuffer: 8 * 1024 * 1024, timeout: 15000 }
    );
    if (stdout && stdout.length >= 2000) {
      const sampleRate = 22050;
      const samples = new Float32Array(Math.floor(stdout.length / 2));
      for (let i = 0; i < samples.length; i++) {
        samples[i] = stdout.readInt16LE(i * 2) / 32768;
      }
      return { sampleRate, samples };
    }
  } catch {
    // Fall back to direct RIFF/WAVE parser below
  }

  const raw = fs.readFileSync(audioPath);
  if (raw.length >= 44 && raw.toString("ascii", 0, 4) === "RIFF" && raw.toString("ascii", 8, 12) === "WAVE") {
    let offset = 12;
    let sampleRate = 22050;
    let channels = 1;
    let bitsPerSample = 16;
    let dataStart = 44;
    let dataSize = raw.length - 44;

    while (offset + 8 <= raw.length) {
      const id = raw.toString("ascii", offset, offset + 4);
      const size = raw.readUInt32LE(offset + 4);
      if (id === "fmt ") {
        channels = raw.readUInt16LE(offset + 10);
        sampleRate = raw.readUInt32LE(offset + 12);
        bitsPerSample = raw.readUInt16LE(offset + 22);
      } else if (id === "data") {
        dataStart = offset + 8;
        dataSize = Math.min(size, raw.length - dataStart);
        break;
      }
      offset += 8 + size + (size % 2);
    }

    if (bitsPerSample === 16 && dataSize >= 4) {
      const frameCount = Math.floor(dataSize / (2 * channels));
      const samples = new Float32Array(frameCount);
      for (let i = 0; i < frameCount; i++) {
        let sum = 0;
        for (let ch = 0; ch < channels; ch++) {
          sum += raw.readInt16LE(dataStart + (i * channels + ch) * 2) / 32768;
        }
        samples[i] = sum / channels;
      }
      return { sampleRate, samples };
    }
  }

  throw new Error("Could not decode audio file (requires valid WAV PCM or ffmpeg installed).");
}

/**
 * Real DSP Tempo & First Downbeat Detector.
 * Throws errorCode "no_pulse" when audio is silent or has no detectable rhythmic pulse.
 */
export async function detectAudioTempo(audioPath) {
  const { sampleRate, samples } = await decodeAudioToMono22k(audioPath);
  if (!samples || samples.length < sampleRate * 1.5) {
    const err = new Error("No steady beat could be heard in the track (audio too short).");
    err.status = 400;
    err.errorCode = "no_pulse";
    throw err;
  }

  // Check RMS energy to reject silent tracks cleanly
  let totalSq = 0;
  for (let i = 0; i < samples.length; i++) totalSq += samples[i] * samples[i];
  const rmsAll = Math.sqrt(totalSq / samples.length);
  if (rmsAll < 1e-4) {
    const err = new Error("No steady beat could be heard in the track (audio is silent).");
    err.status = 400;
    err.errorCode = "no_pulse";
    throw err;
  }

  const hop = Math.max(128, Math.round(sampleRate * 0.0116)); // ~11.6ms frame hop
  const frameRate = sampleRate / hop;
  const numFrames = Math.floor(samples.length / hop);
  const env = new Float32Array(numFrames);

  for (let f = 0; f < numFrames; f++) {
    let e = 0;
    const base = f * hop;
    for (let j = 0; j < hop; j++) {
      const s = samples[base + j];
      e += s * s;
    }
    env[f] = Math.sqrt(e / hop);
  }

  // First-order positive onset strength envelope
  const onset = new Float32Array(numFrames);
  let meanOnset = 0;
  for (let f = 1; f < numFrames; f++) {
    const diff = env[f] - env[f - 1];
    onset[f] = diff > 0 ? diff : 0;
    meanOnset += onset[f];
  }
  meanOnset /= numFrames;

  if (meanOnset < 1e-5) {
    const err = new Error("No steady beat could be heard in the track (flat envelope).");
    err.status = 400;
    err.errorCode = "no_pulse";
    throw err;
  }

  // Mean-subtract onset envelope for clean autocorrelation
  for (let f = 0; f < numFrames; f++) onset[f] -= meanOnset;

  const minBpm = 68;
  const maxBpm = 165;
  const minLag = Math.max(2, Math.floor((60 * frameRate) / maxBpm));
  const maxLag = Math.min(Math.floor(numFrames / 2), Math.ceil((60 * frameRate) / minBpm));

  let bestLag = minLag;
  let bestCorr = -Infinity;
  let zeroLag = 0;
  for (let f = 0; f < numFrames; f++) zeroLag += onset[f] * onset[f];

  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    const limit = numFrames - lag;
    for (let f = 0; f < limit; f++) {
      sum += onset[f] * onset[f + lag];
    }
    const corr = zeroLag > 0 ? sum / zeroLag : 0;
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }

  if (bestCorr < 0.08) {
    const err = new Error("No steady beat could be heard in the track (weak periodicity).");
    err.status = 400;
    err.errorCode = "no_pulse";
    throw err;
  }

  const bpm = Number(((60 * frameRate) / bestLag).toFixed(1));

  // Find first prominent beat peak inside the first beat period
  let peakIdx = 0;
  let peakVal = -Infinity;
  const searchFrames = Math.min(numFrames, Math.ceil(bestLag * 1.2));
  for (let f = 0; f < searchFrames; f++) {
    if (env[f] > peakVal) {
      peakVal = env[f];
      peakIdx = f;
    }
  }
  const offset = Number((peakIdx / frameRate).toFixed(3));

  return { bpm, offset, confidence: Number(bestCorr.toFixed(3)) };
}

/**
 * Extracts the final frame of a rendered video clip so the next clip with link="continue"
 * can genuinely pass that frame into Image-to-Video.
 */
export async function extractLastFrame(videoPath, outPngPath) {
  fs.mkdirSync(path.dirname(outPngPath), { recursive: true });
  await execFileAsync(
    "ffmpeg",
    ["-v", "error", "-y", "-sseof", "-0.15", "-i", videoPath, "-frames:v", "1", outPngPath],
    { timeout: 15000 }
  );
  if (!fs.existsSync(outPngPath)) {
    throw new Error("ffmpeg did not produce extracted last frame.");
  }
  return outPngPath;
}

/**
 * Real ffmpeg multi-clip + multi-track film stitcher with trimIn, clip fades, scale/pad to film resolution,
 * and audio track mixing (respecting track start offset, volume, and mute).
 */
export async function stitchFilmWithFfmpeg({ outPath, clips = [], tracks = [], width = 854, height = 480, exportRange = null }) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const w = Math.max(128, width & ~1);
  const h = Math.max(128, height & ~1);

  const validClips = clips.filter((c) => c.resultPath && fs.existsSync(c.resultPath));
  if (validClips.length === 0) {
    throw new Error("No rendered clip files found to export.");
  }

  const args = ["-v", "error", "-y"];
  validClips.forEach((c) => {
    args.push("-i", c.resultPath);
  });

  const activeTracks = tracks.filter((t) => !t.muted && t.filePath && fs.existsSync(t.filePath));
  activeTracks.forEach((t) => {
    args.push("-i", t.filePath);
  });

  const filterParts = [];
  const concatInputs = [];

  validClips.forEach((c, idx) => {
    const trimStart = Math.max(0, Number(c.trimIn) || 0);
    const clipDur = Math.max(0.5, Number(c.length) || 4);
    let chain = `[${idx}:v]trim=start=${trimStart}:duration=${clipDur},setpts=PTS-STARTPTS,scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24,format=yuv420p`;
    if (c.fadeIn && c.fadeIn > 0) {
      chain += `,fade=t=in:st=0:d=${c.fadeIn}`;
    }
    if (c.fadeOut && c.fadeOut > 0 && clipDur > c.fadeOut) {
      chain += `,fade=t=out:st=${(clipDur - c.fadeOut).toFixed(3)}:d=${c.fadeOut}`;
    }
    chain += `[v${idx}]`;
    filterParts.push(chain);
    concatInputs.push(`[v${idx}]`);
  });

  filterParts.push(`${concatInputs.join("")}concat=n=${validClips.length}:v=1:a=0[vcat]`);

  let mapVideo = "[vcat]";
  let mapAudio = null;

  if (activeTracks.length > 0) {
    const audioLabels = [];
    activeTracks.forEach((t, tIdx) => {
      const inputIdx = validClips.length + tIdx;
      const delayMs = Math.max(0, Math.round((Number(t.at) || 0) * 1000));
      const vol = t.volume !== undefined ? Number(t.volume) : 1.0;
      let aChain = `[${inputIdx}:a]volume=${vol}`;
      if (delayMs > 0) aChain += `,adelay=${delayMs}|${delayMs}`;
      if (t.fadeIn && t.fadeIn > 0) aChain += `,afade=t=in:st=0:d=${t.fadeIn}`;
      aChain += `[a${tIdx}]`;
      filterParts.push(aChain);
      audioLabels.push(`[a${tIdx}]`);
    });
    if (audioLabels.length === 1) {
      mapAudio = audioLabels[0];
    } else {
      filterParts.push(`${audioLabels.join("")}amix=inputs=${audioLabels.length}:duration=longest[amixed]`);
      mapAudio = "[amixed]";
    }
  }

  args.push("-filter_complex", filterParts.join(";"));
  args.push("-map", mapVideo);
  if (mapAudio) {
    args.push("-map", mapAudio, "-c:a", "aac", "-shortest");
  }
  if (exportRange && Number.isFinite(exportRange.from) && Number.isFinite(exportRange.to) && exportRange.to > exportRange.from) {
    args.push("-ss", String(exportRange.from), "-t", String(exportRange.to - exportRange.from));
  }
  args.push("-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", outPath);

  await execFileAsync("ffmpeg", args, { timeout: 90000 });
  const stat = fs.statSync(outPath);
  return { outPath, bytes: stat.size, engine: "ffmpeg-filtergraph" };
}
