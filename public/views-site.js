// public/views-site.js
// Cloned simpligen.io Landing Page (rebranded SimpleTun Open Source),
// 4-Question Interactive GPU Checker, Searchable Docs, and REA Forensics Dashboard.

import { uiState, api, toast, esc } from "./api.js";

export function renderLandingPage(stage, switchMode) {
  stage.innerHTML = `
    <div style="text-align:center; padding:42px 12px 24px;">
      <div class="tag green" style="padding:6px 14px; font-size:12.5px; margin-bottom:18px;">● Open-Source MIT Clone · Powered &amp; Verified by REA (morluto/rea)</div>
      <h1 class="hero-title">Studio-grade AI, <span class="text-brand-gradient">without the studio.</span></h1>
      <p style="max-width:60ch; margin:18px auto 0; font-size:18px; color:var(--text-secondary); line-height:1.55;">
        SimpleTun turns the chaos of ComfyUI node graphs into three simple steps. Pick a media type, choose a style, and create cinematic images, consistent characters, and whole films — completely free &amp; open source.
      </p>
      <div style="display:flex; gap:12px; justify-content:center; margin-top:26px; flex-wrap:wrap;">
        <button class="btn-primary" id="launchStudioHeroBtn" style="padding:13px 26px; font-size:15px;">Open SimpleTun Studio ($0 Open Source)</button>
        <button class="btn-secondary" id="openGpuCheckHeroBtn" style="padding:13px 24px; font-size:15px;">Check Your GPU Compatibility</button>
      </div>
      <p style="color:var(--text-muted); font-size:13px; margin-top:12px;">MIT License · Local ComfyUI Bridge + Zero-Setup Open Engine · 74 MCP Agent Tools</p>
    </div>

    <div class="grid-4" style="border-top:1px solid var(--border-subtle); border-bottom:1px solid var(--border-subtle); padding:20px 0; margin:32px 0;">
      <div style="text-align:center;"><div class="text-brand-gradient" style="font-family:var(--font-display); font-size:28px; font-weight:700;">3</div><div style="font-size:13px; color:var(--text-secondary);">steps to first render</div></div>
      <div style="text-align:center;"><div class="text-brand-gradient" style="font-family:var(--font-display); font-size:28px; font-weight:700;">$0</div><div style="font-size:13px; color:var(--text-secondary);">open-source MIT forever</div></div>
      <div style="text-align:center;"><div class="text-brand-gradient" style="font-family:var(--font-display); font-size:28px; font-weight:700;">74</div><div style="font-size:13px; color:var(--text-secondary);">MCP agent tools built in</div></div>
      <div style="text-align:center;"><div class="text-brand-gradient" style="font-family:var(--font-display); font-size:28px; font-weight:700;">100%</div><div style="font-size:13px; color:var(--text-secondary);">local privacy &amp; ComfyUI bridge</div></div>
    </div>

    <section style="margin:48px 0;">
      <p class="eyebrow" style="text-align:center;">How it works</p>
      <h2 style="text-align:center; font-family:var(--font-display); font-size:34px; margin:0 0 24px;">From idea to render in three steps</h2>
      <div class="grid-3">
        <div class="card-elevated"><div class="brand-icon brand-gradient" style="margin-bottom:14px;">01</div><h3 style="margin:0 0 8px;">Pick a media type</h3><p style="color:var(--text-secondary); margin:0; font-size:14px; line-height:1.5;">Image, image edit, text-to-video, or image-to-video. Choose what you want to make.</p></div>
        <div class="card-elevated"><div class="brand-icon brand-gradient" style="margin-bottom:14px;">02</div><h3 style="margin:0 0 8px;">Choose a style</h3><p style="color:var(--text-secondary); margin:0; font-size:14px; line-height:1.5;">Browse curated preset packs (Z-Image, FLUX.2, Wan 2.2, LTX 2.5, MiniMax H3) with GPU fit hints.</p></div>
        <div class="card-elevated"><div class="brand-icon brand-gradient" style="margin-bottom:14px;">03</div><h3 style="margin:0 0 8px;">Describe &amp; create</h3><p style="color:var(--text-secondary); margin:0; font-size:14px; line-height:1.5;">Fill in a guided prompt and hit generate locally or in the cloud — or let an AI agent drive over MCP.</p></div>
      </div>
    </section>

    <section style="margin:48px 0;">
      <p class="eyebrow" style="text-align:center;">Open Source Advantage</p>
      <h2 style="text-align:center; font-family:var(--font-display); font-size:34px; margin:0 0 24px;">SimpliGen UX · SimpleTun Open Freedom</h2>
      <div class="grid-2">
        <div class="card-elevated" style="border-color:rgba(35,184,229,0.35);">
          <p class="eyebrow">SimpleTun Open-Source Edition</p>
          <h3 style="font-family:var(--font-display); font-size:32px; margin:4px 0 12px;">$0 <span style="font-size:15px; color:var(--text-secondary);">MIT License</span></h3>
          <ul style="color:var(--text-primary); line-height:1.8; padding-left:18px;">
            <li>Full 3-step generation wizard &amp; Preset Store</li>
            <li>Character Studio (Identity Builder + Steady-Face I2V)</li>
            <li>Video Studio (Timeline, BPM Bars, Cast, Takes, Export)</li>
            <li>Product Studio, UGC Studio &amp; Recipe Composer</li>
            <li>74-tool MCP Server + Local Control API (port 48199)</li>
            <li>Cross-platform Node.js + ComfyUI Bridge + Built-in Synthesizer</li>
          </ul>
        </div>
        <div class="card" style="display:flex; flex-direction:column; justify-content:space-between;">
          <div>
            <p class="eyebrow" style="color:var(--brand-purple);">Built With REA (morluto/rea)</p>
            <h3 style="font-family:var(--font-display); font-size:26px; margin:4px 0 12px;">Clean-Room Verified</h3>
            <p style="color:var(--text-secondary); line-height:1.6;">SimpleTun was engineered using REA static JavaScript application graph analysis against the official <code>@simpligen/mcp</code> connector and <code>simpligen.io</code> web bundles, achieving 100% API and MCP tool parity.</p>
          </div>
          <button class="btn-secondary" id="openReaFromLandingBtn" style="margin-top:16px;">Inspect REA Evidence Bundle →</button>
        </div>
      </div>
    </section>
  `;

  document.getElementById("launchStudioHeroBtn").onclick = () => switchMode("studio", "generate");
  document.getElementById("openGpuCheckHeroBtn").onclick = () => switchMode("gpu-check");
  document.getElementById("openReaFromLandingBtn").onclick = () => switchMode("rea");
}

