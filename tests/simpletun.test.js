// tests/simpletun.test.js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { spawn, execFileSync } from "node:child_process";

import { startServer } from "../src/server/index.js";
import { probeGpuAndSystem, parseNvidiaSmiCsv, parseNvidiaSmiList, inferCudaFromGpuName } from "../src/server/hardware.js";
import { parseSafetensorsHeader, verifySafetensorsComplete, scanModelsDirectory, deletePhysicalModelFile } from "../src/server/model-manager.js";
import { compileComfyWorkflow, executeComfyWorkflow, embedPngWorkflowMetadata } from "../src/server/comfy-workflows.js";
import { ControlApiClient, createMcpServer, TOOL_NAMES } from "../packages/mcp-server/src/index.js";

const SAMPLE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function buildSafetensorsBytes(baseModel = "flux") {
  const headerObj = {
    __metadata__: { ss_base_model_version: baseModel, ss_tag_frequency: { fox_style: { fox: 12 } } },
    "lora_unet.weight": { dtype: "F16", shape: [2, 2], data_offsets: [0, 8] },
  };
  const headerBuf = Buffer.from(JSON.stringify(headerObj), "utf8");
  const lenBuf = Buffer.alloc(8);
  lenBuf.writeBigUInt64LE(BigInt(headerBuf.length), 0);
  const tensorPayload = Buffer.alloc(8);
  return Buffer.concat([lenBuf, headerBuf, tensorPayload]);
}

function buildTestWav({ bpm = 120, durationSec = 4.0, silent = false } = {}) {
  const sampleRate = 22050;
  const numSamples = Math.floor(sampleRate * durationSec);
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);

  if (!silent) {
    const period = 60 / bpm;
    const pulseSamples = Math.floor(sampleRate * 0.045);
    for (let beatIdx = 0; ; beatIdx++) {
      const startSample = Math.floor((0.1 + beatIdx * period) * sampleRate);
      if (startSample >= numSamples) break;
      for (let k = 0; k < pulseSamples && startSample + k < numSamples; k++) {
        const env = Math.exp(-k / (pulseSamples * 0.35));
        const val = Math.sin((2 * Math.PI * 180 * k) / sampleRate) * env * 0.85;
        buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(val * 32767))), 44 + (startSample + k) * 2);
      }
    }
  }
  return buf;
}

function sendWsTextFrame(socket, obj) {
  const payload = Buffer.from(JSON.stringify(obj), "utf8");
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x81, len]);
  } else {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  }
  socket.write(Buffer.concat([header, payload]));
}

async function startMockComfyServer() {
  const wsClients = new Set();
  const seenUploads = [];
  const seenPrompts = new Map();

  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://127.0.0.1");
    if (req.method === "GET" && u.pathname === "/system_stats") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ system: { comfyui_version: "0.3.14-mock" } }));
    }
    if (req.method === "POST" && u.pathname === "/upload/image") {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        seenUploads.push(Buffer.concat(chunks).length);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ name: "uploaded_ref.png", subfolder: "", type: "input" }));
      });
      return;
    }
    if (req.method === "POST" && u.pathname === "/prompt") {
      let bodyStr = "";
      req.on("data", (c) => (bodyStr += c));
      req.on("end", () => {
        const parsed = JSON.parse(bodyStr);
        const promptId = crypto.randomUUID();
        seenPrompts.set(promptId, parsed.prompt);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ prompt_id: promptId }));
        setTimeout(() => {
          for (const sock of wsClients) {
            sendWsTextFrame(sock, { type: "progress", data: { value: 4, max: 8, prompt_id: promptId } });
            sendWsTextFrame(sock, { type: "executing", data: { node: null, prompt_id: promptId } });
          }
        }, 25);
      });
      return;
    }
    if (req.method === "GET" && u.pathname.startsWith("/history/")) {
      const pid = u.pathname.slice("/history/".length);
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(
        JSON.stringify({
          [pid]: {
            outputs: {
              "8": { images: [{ filename: `mock_${pid}.png`, subfolder: "", type: "output" }] },
            },
          },
        })
      );
    }
    if (req.method === "GET" && u.pathname === "/view") {
      res.writeHead(200, { "Content-Type": "image/png" });
      return res.end(Buffer.from(SAMPLE_PNG_BASE64, "base64"));
    }
    res.writeHead(404);
    res.end();
  });

  server.on("upgrade", (req, socket) => {
    const key = req.headers["sec-websocket-key"];
    const accept = crypto.createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    wsClients.add(socket);
    socket.on("close", () => wsClients.delete(socket));
    socket.on("error", () => wsClients.delete(socket));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    server,
    url: `http://127.0.0.1:${port}`,
    seenUploads,
    seenPrompts,
    close() {
      for (const s of wsClients) s.destroy();
      wsClients.clear();
      server.closeAllConnections?.();
      server.close();
    },
  };
}

function rawHttpGet(port, pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: pathname, method: "GET", headers },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
      }
    );
    req.on("error", reject);
    req.end();
  });
}