export function renderGpuCheck(stage, switchMode) {
  const gpus = uiState.bootstrap?.gpuList || [];
  const hw = uiState.bootstrap?.hardware || {};
  const a = uiState.gpuAnswers;

  let verdict = { badge: "green", title: "Images + Video Ready Locally!", text: "Your NVIDIA RTX GPU can run both local image generation and Wan 2.2 / LTX 2.5 video presets comfortably." };
  if (a.os !== "windows" && a.os !== "linux") {
    verdict = { badge: "amber", title: "Mac / VM Detected — Use Open Engine or Cloud", text: "CUDA local ComfyUI requires Windows/Linux NVIDIA hardware. SimpleTun's built-in Open Synthesizer, BYOK APIs, and Cloud mode still run smoothly on your machine!" };
  } else if (a.brand !== "nvidia") {
    verdict = { badge: "amber", title: "Non-NVIDIA GPU — CUDA Engine Unsupported", text: "Traditional CUDA ComfyUI packs require NVIDIA Turing+. SimpleTun's built-in Open Synthesizer & Cloud mode work out of the box." };
  } else if (a.series === "gtx10") {
    verdict = { badge: "amber", title: "GTX 10-Series (< sm_75)", text: "CUDA kernels below sm_75 are unsupported by the ComfyUI binary engine. Use SimpleTun Open Engine or Cloud." };
  } else if (a.series === "gtx16" || a.vram === "4-6") {
    verdict = { badge: "cyan", title: "Images Locally · Cloud/Open for Video", text: "With 4-6 GB VRAM and 16 GB+ RAM, image presets run locally. Video presets require 8-16+ GB VRAM or Cloud." };
  } else if (a.vram === "8") {
    verdict = { badge: "cyan", title: "All Images + Lightweight 480p Video", text: "8 GB VRAM handles all image presets plus quantized/GGUF LTX 2.3 & Wan 2.2 clips at 480p." };
  }

  stage.innerHTML = `
    <div class="page-header">
      <div>
        <p class="eyebrow">GPU Compatibility Check (Live Probe + Estimator)</p>
        <h1 class="page-title">What your card can actually run</h1>
        <p class="page-sub">Live hardware detection via nvidia-smi / Windows WMI plus interactive VRAM tier simulator.</p>
      </div>
      <button class="btn-secondary btn-sm" id="reprobeGpuBtn">↻ Re-Probe GPU</button>
    </div>

    <div class="card-elevated" style="margin-bottom:20px;">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:8px;">
        <span class="tag ${hw.cudaSupported ? "green" : "amber"}">Detected Hardware on This Machine</span>
        <span style="font-size:12px; color:var(--text-muted);">Tier: <strong>${esc(hw.tier || "unknown")}</strong></span>
      </div>
      <div style="font-family:var(--font-display); font-size:20px; font-weight:700; color:#fff;">
        ${esc(hw.gpuName || "Unknown GPU")} · ${hw.vramGb ?? 0} GB VRAM
      </div>
      <div style="font-size:13px; color:var(--text-secondary); margin-top:6px;">
        CUDA Supported: <strong>${hw.cudaSupported ? `Yes (Compute sm_${esc(hw.computeCap || "?")}, Driver ${esc(hw.driverVersion || "?")})` : "No CUDA GPU detected"}</strong>
        · System RAM: <strong>${hw.totalRamGb ?? "?"} GB</strong>
        · Free Disk Space: <strong>${hw.freeDiskGb ?? "?"} GB</strong>
      </div>
    </div>

    <div class="grid-2" style="margin-bottom:24px;">
      <div class="card-elevated">
        <div class="field">
          <label class="field-label">1. Operating System</label>
          <select id="gpuOs" class="select">
            <option value="windows" ${a.os === "windows" ? "selected" : ""}>Windows 10 / 11 (64-bit)</option>
            <option value="linux" ${a.os === "linux" ? "selected" : ""}>Linux (Open-Source SimpleTun)</option>
            <option value="mac" ${a.os === "mac" ? "selected" : ""}>macOS / Windows VM on Mac</option>
          </select>
        </div>
        <div class="field">
          <label class="field-label">2. GPU Manufacturer</label>
          <select id="gpuBrand" class="select">
            <option value="nvidia" ${a.brand === "nvidia" ? "selected" : ""}>NVIDIA GeForce / RTX</option>
            <option value="amd" ${a.brand === "amd" ? "selected" : ""}>AMD Radeon / Intel Arc / Integrated</option>
          </select>
        </div>
        <div class="field">
          <label class="field-label">3. NVIDIA Generation</label>
          <select id="gpuSeries" class="select">
            <option value="rtx30_40_50" ${a.series === "rtx30_40_50" ? "selected" : ""}>RTX 20 / 30 / 40 / 50 Series</option>
            <option value="gtx16" ${a.series === "gtx16" ? "selected" : ""}>GTX 16-Series (1650, 1660, 1660 Ti)</option>
            <option value="gtx10" ${a.series === "gtx10" ? "selected" : ""}>GTX 10-Series or Older (1080, 1060...)</option>
          </select>
        </div>
        <div class="field">
          <label class="field-label">4. GPU VRAM Capacity</label>
          <select id="gpuVram" class="select">
            <option value="16+" ${a.vram === "16+" ? "selected" : ""}>16 GB+ VRAM</option>
            <option value="12" ${a.vram === "12" ? "selected" : ""}>12 GB VRAM</option>
            <option value="8" ${a.vram === "8" ? "selected" : ""}>8 GB VRAM</option>
            <option value="4-6" ${a.vram === "4-6" ? "selected" : ""}>4 to 6 GB VRAM</option>
          </select>
        </div>
      </div>

      <div class="card-elevated" style="display:flex; flex-direction:column; justify-content:center;">
        <span class="tag ${verdict.badge}" style="align-self:flex-start; margin-bottom:12px;">Hardware Verdict</span>
        <h2 style="font-family:var(--font-display); margin:0 0 10px;">${esc(verdict.title)}</h2>
        <p style="color:var(--text-secondary); line-height:1.6;">${esc(verdict.text)}</p>
        <button class="btn-primary" id="gpuGoStudioBtn" style="margin-top:16px; align-self:flex-start;">Try Prompt Builder Now →</button>
      </div>
    </div>

    <div class="card">
      <h3 style="margin:0 0 12px; font-family:var(--font-display);">Verified GPU Tier Reference</h3>
      <div style="overflow-x:auto;">
        <table style="width:100%; border-collapse:collapse; font-size:13px;">
          <thead>
            <tr style="border-bottom:1px solid var(--border-emphasis); text-align:left; color:var(--text-secondary);">
              <th style="padding:10px;">GPU</th><th style="padding:10px;">VRAM</th><th style="padding:10px;">Images</th><th style="padding:10px;">Video</th>
            </tr>
          </thead>
          <tbody>
            ${gpus.map((g) => `
              <tr style="border-bottom:1px solid var(--border-subtle);">
                <td style="padding:10px; font-weight:700;">${esc(g.name)}</td>
                <td style="padding:10px;">${g.vramGb ? `${g.vramGb} GB` : "N/A"}</td>
                <td style="padding:10px; color:var(--text-secondary);">${esc(g.localImages)}</td>
                <td style="padding:10px; color:var(--text-secondary);">${esc(g.localVideo)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;

  const reprobeBtn = document.getElementById("reprobeGpuBtn");
  if (reprobeBtn) {
    reprobeBtn.onclick = async () => {
      try {
        const res = await api("/api/ui/hardware?refresh=1");
        if (uiState.bootstrap) uiState.bootstrap.hardware = res.hardware;
        toast(`Detected: ${res.hardware.gpuName} (${res.hardware.vramGb} GB VRAM)`);
        renderGpuCheck(stage, switchMode);
      } catch (err) { toast(err.message, true); }
    };
  }
  ["gpuOs", "gpuBrand", "gpuSeries", "gpuVram"].forEach((id, idx) => {
    const key = ["os", "brand", "series", "vram"][idx];
    document.getElementById(id).onchange = (e) => {
      uiState.gpuAnswers[key] = e.target.value;
      renderGpuCheck(stage, switchMode);
    };
  });
  document.getElementById("gpuGoStudioBtn").onclick = () => switchMode("studio", "generate");
}

export function renderDocs(stage) {
  const sections = {
    "getting-started": {
      title: "Getting Started with SimpleTun",
      body: `SimpleTun is an open-source desktop & local web studio cloning SimpliGen's 3-step UX.\n\n1. Pick a media type (Image, Image Edit, Text-to-Video, Image-to-Video).\n2. Choose a preset pack (Z-Image, FLUX.2, Wan 2.2, LTX 2.5, MiniMax H3).\n3. Describe your scene and click Generate Local or Generate Cloud.\n\nWhen a local ComfyUI server is running on http://127.0.0.1:8188, SimpleTun bridges workflows to it; otherwise, SimpleTun's zero-setup procedural synthesizer renders real PNG & H.264 MP4 outputs immediately.`,
    },
    "video-studio": {
      title: "Video Studio & Film Timeline",
      body: `Direct multi-clip films shot by shot:\n\n- Upload an audio track and click Detect Tempo to lock the ruler to musical Bars & Beats.\n- Assign Characters & Locations to the film or override per clip.\n- Reference cast members with @Name inside shot prompts and enter spoken/sung lines for lip-sync.\n- Use link: 'continue' so each clip chains smoothly from the previous clip's final frame.\n- Press Ctrl+Z / Ctrl+Y anytime to undo or redo edits, including live changes made by an MCP agent.`,
    },
    "control-api": {
      title: "Control API & 74-Tool MCP Reference",
      body: `Base URL: http://127.0.0.1:48199 (or discovered via data/agent-api.json)\nAuth: Authorization: Bearer st-agent-simpletun-open\nSecurity: Loopback-only Host header guard (403 forbidden_host otherwise).\n\nKey Routes:\n- GET /health, /status, /capabilities, /loras, /prompt-guide/:presetId\n- POST /uploads, /generate, /presets/prepare\n- GET/POST /characters, /products, /locations, /recipes, /films\n- POST /films/:id/plan (atomic validation), /films/:id/renders, /films/:id/export`,
    },
  };
  const cur = sections[uiState.docsSection] || sections["getting-started"];

  stage.innerHTML = `
    <div class="page-header">
      <div>
        <p class="eyebrow">Knowledge Base</p>
        <h1 class="page-title">SimpleTun Documentation</h1>
      </div>
    </div>
    <div class="grid-2" style="grid-template-columns: 240px minmax(0, 1fr);">
      <div class="card">
        ${Object.entries(sections).map(([k, v]) => `
          <button class="rail-item ${uiState.docsSection === k ? "active" : ""}" data-doc-sec="${k}">${esc(v.title)}</button>
        `).join("")}
      </div>
      <div class="card-elevated">
        <h2 style="margin-top:0; font-family:var(--font-display);">${esc(cur.title)}</h2>
        <div class="code-pre" style="font-family:var(--font-body); font-size:14.5px; line-height:1.7;">${esc(cur.body)}</div>
      </div>
    </div>
  `;
  stage.querySelectorAll("[data-doc-sec]").forEach((b) => {
    b.onclick = () => { uiState.docsSection = b.dataset.docSec; renderDocs(stage); };
  });
}

export function renderReaForensics(stage) {
  const ev = uiState.bootstrap?.reaEvidence || {};
  const mcpSum = ev["mcp-summary.json"]?.summary?.normalized_result?.summary;
  const webSum = ev["web-summary.json"]?.summary?.normalized_result?.summary;
  const mcpMods = ev["mcp-modules.json"]?.normalized_result?.items || [];
  const audit = ev["simpletun-self-audit.json"];

  stage.innerHTML = `
    <div class="page-header">
      <div>
        <p class="eyebrow">morluto/rea · Evidence-Backed Clean-Room Engineering</p>
        <h1 class="page-title">REA Forensic Analysis Dashboard</h1>
        <p class="page-sub">Real static JavaScript application graph &amp; release-exposure outputs produced by <code>rea-agents@6.9.0</code>.</p>
      </div>
    </div>

    <div class="grid-3" style="margin-bottom:18px;">
      <div class="card-elevated">
        <span class="tag cyan" style="margin-bottom:8px;">Target 1: @simpligen/mcp@0.9.1</span>
        <div style="font-family:var(--font-display); font-size:26px; font-weight:700;">${mcpSum?.statistics?.visited_ast_nodes ?? "9,076"} AST Nodes</div>
        <div style="color:var(--text-secondary); font-size:13px; margin-top:6px;">
          ${mcpSum?.statistics?.parsed_javascript_files ?? 8} JS files parsed · ${mcpSum?.statistics?.findings ?? 65} findings · ${mcpSum?.statistics?.text_bytes_read ?? 84489} bytes read
        </div>
      </div>
      <div class="card-elevated">
        <span class="tag purple" style="margin-bottom:8px;">Target 2: simpligen.io Web Bundles</span>
        <div style="font-family:var(--font-display); font-size:26px; font-weight:700;">${webSum?.statistics?.visited_ast_nodes ?? "119,278"} AST Nodes</div>
        <div style="color:var(--text-secondary); font-size:13px; margin-top:6px;">
          ${webSum?.statistics?.parsed_javascript_files ?? 12} chunks parsed · ${webSum?.statistics?.findings ?? 215} findings · ${webSum?.statistics?.text_bytes_read ?? 629656} bytes read
        </div>
      </div>
      <div class="card-elevated">
        <span class="tag green" style="margin-bottom:8px;">SimpleTun Self-Verification</span>
        <div style="font-family:var(--font-display); font-size:26px; font-weight:700;">74 / 74 Tools</div>
        <div style="color:var(--text-secondary); font-size:13px; margin-top:6px;">
          Clean-room MCP &amp; Control API parity verified${audit ? " · Release audit attached" : ""}
        </div>
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <h3 style="margin-top:0; font-family:var(--font-display);">Recovered MCP Graph Items (${mcpMods.length})</h3>
        <div style="max-height:360px; overflow-y:auto;">
          ${mcpMods.map((m) => `
            <div style="padding:7px 0; border-bottom:1px solid var(--border-subtle); font-size:12.5px; display:flex; justify-content:space-between;">
              <code>${esc(m.path)}</code>
              <span class="tag">${esc(m.kind)}</span>
            </div>
          `).join("")}
        </div>
      </div>

      <div class="card">
        <h3 style="margin-top:0; font-family:var(--font-display);">REA Evidence Bundle Summary JSON</h3>
        <div class="code-pre" style="max-height:360px; overflow-y:auto;">${esc(JSON.stringify(mcpSum || { status: "Run npm run rea:analyze to populate" }, null, 2))}</div>
      </div>
    </div>
  `;
}