test("SimpleTun End-to-End Control API, Studios, Video Timeline, and 74-Tool MCP Server", async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "simpletun-test-"));
  // Copy public dir path reference? Server uses ROOT_DIR for public by default, only store uses rootDir
  const { server, store, port, url } = await startServer({ port: 0, rootDir: tempRoot });
  const token = "st-agent-simpletun-open";
  const authHeaders = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  t.after(() => {
    server.closeAllConnections?.();
    server.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  await t.test("Health, Static UI Assets, DNS-rebinding Host guard (403), Remote Host Opt-in, and Bearer auth (401)", async () => {
    const health = await fetch(`${url}/health`);
    assert.equal(health.status, 200);
    const hj = await health.json();
    assert.equal(hj.ok, true);
    assert.equal(hj.name, "simpletun");

    for (const asset of ["/", "/styles.css", "/app.js", "/api.js", "/views-generate.js", "/views-studios.js", "/views-site.js"]) {
      const aRes = await fetch(`${url}${asset}`);
      assert.equal(aRes.status, 200, `Expected 200 for UI static asset ${asset}`);
    }

    const badHost = await rawHttpGet(port, "/health", { Host: "evil.example.com" });
    assert.equal(badHost.status, 403);
    assert.equal(badHost.body.errorCode, "forbidden_host");

    const unauth = await fetch(`${url}/status`);
    assert.equal(unauth.status, 401);
    const uj = await unauth.json();
    assert.equal(uj.errorCode, "unauthorized");

    // Remote / cloud proxy Host opt-in
    const remoteSrv = await startServer({
      port: 0,
      rootDir: tempRoot,
      allowedHosts: ["*.proxy.runpod.net", "gpu-box.lan"],
    });
    try {
      const okProxy = await rawHttpGet(remoteSrv.port, "/health", { Host: "abc-48199.proxy.runpod.net" });
      assert.equal(okProxy.status, 200);
      assert.equal(okProxy.body.ok, true);
      const blockedProxy = await rawHttpGet(remoteSrv.port, "/health", { Host: "evil.example.com" });
      assert.equal(blockedProxy.status, 403);
    } finally {
      remoteSrv.server.closeAllConnections?.();
      remoteSrv.server.close();
    }

    const openRemoteSrv = await startServer({
      port: 0,
      rootDir: tempRoot,
      allowRemoteHosts: true,
    });
    try {
      const okRemote = await rawHttpGet(openRemoteSrv.port, "/health", { Host: "192.168.1.55:48199" });
      assert.equal(okRemote.status, 200);
      assert.equal(okRemote.body.ok, true);

      // Verify sub-path proxy support (/proxy/48199/...) and relative asset references
      const htmlRes = await fetch(`${openRemoteSrv.url}/proxy/48199/`);
      assert.equal(htmlRes.status, 200);
      const htmlBody = await htmlRes.text();
      assert.match(htmlBody, /href="\.\/styles\.css"/);
      assert.match(htmlBody, /src="\.\/app\.js"/);

      const cssProxyRes = await fetch(`${openRemoteSrv.url}/proxy/48199/styles.css`);
      assert.equal(cssProxyRes.status, 200);
      const bootProxyRes = await fetch(`${openRemoteSrv.url}/proxy/48199/api/ui/bootstrap`, {
        headers: { "X-SimpleTun-UI": "1" },
      });
      assert.equal(bootProxyRes.status, 200);
    } finally {
      openRemoteSrv.server.closeAllConnections?.();
      openRemoteSrv.server.close();
    }
  });

  await t.test("Status, Capabilities, Real Engine 409 check, Prompt Guides, and Disk LoRAs", async () => {
    // Point comfyUiUrl at an unused port so local tests are independent of any background process on 8188
    await fetch(`${url}/api/ui/settings`, {
      method: "POST",
      headers: { ...authHeaders, "X-SimpleTun-UI": "1" },
      body: JSON.stringify({ comfyUiUrl: "http://127.0.0.1:59991" }),
    });

    const stRes = await fetch(`${url}/status`, { headers: authHeaders });
    assert.equal(stRes.status, 200);
    const st = await stRes.json();
    assert.equal(st.engineRunning, false);
    assert.equal(st.engineInstalled, false);
    assert.equal(st.videoStudioInstalled, true);
    assert.ok(typeof st.gpuName === "string" && st.gpuName.length > 0);
    assert.ok(st.totalRamGb > 0);
    assert.ok(st.freeDiskGb > 0);

    const stopRes = await fetch(`${url}/engine/stop`, { method: "POST", headers: authHeaders });
    assert.equal((await stopRes.json()).engineRunning, false);

    // Without ComfyUI installed locally or reachable at comfyUiUrl, startEngine refuses with 409 engine_not_installed
    const startRes = await fetch(`${url}/engine/start`, { method: "POST", headers: authHeaders });
    assert.equal(startRes.status, 409);
    assert.equal((await startRes.json()).errorCode, "engine_not_installed");

    const capsRes = await fetch(`${url}/capabilities`, { headers: authHeaders });
    const caps = (await capsRes.json()).capabilities;
    assert.ok(caps.some((c) => c.presetId === "z-image-turbo" && c.localReady));
    assert.ok(caps.some((c) => c.presetId === "wan-2.2-t2v" && c.mediaType === "video"));

    const guideRes = await fetch(`${url}/prompt-guide/z-image-turbo`, { headers: authHeaders });
    assert.equal(guideRes.status, 200);
    const guide = await guideRes.json();
    assert.equal(guide.family, "z-image");
    assert.match(guide.text, /Z-Image(?:-Turbo)? Prompting Guide/);

    // Disk LoRA scanner starts empty; upload & create a real .safetensors LoRA
    const initialLoras = (await (await fetch(`${url}/loras`, { headers: authHeaders })).json()).loras;
    assert.equal(initialLoras.length, 0);

    const loraBytes = buildSafetensorsBytes("flux");
    const upLora = await (
      await fetch(`${url}/uploads`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ filename: "flux_rimlight.safetensors", dataBase64: loraBytes.toString("base64") }),
      })
    ).json();
    const addedLoraRes = await fetch(`${url}/loras`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        name: "Flux Rimlight",
        filename: "flux_rimlight.safetensors",
        baseModel: "flux",
        triggerWords: "rimlight",
        uploadHandle: upLora.handle,
      }),
    });
    assert.equal(addedLoraRes.status, 201);
    const { lora } = await addedLoraRes.json();
    assert.equal(lora.onDisk, true);

    const listedLoras = (await (await fetch(`${url}/loras`, { headers: authHeaders })).json()).loras;
    assert.equal(listedLoras.length, 1);
    assert.equal(listedLoras[0].name, "Flux Rimlight");

    const delLoraRes = await fetch(`${url}/loras/${encodeURIComponent(lora.id)}`, {
      method: "DELETE",
      headers: authHeaders,
    });
    assert.equal(delLoraRes.status, 200);
    const afterDel = (await (await fetch(`${url}/loras`, { headers: authHeaders })).json()).loras;
    assert.equal(afterDel.length, 0);
  });

  await t.test("Upload, Image Generation, External API 400 rejection, and Spend Cap 402", async () => {
    const upRes = await fetch(`${url}/uploads`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ filename: "ref.png", dataBase64: SAMPLE_PNG_BASE64 }),
    });
    assert.equal(upRes.status, 201);
    const up = await upRes.json();
    assert.ok(up.handle.endsWith(".png"));

    // External API preset should return 400 unsupported_backend over Control API
    const extRes = await fetch(`${url}/generate`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ presetId: "gpt-image-2", mediaType: "image", prompt: "test" }),
    });
    assert.equal(extRes.status, 400);
    assert.equal((await extRes.json()).errorCode, "unsupported_backend");

    // Local generation
    const genRes = await fetch(`${url}/generate`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        presetId: "z-image-turbo",
        mediaType: "image",
        prompt: "a red fox in the snow",
        options: { aspectRatio: "16:9", steps: 8 },
      }),
    });
    assert.equal(genRes.status, 201);
    const { jobId } = await genRes.json();

    let job;
    for (let i = 0; i < 40; i++) {
      const jr = await (await fetch(`${url}/jobs/${jobId}`, { headers: authHeaders })).json();
      job = jr.job;
      if (job.status === "completed") break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(job.status, "completed");
    assert.ok(fs.existsSync(job.resultPath));
    // Verify valid PNG magic bytes
    const head = fs.readFileSync(job.resultPath).subarray(0, 8);
    assert.deepEqual([...head], [137, 80, 78, 71, 13, 10, 26, 10]);

    // Spend cap enforcement
    const capped = store.createToken({ clientName: "Capped Agent", spendCap: 2 });
    const capRes = await fetch(`${url}/generate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${capped.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        presetId: "z-image-turbo",
        mediaType: "image",
        prompt: "cloud test",
        backend: "cloud",
      }),
    });
    assert.equal(capRes.status, 402);
    assert.equal((await capRes.json()).errorCode, "exceeds_spend_cap");
  });

  let createdCharId;
  await t.test("Character Studio: Create, Scene Image, Enhance, and Animate", async () => {
    const cRes = await fetch(`${url}/characters`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        name: "Kai",
        gender: "man",
        mode: "generate",
        identity: { skinTone: "tan", hairColor: "black", eyeColor: "brown" },
      }),
    });
    assert.equal(cRes.status, 201);
    const { characterId } = await cRes.json();
    createdCharId = characterId;

    let char;
    for (let i = 0; i < 40; i++) {
      const cr = await (await fetch(`${url}/characters/${characterId}`, { headers: authHeaders })).json();
      char = cr.character;
      if (char.base_image_url) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(char.base_image_url);

    const imgRes = await fetch(`${url}/characters/${characterId}/generate-image`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ prompt: "on a rooftop at dusk", aspect: "16:9" }),
    });
    assert.equal(imgRes.status, 201);
    const { jobIds } = await imgRes.json();
    assert.equal(jobIds.length, 1);

    for (let i = 0; i < 40; i++) {
      const jr = await (await fetch(`${url}/jobs/${jobIds[0]}`, { headers: authHeaders })).json();
      if (jr.job.status === "completed") break;
      await new Promise((r) => setTimeout(r, 50));
    }

    const enhRes = await fetch(`${url}/characters/${characterId}/enhance`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ jobId: jobIds[0], scale: 2 }),
    });
    assert.equal(enhRes.status, 201);

    const animRes = await fetch(`${url}/characters/${characterId}/animate`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ frameJobId: jobIds[0], motion: "looking over the city" }),
    });
    assert.equal(animRes.status, 201);
  });

  await t.test("Product & Recipe Composer: Validate, Compose, and Run Multi-Step Pipeline", async () => {
    const up = await (
      await fetch(`${url}/uploads`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ filename: "bottle.png", dataBase64: SAMPLE_PNG_BASE64 }),
      })
    ).json();

    const prodRes = await fetch(`${url}/products`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ name: "Glow Serum", image: up.handle, description: "amber glass bottle" }),
    });
    assert.equal(prodRes.status, 201);
    const { productId } = await prodRes.json();

    const spec = {
      name: "Custom Spin Flow",
      category: "product",
      inputs: [{ key: "product", kind: "subject", required: true }],
      steps: [
        { preset: "krea2-pack:krea2-turbo" },
        { preset: "enhancer-pack:rtx-upscaler" },
      ],
    };

    const val = await (
      await fetch(`${url}/recipes/validate`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ spec }),
      })
    ).json();
    assert.equal(val.validation.valid, true);

    const comp = await (
      await fetch(`${url}/recipes`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ spec }),
      })
    ).json();
    assert.equal(comp.valid, true);

    const runRes = await (
      await fetch(`${url}/recipes/${comp.recipeId}/run`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ inputs: { product: productId }, engine: "local" }),
      })
    ).json();
    assert.ok(runRes.runId);

    let run;
    for (let i = 0; i < 60; i++) {
      const rr = await (await fetch(`${url}/recipe-runs/${runRes.runId}`, { headers: authHeaders })).json();
      run = rr.run;
      if (run.status === "completed") break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(run.status, "completed");
    assert.ok(fs.existsSync(run.resultPath));
  });

  await t.test("Video Studio: Film, Track, Tempo, Atomic Plan, Render, Undo, and Export", async () => {
    const locImg = await (
      await fetch(`${url}/uploads`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ filename: "rooftop.png", dataBase64: SAMPLE_PNG_BASE64 }),
      })
    ).json();
    await fetch(`${url}/locations`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ name: "Rooftop", description: "Neon rooftop", upload: locImg.handle }),
    });

    const film = await (
      await fetch(`${url}/films`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ name: "Neon Rain", aspect: "16:9", quality: "480p", renderOn: "local" }),
      })
    ).json();

    // Silent WAV should return 400 no_pulse from real DSP tempo analyzer
    const silentWav = buildTestWav({ durationSec: 2.0, silent: true });
    const silentUp = await (
      await fetch(`${url}/uploads`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ filename: "silent.wav", dataBase64: silentWav.toString("base64") }),
      })
    ).json();
    await fetch(`${url}/films/${film.id}/tracks`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ upload: silentUp.handle, kind: "music", name: "SilentTrack" }),
    });
    const silentTempoRes = await fetch(`${url}/films/${film.id}/tempo`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ track: "SilentTrack" }),
    });
    assert.equal(silentTempoRes.status, 400);
    assert.equal((await silentTempoRes.json()).errorCode, "no_pulse");

    // Genuine 120 BPM pulse WAV should detect ~120 BPM + first downbeat offset
    const wavBytes = buildTestWav({ bpm: 120, durationSec: 4.0, silent: false });
    const trackUp = await (
      await fetch(`${url}/uploads`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ filename: "neon-rain-vocals.wav", dataBase64: wavBytes.toString("base64") }),
      })
    ).json();

    await fetch(`${url}/films/${film.id}/tracks`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ upload: trackUp.handle, kind: "singing", name: "Vocals" }),
    });

    const tempoRes = await (
      await fetch(`${url}/films/${film.id}/tempo`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ track: "Vocals" }),
      })
    ).json();
    assert.ok(tempoRes.bpm >= 115 && tempoRes.bpm <= 125, `Expected ~120 BPM, got ${tempoRes.bpm}`);
    assert.ok(tempoRes.offset >= 0 && tempoRes.offset <= 0.3);

    // Invalid plan should fail atomically with 400 invalid_plan and details.problems
    const badPlanRes = await fetch(`${url}/films/${film.id}/plan`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        cast: ["NonExistentPerson"],
        clips: [{ bars: 2, shots: [{ prompt: "test", seconds: 999 }] }],
      }),
    });
    assert.equal(badPlanRes.status, 400);
    const badPlan = await badPlanRes.json();
    assert.equal(badPlan.errorCode, "invalid_plan");
    assert.ok(badPlan.details.problems.length >= 2);

    // Valid plan
    const goodPlanRes = await fetch(`${url}/films/${film.id}/plan`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        cast: ["Kai"],
        location: "Rooftop",
        clips: [
          { bars: 1, name: "Intro", shots: [{ prompt: "@Kai looks over city", framing: "wide" }] },
          { bars: 1, name: "Chorus", link: "continue", shots: [{ prompt: "@Kai sings", line: "Neon rain", speaker: "Kai", framing: "close-up" }] },
        ],
      }),
    });
    assert.equal(goodPlanRes.status, 200);
    const goodPlan = await goodPlanRes.json();
    assert.equal(goodPlan.clipsAdded, 2);

    // Export before render -> 409 clips_not_ready
    const earlyExp = await fetch(`${url}/films/${film.id}/export`, { method: "POST", headers: authHeaders, body: "{}" });
    assert.equal(earlyExp.status, 409);
    assert.equal((await earlyExp.json()).errorCode, "clips_not_ready");

    // Render all stale clips
    const rendRes = await fetch(`${url}/films/${film.id}/renders`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ clips: "stale" }),
    });
    assert.equal(rendRes.status, 202);

    let timeline;
    for (let i = 0; i < 80; i++) {
      timeline = await (await fetch(`${url}/films/${film.id}`, { headers: authHeaders })).json();
      if (!timeline.rendersRunning && timeline.clips.every((c) => c.take === "current")) break;
      await new Promise((r) => setTimeout(r, 80));
    }
    assert.equal(timeline.rendersRunning, false);
    assert.ok(timeline.clips.every((c) => c.take === "current"));

    // Export film
    const expRes = await fetch(`${url}/films/${film.id}/export`, { method: "POST", headers: authHeaders, body: "{}" });
    assert.equal(expRes.status, 201);
    const exp = await expRes.json();
    assert.ok(fs.existsSync(exp.path));

    // Undo / Redo test
    const undoRes = await (await fetch(`${url}/films/${film.id}/undo`, { method: "POST", headers: authHeaders, body: "{}" })).json();
    assert.equal(undoRes.timeline.clips.length, 0);
    const redoRes = await (await fetch(`${url}/films/${film.id}/redo`, { method: "POST", headers: authHeaders, body: "{}" })).json();
    assert.equal(redoRes.timeline.clips.length, 2);
  });

  await t.test("MCP Server (@simpletun/mcp): 74 tools registered & live stdio JSON-RPC", async () => {
    const client = new ControlApiClient({ baseUrl: url, token });
    const mcp = createMcpServer(client);

    const listResp = await mcp.handleMessage({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    assert.equal(listResp.result.tools.length, TOOL_NAMES.length);
    assert.equal(TOOL_NAMES.length, 74);

    const callResp = await mcp.handleMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "get_status", arguments: {} },
    });
    const parsedStatus = JSON.parse(callResp.result.content[0].text);
    assert.equal(typeof parsedStatus.engineRunning, "boolean");
    assert.ok(parsedStatus.gpuName);

    // Live stdio subprocess spawn test
    const child = spawn(process.execPath, [
      path.resolve("packages/mcp-server/src/bin.js"),
      "--port",
      String(port),
      "--token",
      token,
    ]);
    const stdoutLines = [];
    let stdoutBuf = "";
    child.stdout.on("data", (chunk) => {
      stdoutBuf += chunk.toString("utf8");
      const parts = stdoutBuf.split(/\r?\n/);
      stdoutBuf = parts.pop() || "";
      for (const line of parts) {
        if (line.trim()) stdoutLines.push(JSON.parse(line));
      }
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 10, method: "initialize", params: {} }) + "\n");
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 11, method: "tools/call", params: { name: "list_capabilities", arguments: {} } }) + "\n");

    for (let i = 0; i < 40; i++) {
      if (stdoutLines.length >= 2) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    child.stdin.end();
    child.kill();
    await new Promise((resolve) => {
      if (child.exitCode !== null || child.killed) setTimeout(resolve, 40);
      child.once("exit", resolve);
    });
    child.stdin.destroy();
    child.stdout.destroy();
    child.stderr.destroy();
    assert.equal(stdoutLines.length, 2);
    assert.equal(stdoutLines[0].result.serverInfo.name, "simpletun");
    const capToolOut = JSON.parse(stdoutLines[1].result.content[0].text);
    assert.ok(Array.isArray(capToolOut.capabilities));
  });

  await t.test("Real Hardware Probing, Safetensors Disk Scanner, and Electron Syntax", async () => {
    const hw = await probeGpuAndSystem();
    assert.ok(typeof hw.gpuName === "string" && hw.gpuName.length > 0);
    assert.ok(hw.totalRamGb > 0);
    assert.ok(hw.freeDiskGb > 0);
    assert.ok(["16+", "12", "8", "4-6", "unsupported"].includes(hw.tier));

    const modelsRoot = store.modelsDir;
    const managedPath = path.join(modelsRoot, "checkpoints", "RealVisXL_V5.0_Lightning_fp16.safetensors");
    const zUnetPath = path.join(modelsRoot, "diffusion_models", "z_image_turbo_int8_convrot.safetensors");
    const zClipPath = path.join(modelsRoot, "text_encoders", "qwen_3_4b_fp8_mixed.safetensors");
    const zVaePath = path.join(modelsRoot, "vae", "ae.safetensors");
    const orphanPath = path.join(modelsRoot, "checkpoints", "extra_orphan.safetensors");
    const rootMisplacedPath = path.join(modelsRoot, "misplaced.safetensors");
    const corruptPath = path.join(modelsRoot, "checkpoints", "truncated_model.safetensors");
    fs.writeFileSync(managedPath, buildSafetensorsBytes("sdxl"));
    fs.writeFileSync(zUnetPath, buildSafetensorsBytes("z-image"));
    fs.writeFileSync(zClipPath, buildSafetensorsBytes("qwen"));
    fs.writeFileSync(zVaePath, buildSafetensorsBytes("vae"));
    fs.writeFileSync(orphanPath, buildSafetensorsBytes("flux"));
    fs.writeFileSync(rootMisplacedPath, buildSafetensorsBytes("sdxl"));
    // Write a truncated safetensors file missing its final 4 payload bytes
    const fullBytes = buildSafetensorsBytes("sdxl");
    fs.writeFileSync(corruptPath, fullBytes.subarray(0, fullBytes.length - 4));

    const header = parseSafetensorsHeader(orphanPath);
    assert.equal(header.tensorCount, 1);
    assert.equal(header.baseModel, "flux");
    assert.equal(verifySafetensorsComplete(managedPath).complete, true);
    assert.equal(verifySafetensorsComplete(corruptPath).complete, false);

    const scanned = scanModelsDirectory(modelsRoot, store.listPacks(), store.getCapabilities());
    const managed = scanned.files.find((f) => f.filename === "RealVisXL_V5.0_Lightning_fp16.safetensors");
    const zManaged = scanned.files.find((f) => f.filename === "z_image_turbo_int8_convrot.safetensors");
    const orphan = scanned.files.find((f) => f.filename === "extra_orphan.safetensors");
    const misplaced = scanned.files.find((f) => f.filename === "misplaced.safetensors");
    const corrupt = scanned.files.find((f) => f.filename === "truncated_model.safetensors");
    assert.equal(managed.status, "Managed");
    assert.ok(managed.usedByPresets.includes("realvis-xl-lightning"));
    assert.equal(zManaged.status, "Managed");
    assert.ok(zManaged.usedByPresets.includes("z-image-turbo"));
    assert.equal(orphan.status, "External");
    assert.equal(orphan.safetensors.tensorCount, 1);
    assert.equal(misplaced.status, "Not in a model folder");
    assert.equal(corrupt.status, "Corrupt / Incomplete");
    assert.equal(corrupt.safetensors.complete, false);

    const del = deletePhysicalModelFile(modelsRoot, "checkpoints/extra_orphan.safetensors");
    assert.ok(del.deleted.includes("extra_orphan.safetensors"));
    assert.equal(fs.existsSync(orphanPath), false);
    deletePhysicalModelFile(modelsRoot, "checkpoints/truncated_model.safetensors");

    // Electron entrypoint & Node preflight script verification
    execFileSync(process.execPath, ["--check", path.resolve("electron/main.js")]);
    execFileSync(process.execPath, ["--check", path.resolve("electron/preload.js")]);
    execFileSync(process.execPath, [path.resolve("scripts/check-node.cjs")]);
  });

  await t.test("Real ComfyUI HTTP/WebSocket Execution, PNG tEXt Metadata, and Strict Mode", async () => {
    const mockComfy = await startMockComfyServer();
    try {
      await fetch(`${url}/api/ui/settings`, {
        method: "POST",
        headers: { ...authHeaders, "X-SimpleTun-UI": "1" },
        body: JSON.stringify({ comfyUiUrl: mockComfy.url, settings: { strictRealEngine: false } }),
      });

      const engStart = await (await fetch(`${url}/engine/start`, { method: "POST", headers: authHeaders })).json();
      assert.equal(engStart.engineRunning, true);

      const upRef = await (
        await fetch(`${url}/uploads`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ filename: "subject_ref.png", dataBase64: SAMPLE_PNG_BASE64 }),
        })
      ).json();

      // Compile workflow & dispatch image generation through ComfyUI HTTP/WS pipeline
      const wf = compileComfyWorkflow({
        preset: { workflowArch: "checkpoint-t2i", requiredModels: [{ filename: "z_image_turbo_bf16.safetensors" }] },
        prompt: "studio portrait",
        seed: 777,
        steps: 8,
        cfg: 2.0,
      });
      assert.equal(wf["6"].class_type, "KSampler");
      assert.equal(wf["6"].inputs.seed, 777);

      const genRes = await fetch(`${url}/generate`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          presetId: "qwen-image-21-edit",
          mediaType: "image",
          prompt: "Place person in snowy mountains",
          image: upRef.handle,
          options: { steps: 10, seed: 4242 },
        }),
      });
      assert.equal(genRes.status, 201);
      const { jobId } = await genRes.json();

      let job;
      for (let i = 0; i < 60; i++) {
        job = (await (await fetch(`${url}/jobs/${jobId}`, { headers: authHeaders })).json()).job;
        if (job.status === "completed" || job.status === "failed") break;
        await new Promise((r) => setTimeout(r, 40));
      }
      assert.equal(job.status, "completed");
      assert.equal(job.engineUsed, "comfyui");
      assert.ok(mockComfy.seenUploads.length >= 1, "Expected /upload/image to be called on ComfyUI");
      assert.ok(mockComfy.seenPrompts.size >= 1, "Expected /prompt to be dispatched to ComfyUI");

      // Verify PNG tEXt metadata chunks embedded cleanly
      const pngBytes = fs.readFileSync(job.resultPath);
      assert.ok(pngBytes.includes(Buffer.from("tEXtprompt\0")), "Expected embedded PNG tEXt prompt chunk");
      assert.ok(pngBytes.includes(Buffer.from("SimpleTun Open Engine")), "Expected SimpleTun Software PNG chunk");

      // Verify embedPngWorkflowMetadata standalone idempotency
      const samplePngPath = path.join(tempRoot, "standalone_meta.png");
      fs.writeFileSync(samplePngPath, Buffer.from(SAMPLE_PNG_BASE64, "base64"));
      embedPngWorkflowMetadata(samplePngPath, { testNode: 123 });
      assert.ok(fs.readFileSync(samplePngPath).includes(Buffer.from('"testNode":123')));

      // Verify Node 20 HTTP polling fallback in executeComfyWorkflow when global WebSocket is unavailable
      const savedWs = globalThis.WebSocket;
      try {
        globalThis.WebSocket = undefined;
        const pollOut = path.join(tempRoot, "comfy_poll_fallback.png");
        const pollRes = await executeComfyWorkflow({ comfyUrl: mockComfy.url, workflow: wf, outPath: pollOut });
        assert.ok(fs.existsSync(pollRes.outPath));
        assert.ok(fs.readFileSync(pollRes.outPath).includes(Buffer.from("tEXtprompt\0")));
      } finally {
        globalThis.WebSocket = savedWs;
      }

      // Verify strictRealEngine enforces missing weights (400) AND missing ComfyUI server (failed job)
      await fetch(`${url}/api/ui/settings`, {
        method: "POST",
        headers: { ...authHeaders, "X-SimpleTun-UI": "1" },
        body: JSON.stringify({
          comfyUiUrl: "http://127.0.0.1:59992",
          settings: { strictRealEngine: true },
        }),
      });

      // z-image-turbo weights (z_image_turbo_int8_convrot + qwen_3_4b_fp8_mixed + ae) & realvis-xl-lightning already created above -> passes preflight and fails at offline ComfyUI (no silent fallback)
      const strictGen = await fetch(`${url}/generate`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ presetId: "z-image-turbo", mediaType: "image", prompt: "strict check" }),
      });
      assert.equal(strictGen.status, 201);
      const { jobId: strictJobId } = await strictGen.json();

      let sJob;
      for (let i = 0; i < 40; i++) {
        sJob = (await (await fetch(`${url}/jobs/${strictJobId}`, { headers: authHeaders })).json()).job;
        if (sJob.status === "completed" || sJob.status === "failed") break;
        await new Promise((r) => setTimeout(r, 40));
      }
      assert.equal(sJob.status, "failed");
      assert.match(sJob.errorMessage, /Strict Real Engine is enabled/);

      // Restore default non-strict setting
      await fetch(`${url}/api/ui/settings`, {
        method: "POST",
        headers: { ...authHeaders, "X-SimpleTun-UI": "1" },
        body: JSON.stringify({ settings: { strictRealEngine: false } }),
      });
    } finally {
      mockComfy.close();
    }
  });

  await t.test("Multi-GPU Hardware Parsing & Distributed 2-GPU ComfyUI Job Scheduling", async () => {
    const csvWithCap = parseNvidiaSmiCsv(
      "0, NVIDIA GeForce RTX 3090, 24576, 24000, 550.54, 8.6\n1, NVIDIA GeForce RTX 3090, 24576, 23900, 550.54, 8.6\n",
      true
    );
    assert.equal(csvWithCap.length, 2);
    assert.equal(csvWithCap[0].cudaSupported, true);
    assert.equal(csvWithCap[1].index, 1);
    assert.equal(csvWithCap[1].vramGb, 24);

    // Driver/container fallback when compute_cap is not queryable
    const csvNoCap = parseNvidiaSmiCsv(
      "0, NVIDIA A100-SXM4-40GB, 40960, 40000, 535.10\n1, NVIDIA A100-SXM4-40GB, 40960, 40000, 535.10\n",
      false
    );
    assert.equal(csvNoCap.length, 2);
    assert.equal(csvNoCap[0].cudaSupported, true);
    assert.equal(csvNoCap[1].cudaSupported, true);

    const smiList = parseNvidiaSmiList(
      "GPU 0: NVIDIA RTX A6000 (UUID: GPU-aaa)\nGPU 1: NVIDIA RTX A6000 (UUID: GPU-bbb)\n"
    );
    assert.equal(smiList.length, 2);
    assert.equal(smiList[1].cudaSupported, true);
    assert.equal(inferCudaFromGpuName("NVIDIA GeForce GTX 1080 Ti").cudaSupported, false);

    // Distributed 2-GPU ComfyUI execution test
    const gpu0 = await startMockComfyServer();
    const gpu1 = await startMockComfyServer();
    try {
      await fetch(`${url}/api/ui/settings`, {
        method: "POST",
        headers: { ...authHeaders, "X-SimpleTun-UI": "1" },
        body: JSON.stringify({ comfyUiUrl: `${gpu0.url},${gpu1.url}`, settings: { strictRealEngine: false } }),
      });

      const eng = await (await fetch(`${url}/engine/start`, { method: "POST", headers: authHeaders })).json();
      assert.equal(eng.engineRunning, true);
      assert.equal(eng.workerCount, 2);

      const st = await (await fetch(`${url}/status`, { headers: authHeaders })).json();
      assert.equal(st.workerCount, 2);

      // Dispatch 2 concurrent jobs and confirm least-busy / round-robin worker pool splits across GPU 0 and GPU 1
      const [g1, g2] = await Promise.all([
        fetch(`${url}/generate`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ presetId: "z-image-turbo", mediaType: "image", prompt: "gpu worker A" }),
        }).then((r) => r.json()),
        fetch(`${url}/generate`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ presetId: "z-image-turbo", mediaType: "image", prompt: "gpu worker B" }),
        }).then((r) => r.json()),
      ]);

      let job1, job2;
      for (let i = 0; i < 60; i++) {
        job1 = (await (await fetch(`${url}/jobs/${g1.jobId}`, { headers: authHeaders })).json()).job;
        job2 = (await (await fetch(`${url}/jobs/${g2.jobId}`, { headers: authHeaders })).json()).job;
        if (job1.status === "completed" && job2.status === "completed") break;
        await new Promise((r) => setTimeout(r, 40));
      }
      assert.equal(job1.status, "completed");
      assert.equal(job2.status, "completed");
      assert.equal(job1.engineUsed, "comfyui");
      assert.equal(job2.engineUsed, "comfyui");
      assert.notEqual(job1.comfyPort, job2.comfyPort, "Expected concurrent jobs to distribute across both ComfyUI GPU workers");
      assert.equal(gpu0.seenPrompts.size, 1);
      assert.equal(gpu1.seenPrompts.size, 1);
    } finally {
      gpu0.close();
      gpu1.close();
    }
  });

  await t.test("2026 ComfyUI v0.45 Graph Compilers (Z-Image-Turbo, FLUX.2 Klein, Krea-2, Qwen 2.1) & 2-Pass Hires Fix", async () => {
    const caps = (await (await fetch(`${url}/capabilities`, { headers: authHeaders })).json()).capabilities;
    const zPreset = caps.find((c) => c.presetId === "z-image-turbo");
    const kleinPreset = caps.find((c) => c.presetId === "flux-klein");
    const kreaPreset = caps.find((c) => c.presetId === "krea2-turbo");
    const qwenPreset = caps.find((c) => c.presetId === "qwen-image-21");
    const realvisPreset = caps.find((c) => c.presetId === "realvis-xl-lightning");
    assert.ok(zPreset && kleinPreset && kreaPreset && qwenPreset && realvisPreset);

    // 1. Z-Image-Turbo with 2-pass Hires Fix
    const zHires = compileComfyWorkflow({
      preset: zPreset,
      prompt: "editorial portrait of a red fox in fresh alpine snow",
      seed: 101,
      aspectRatio: "16:9",
      resolution: "720p",
      qualityMode: "hires",
    });
    assert.equal(zHires["2"].class_type, "CLIPLoader");
    assert.equal(zHires["2"].inputs.type, "lumina2");
    assert.equal(zHires["15"].class_type, "ModelSamplingAuraFlow");
    assert.equal(zHires["20"].class_type, "LatentUpscale");
    assert.equal(zHires["20"].inputs.width % 64, 0);
    assert.equal(zHires["20"].inputs.height % 64, 0);
    assert.equal(zHires["21"].class_type, "KSampler");
    assert.ok(zHires["21"].inputs.denoise > 0 && zHires["21"].inputs.denoise < 0.6);

    // 2. FLUX.2 Klein 4B with Flux2Scheduler + SamplerCustomAdvanced + Hires Fix
    const fHires = compileComfyWorkflow({
      preset: kleinPreset,
      prompt: "product photo",
      seed: 202,
      qualityMode: "ultra",
    });
    assert.equal(fHires["2"].inputs.type, "flux2");
    assert.equal(fHires["7"].class_type, "EmptyFlux2LatentImage");
    assert.equal(fHires["9"].class_type, "Flux2Scheduler");
    assert.equal(fHires["16"].class_type, "SamplerCustomAdvanced");
    assert.equal(fHires["20"].class_type, "LatentUpscale");
    assert.equal(fHires["22"].class_type, "SplitSigmasDenoise");
    assert.equal(fHires["24"].class_type, "SamplerCustomAdvanced");

    // 3. Krea 2 Turbo & Qwen Image 2.1
    const kWf = compileComfyWorkflow({ preset: kreaPreset, prompt: "studio watch" });
    assert.equal(kWf["2"].inputs.type, "krea2");
    const qWf = compileComfyWorkflow({ preset: qwenPreset, prompt: "bookshop storefront" });
    assert.equal(qWf["2"].inputs.type, "qwen_image");

    // 4. UI Bootstrap reports ComfyUI v0.45.0 target
    const boot = await (await fetch(`${url}/api/ui/bootstrap`, { headers: { ...authHeaders, "X-SimpleTun-UI": "1" } })).json();
    assert.equal(boot.engine.targetVersion, "v0.45.0");

    // 5. Raw unfiltered prompt pass-through (zero hidden negative injection)
    const rawGen = await (
      await fetch(`${url}/generate`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ presetId: "realvis-xl-lightning", mediaType: "image", prompt: "uncensored raw artistic portrait" }),
      })
    ).json();
    let rawJob;
    for (let i = 0; i < 40; i++) {
      rawJob = (await (await fetch(`${url}/jobs/${rawGen.jobId}`, { headers: authHeaders })).json()).job;
      if (rawJob.status === "completed" || rawJob.status === "failed") break;
      await new Promise((r) => setTimeout(r, 40));
    }
    assert.equal(rawJob.negativePrompt, "");
    assert.equal(rawJob.status, "completed");
    assert.ok(rawJob.resultUrl);

    // 6. Delayed ComfyUI /history flush + stale WS executing:null before promptId regression test
    const raceWsClients = new Set();
    let activePid = null;
    let historyReadyAt = 0;
    const raceServer = http.createServer((req, res) => {
      const u = new URL(req.url, "http://127.0.0.1");
      if (req.method === "POST" && u.pathname === "/prompt") {
        activePid = "pid_delayed_1";
        historyReadyAt = Date.now() + 260;
        for (const s of raceWsClients) {
          sendWsTextFrame(s, { type: "executing", data: { node: null } }); // stale idle event before prompt_id returns!
        }
        setTimeout(() => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ prompt_id: activePid }));
          setTimeout(() => {
            for (const s of raceWsClients) {
              sendWsTextFrame(s, { type: "executed", data: { node: "30", prompt_id: activePid } });
              sendWsTextFrame(s, { type: "executing", data: { node: null, prompt_id: activePid } });
            }
          }, 25);
        }, 40);
        return;
      }
      if (req.method === "GET" && u.pathname.startsWith("/history/")) {
        const pid = u.pathname.slice("/history/".length);
        res.writeHead(200, { "Content-Type": "application/json" });
        if (Date.now() < historyReadyAt) return res.end(JSON.stringify({}));
        return res.end(JSON.stringify({ [pid]: { outputs: { "30": { images: [{ filename: "delayed.png", subfolder: "", type: "output" }] } } } }));
      }
      if (req.method === "GET" && u.pathname === "/queue") {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ queue_running: Date.now() < historyReadyAt ? [[0, activePid]] : [], queue_pending: [] }));
      }
      if (req.method === "GET" && u.pathname === "/view") {
        res.writeHead(200, { "Content-Type": "image/png" });
        return res.end(Buffer.from(SAMPLE_PNG_BASE64, "base64"));
      }
      res.writeHead(404);
      res.end();
    });
    raceServer.on("upgrade", (req, socket) => {
      const accept = crypto.createHash("sha1").update(`${req.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
      socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
      raceWsClients.add(socket);
      sendWsTextFrame(socket, { type: "executing", data: { node: null } }); // initial connect idle frame
      socket.on("close", () => raceWsClients.delete(socket));
      socket.on("error", () => raceWsClients.delete(socket));
    });
    await new Promise((r) => raceServer.listen(0, "127.0.0.1", r));
    try {
      const racePort = raceServer.address().port;
      const raceOut = path.join(tempRoot, "delayed_history.png");
      const raceRes = await executeComfyWorkflow({ comfyUrl: `http://127.0.0.1:${racePort}`, workflow: zHires, outPath: raceOut });
      assert.ok(fs.existsSync(raceRes.outPath));
    } finally {
      for (const s of raceWsClients) s.destroy();
      raceServer.closeAllConnections?.();
      raceServer.close();
    }

    // 7. Browser media preview helper chooses <img> for .webp animations and <video> for .mp4, plus HTTP Range 206 + clear-failed
    const { renderMediaPreview } = await import("../public/api.js");
    const webpHtml = renderMediaPreview("/media/outputs/job_123.webp", { alt: "anim" });
    const mp4Html = renderMediaPreview("/media/outputs/job_123.mp4", { poster: "/media/outputs/job_123.poster.png" });
    assert.ok(webpHtml.startsWith("<img "), "Expected animated .webp to render via <img>");
    assert.ok(mp4Html.startsWith("<video "), "Expected .mp4 to render via <video>");

    const rangeRes = await fetch(`${url}${rawJob.resultUrl}`, { headers: { Range: "bytes=0-15" } });
    assert.equal(rangeRes.status, 206);
    assert.equal(rangeRes.headers.get("accept-ranges"), "bytes");
    assert.equal((await rangeRes.arrayBuffer()).byteLength, 16);

    const clearRes = await fetch(`${url}/api/ui/jobs/clear-failed`, {
      method: "POST",
      headers: { ...authHeaders, "X-SimpleTun-UI": "1" },
    });
    assert.equal(clearRes.status, 200);
  });
});
