// public/views-generate.js
// Prompt Builder (3-step wizard), Character Studio, Enhancer, Gallery, Preset Store, Model Manager.

import { uiState, api, appUrl, uploadBrowserFile, toast, openModal, closeModal, esc } from "./api.js";

function getCaps() {
  return uiState.bootstrap?.capabilities || [];
}

function filterPresetsForCategory(cat) {
  const caps = getCaps();
  if (cat === "image") return caps.filter((c) => c.mediaType === "image" && !c.inputs.requiresImage && c.promptFamily !== "no-prompt");
  if (cat === "image-edit") return caps.filter((c) => c.mediaType === "image" && c.inputs.requiresImage && c.promptFamily !== "no-prompt");
  if (cat === "t2v") return caps.filter((c) => c.mediaType === "video" && !c.inputs.requiresImage && c.promptFamily !== "no-prompt");
  if (cat === "i2v") return caps.filter((c) => c.mediaType === "video" && c.inputs.requiresImage && c.promptFamily !== "no-prompt");
  return caps;
}

export function renderPromptBuilder(stage, refreshAll) {
  const caps = getCaps();
  const filtered = filterPresetsForCategory(uiState.mediaCategory);
  const selected = caps.find((c) => c.presetId === uiState.selectedPresetId) || filtered[0] || caps[0];
  if (selected && uiState.selectedPresetId !== selected.presetId && !filtered.some((x) => x.presetId === uiState.selectedPresetId)) {
    uiState.selectedPresetId = selected.presetId;
  }
  const loras = uiState.bootstrap?.loras || [];
  const step = uiState.wizardStep;

  stage.innerHTML = `
    <div class="page-header">
      <div>
        <p class="eyebrow">3-Step Prompt Builder</p>
        <h1 class="page-title">ComfyUI outcomes with zero node graphs</h1>
        <p class="page-sub">Pick what to make, choose a tuned preset pack, describe your idea, and render locally or in the cloud.</p>
      </div>
      <div style="display:flex; gap:8px;">
        <button class="btn-secondary btn-sm" id="viewGuideBtn">📖 Prompt Guide</button>
      </div>
    </div>

    <div class="wizard-steps">
      <div class="wiz-step ${step === 1 ? "active" : step > 1 ? "done" : ""}" data-wstep="1">
        <div class="wiz-num">01</div>
        <div>
          <div style="font-weight:700; font-size:13.5px;">Pick a media type</div>
          <div style="font-size:12px; color:var(--text-secondary);">${esc(uiState.mediaCategory.toUpperCase())}</div>
        </div>
      </div>
      <div class="wiz-step ${step === 2 ? "active" : step > 2 ? "done" : ""}" data-wstep="2">
        <div class="wiz-num">02</div>
        <div>
          <div style="font-weight:700; font-size:13.5px;">Choose a style</div>
          <div style="font-size:12px; color:var(--text-secondary);">${esc(selected?.name || "Select preset")}</div>
        </div>
      </div>
      <div class="wiz-step ${step === 3 ? "active" : ""}" data-wstep="3">
        <div class="wiz-num">03</div>
        <div>
          <div style="font-weight:700; font-size:13.5px;">Describe &amp; create</div>
          <div style="font-size:12px; color:var(--text-secondary);">Prompt, settings &amp; render</div>
        </div>
      </div>
    </div>

    ${step === 1 ? `
      <div class="grid-2">
        ${[
          { id: "image", icon: "🖼️", title: "Image Generation", desc: "Create photoreal portraits, product shots, editorial photography, or illustration from text." },
          { id: "image-edit", icon: "🎨", title: "Image Editing & Swaps", desc: "Restyle, relight, swap outfits or characters, or place products using a reference image." },
          { id: "t2v", icon: "🎬", title: "Text-to-Video", desc: "Direct cinematic clips directly from a text description using Wan 2.2, LTX 2.5, or MiniMax H3." },
          { id: "i2v", icon: "✨", title: "Image-to-Video", desc: "Upload a crisp starting frame and animate smooth camera and subject motion." },
        ].map((m) => `
          <button class="media-choice-card ${uiState.mediaCategory === m.id ? "selected" : ""}" data-mcat="${m.id}">
            <div style="font-size:28px; margin-bottom:10px;">${m.icon}</div>
            <div style="font-family:var(--font-display); font-size:20px; font-weight:700; color:#fff; margin-bottom:6px;">${m.title}</div>
            <div style="font-size:13.5px; color:var(--text-secondary); line-height:1.5;">${m.desc}</div>
          </button>
        `).join("")}
      </div>
      <div style="margin-top:18px; display:flex; justify-content:flex-end;">
        <button class="btn-primary" id="nextToStep2">Continue to Style Picker →</button>
      </div>
    ` : ""}

    ${step === 2 ? `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; flex-wrap:wrap; gap:10px;">
        <div style="font-size:13.5px; color:var(--text-secondary);">Showing presets for <strong>${esc(uiState.mediaCategory)}</strong> (${filtered.length} available)</div>
        <button class="btn-secondary btn-sm" id="backToStep1">← Change Media Type</button>
      </div>
      <div class="grid-3">
        ${filtered.map((p) => {
          const isSel = selected?.presetId === p.presetId;
          const vramFit = p.minVramGb <= (uiState.bootstrap?.status?.vramGb || 16);
          const totalGb = (p.requiredModels || []).reduce((sum, m) => sum + (Number(m.sizeGb) || 0), 0);
          const is2026Flagship = ["z-image-turbo", "flux-klein", "flux-klein-edit", "krea2-turbo", "qwen-image-21", "qwen-image-21-edit"].includes(p.presetId);
          return `
            <div class="preset-card ${isSel ? "selected" : ""}" data-preset="${esc(p.presetId)}">
              <div>
                <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; flex-wrap:wrap; margin-bottom:8px;">
                  <span class="tag">${p.minVramGb ? `${p.minVramGb} GB VRAM` : esc(p.packId)}</span>
                  ${is2026Flagship ? `<span class="tag purple">2026 Latest</span>` : ""}
                  ${p.apiProvider ? `<span class="tag amber">BYOK · ${esc(p.apiProvider)}</span>` : vramFit ? `<span class="tag green">✓ Fits your GPU</span>` : `<span class="tag amber">Tight VRAM / Cloud</span>`}
                </div>
                <div style="font-family:var(--font-display); font-size:17px; font-weight:700; color:#fff; margin-bottom:6px;">${esc(p.name)}</div>
                <div style="font-size:13px; color:var(--text-secondary); line-height:1.45;">${esc(p.description)}</div>
              </div>
              <div style="display:flex; flex-wrap:wrap; gap:6px; padding-top:8px; border-top:1px solid var(--border-subtle);">
                ${p.weightsOnDisk ? `<span class="tag green">Weights Ready</span>` : p.apiProvider ? `<span class="tag amber">Remote API</span>` : `<span class="tag amber">Download (${totalGb.toFixed(1)} GB)</span>`}
                ${(p.requiredModels || []).length === 1 ? `<span class="tag">1-File</span>` : totalGb > 0 ? `<span class="tag">${p.requiredModels.length} files · ${totalGb.toFixed(1)} GB</span>` : ""}
                ${p.inputs.supportsLoras ? `<span class="tag purple">LoRAs</span>` : ""}
                ${p.cloudEligible ? `<span class="tag cyan">Cloud · ${p.cloudCost} cr</span>` : ""}
              </div>
            </div>
          `;
        }).join("")}
      </div>
      <div style="margin-top:18px; display:flex; justify-content:flex-end;">
        <button class="btn-primary" id="nextToStep3">Continue to Prompt &amp; Create →</button>
      </div>
    ` : ""}

    ${step === 3 && selected ? `
      <div class="grid-2" style="grid-template-columns: 1.35fr 0.85fr;">
        <div class="card-elevated">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
            <div>
              <span class="tag cyan">${esc(selected.name)}</span>
              <span class="tag" style="margin-left:6px;">${esc(selected.mediaType.toUpperCase())}</span>
            </div>
            <button class="btn-secondary btn-sm" id="backToStep2">← Change Style</button>
          </div>

          <div class="field">
            <label class="field-label">
              <span>Describe what you want to create</span>
              <span style="font-weight:500; color:var(--text-muted);">Lead with subject, lighting &amp; lens</span>
            </label>
            <textarea id="genPromptInput" class="textarea" placeholder="Describe subject, setting, camera angle, lighting...">${esc(uiState.form.prompt)}</textarea>
            <div class="quick-chips">
              ${[
                { label: "+ 85mm shallow DoF", add: "85mm telephoto lens, shallow depth of field, creamy background bokeh" },
                { label: "+ Golden rim light", add: "warm low golden hour rim light casting crisp shadows" },
                { label: "+ Natural skin/fur texture", add: "rich fine surface texture, natural lighting, no airbrushing" },
                { label: "+ 35mm documentary grain", add: "shot on 35mm Kodak Portra film, authentic optical contrast" },
                { label: "+ Single centered subject", add: "single centered subject framed with clean breathing room" },
              ].map((q) => `<button type="button" class="quick-chip" data-qadd="${esc(q.add)}">${esc(q.label)}</button>`).join("")}
            </div>
          </div>

          ${selected.inputs.requiresImage || selected.inputs.acceptsReferenceImages ? `
            <div class="field">
              <label class="field-label"><span>${selected.inputs.requiresImage ? "Starting / Source Image (Required)" : "Reference Image (Optional)"}</span></label>
              <div style="display:flex; gap:10px; align-items:center;">
                <input type="file" id="genImageFile" accept="image/*" class="input" style="padding:7px;" />
                ${uiState.form.imageHandle ? `<span class="tag green">Uploaded: ${esc(uiState.form.imageHandle)}</span>` : ""}
              </div>
            </div>
          ` : ""}

          ${selected.inputs.acceptsVideo ? `
            <div class="field">
              <label class="field-label"><span>Driving Video (Required)</span></label>
              <input type="file" id="genVideoFile" accept="video/*" class="input" style="padding:7px;" />
            </div>
          ` : ""}

          <div class="field">
            <label class="field-label"><span>Negative Prompt (Optional)</span><span style="font-weight:500; color:var(--text-muted);">Raw pass-through — zero hidden filters</span></label>
            <input id="genNegInput" class="input" value="${esc(uiState.form.negativePrompt)}" placeholder="Leave blank for pure prompt, or list defects to avoid" />
          </div>

          ${selected.inputs.supportsLoras ? `
            <div class="field">
              <label class="field-label"><span>LoRA Stack (${uiState.form.loras.length} active)</span></label>
              <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:8px;">
                ${uiState.form.loras.map((l, idx) => `
                  <span class="tag purple">${esc(l.name)} (${l.weight}) <button data-rm-lora="${idx}" style="background:none;border:none;color:#fff;cursor:pointer;margin-left:4px;">×</button></span>
                `).join("")}
              </div>
              <div style="display:flex; gap:8px;">
                <select id="loraPickSelect" class="select">
                  <option value="">+ Choose a LoRA from Library...</option>
                  ${loras.map((l) => {
                    const mismatch = l.baseModel !== selected.baseModel;
                    return `<option value="${esc(l.name)}">${esc(l.name)} [${esc(l.baseModel)}]${mismatch ? " ⚠ Built for " + l.baseModel : ""}</option>`;
                  }).join("")}
                </select>
                <button class="btn-secondary btn-sm" id="addLoraToStackBtn">Add</button>
              </div>
            </div>
          ` : ""}

          ${(() => {
            const st = uiState.bootstrap?.status || {};
            const strict = Boolean(uiState.bootstrap?.settings?.strictRealEngine);
            if (selected.apiProvider) return "";
            const modernArch = ["z-image-turbo", "flux2-klein", "krea2-turbo", "qwen-image-21"].includes(selected.workflowArch);
            const alerts = [];
            if (!st.engineInstalled) alerts.push("ComfyUI engine is not installed yet.");
            else if (!st.engineRunning) alerts.push("ComfyUI engine is installed but stopped.");
            if (st.engineNeedsUpgrade && modernArch) {
              alerts.push(`ComfyUI ${st.engineVersion} needs upgrade to ${st.targetEngineVersion} for ${selected.name}.`);
            }
            if (!selected.weightsOnDisk) alerts.push(`Missing local weight file(s) for ${selected.name}.`);
            if (alerts.length === 0) {
              return `<div style="margin-top:14px; padding:10px 12px; border-radius:10px; background:rgba(16,185,129,0.12); border:1px solid rgba(16,185,129,0.35); font-size:12.5px; color:#a7f3d0;">
                <strong>Ready for Real GPU Execution:</strong> ${st.workerCount || 1} ComfyUI worker(s) live (${esc(st.engineVersion)}) &amp; weights verified on disk.
              </div>`;
            }
            return `
              <div style="margin-top:14px; padding:12px; border-radius:10px; background:rgba(245,158,11,0.12); border:1px solid rgba(245,158,11,0.45); font-size:12.5px; color:#fde68a;">
                <div style="font-weight:700; margin-bottom:6px;">⚠️ ${esc(alerts.join(" "))}</div>
                <div style="color:var(--text-secondary); margin-bottom:8px;">
                  ${strict
                    ? "Strict Real GPU Mode is ON — generation will wait/fail until ComfyUI is live and weights are downloaded."
                    : "Until ComfyUI + weights are active, Local Generate produces a labeled Sandbox Preview instead of real diffusion."}
                </div>
                <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
                  ${!st.engineInstalled ? `<button class="btn-primary btn-sm" id="inlineInstallEngBtn" ${st.engineInstalling ? "disabled" : ""}>⬇ ${st.engineInstalling ? `Installing (${esc(st.engineInstallStage)})...` : `Install ComfyUI ${esc(st.targetEngineVersion || "")}`}</button>` : ""}
                  ${st.engineInstalled && st.engineNeedsUpgrade ? `<button class="btn-primary btn-sm" id="inlineUpgradeEngBtn" ${st.engineInstalling ? "disabled" : ""}>⬆ ${st.engineInstalling ? "Upgrading..." : `Upgrade ComfyUI → ${esc(st.targetEngineVersion || "v0.45.0")}`}</button>` : ""}
                  ${st.engineInstalled && !st.engineRunning ? `<button class="btn-primary btn-sm" id="inlineStartEngBtn">▶ Start ComfyUI (${st.cudaGpuCount || 1} GPU)</button>` : ""}
                  <label style="display:inline-flex; align-items:center; gap:6px; font-size:12px; color:#fff; cursor:pointer; margin-left:auto;">
                    <input type="checkbox" id="inlineStrictGpuChk" ${strict ? "checked" : ""} />
                    <span>Real GPU Only (no sandbox)</span>
                  </label>
                </div>
              </div>
            `;
          })()}

          <div style="display:flex; gap:10px; margin-top:14px; flex-wrap:wrap;">
            ${!selected.apiProvider ? `
              ${!selected.weightsOnDisk ? `<button class="btn-secondary" id="downloadPresetWeightsBtn">⬇ Download Model Weights (${esc((selected.requiredModels || []).map((m) => m.sizeGb).reduce((a, b) => a + b, 0).toFixed(1))} GB)</button>` : ""}
              <button class="btn-primary" id="runLocalGenBtn" style="flex:1;">⚡ ${uiState.bootstrap?.status?.engineRunning ? "Generate on GPU(s) ($0)" : "Generate Local ($0)"}</button>
              ${selected.cloudEligible ? `<button class="btn-secondary" id="runCloudGenBtn" style="flex:1;">☁️ Generate Cloud (${selected.cloudCost * (Number(uiState.form.count) || 1)} cr)</button>` : ""}
            ` : `
              <button class="btn-primary" id="runByokGenBtn" style="flex:1;">🔑 Generate via ${esc(selected.apiProvider.toUpperCase())} BYOK</button>
            `}
          </div>
        </div>

        <div class="card">
          <h3 style="margin:0 0 14px; font-family:var(--font-display); font-size:17px;">Format &amp; Advanced Controls</h3>
          <div class="field">
            <label class="field-label">Aspect Ratio</label>
            <div class="chip-group" id="aspectChips">
              ${(selected.options.aspectRatio || ["1:1", "16:9", "9:16"]).map((r) => `
                <button class="chip ${uiState.form.aspectRatio === r ? "active" : ""}" data-aspect="${r}">${r}</button>
              `).join("")}
            </div>
          </div>

          <div class="field">
            <label class="field-label">Resolution Tier</label>
            <div class="chip-group" id="resChips">
              ${(selected.options.resolution || ["720p", "1080p"]).map((r) => `
                <button class="chip ${uiState.form.resolution === r ? "active" : ""}" data-res="${r}">${r}</button>
              `).join("")}
            </div>
          </div>

          ${selected.mediaType === "image" ? `
            <div class="field">
              <label class="field-label">
                <span>Quality &amp; Detail Pass</span>
                <span style="color:var(--brand-cyan); font-weight:600;">2-Pass eliminates artifacts</span>
              </label>
              <div class="quality-grid">
                ${[
                  { id: "standard", title: "Fast 1-Pass", desc: "Instant native 1MP" },
                  { id: "hires", title: "Hires Fix 1.5x", desc: "Crisp detail (rec)" },
                  { id: "ultra", title: "Ultra 2-Pass", desc: "Max fine texture" },
                ].map((q) => `
                  <button type="button" class="quality-card ${uiState.form.qualityMode === q.id ? "active" : ""}" data-qmode="${q.id}">
                    <div style="font-size:12.5px; font-weight:700;">${esc(q.title)}</div>
                    <div style="font-size:11px; color:var(--text-secondary); margin-top:2px;">${esc(q.desc)}</div>
                  </button>
                `).join("")}
              </div>
            </div>
          ` : ""}

          ${selected.options.duration ? `
            <div class="field">
              <label class="field-label"><span>Duration (seconds)</span><span>${uiState.form.durationSeconds}s</span></label>
              <input type="range" id="durSlider" min="${selected.options.duration.min}" max="${selected.options.duration.max}" step="${selected.options.duration.step || 1}" value="${uiState.form.durationSeconds}" />
            </div>
          ` : ""}

          <div class="grid-2">
            <div class="field">
              <label class="field-label">Seed (blank = random)</label>
              <input id="seedInput" class="input" value="${esc(uiState.form.seed)}" placeholder="Random" />
            </div>
            <div class="field">
              <label class="field-label">Batch Count</label>
              <input id="countInput" type="number" min="1" max="4" class="input" value="${esc(uiState.form.count)}" />
            </div>
          </div>

          ${selected.options.steps ? `
            <div class="field">
              <label class="field-label"><span>Refinement Steps</span><span id="stepsVal">${uiState.form.steps}</span></label>
              <input type="range" id="stepsSlider" min="${selected.options.steps.min}" max="${selected.options.steps.max}" value="${uiState.form.steps}" />
            </div>
          ` : ""}

          ${selected.options.cfg ? `
            <div class="field">
              <label class="field-label"><span>Guidance (CFG)</span><span id="cfgVal">${uiState.form.cfg}</span></label>
              <input type="range" id="cfgSlider" min="${selected.options.cfg.min}" max="${selected.options.cfg.max}" step="0.1" value="${uiState.form.cfg}" />
            </div>
          ` : ""}

          ${selected.options.controls?.high_steps ? `
            <div style="border-top:1px solid var(--border-subtle); padding-top:12px; margin-top:8px;">
              <div style="font-size:12px; font-weight:700; color:var(--brand-cyan); margin-bottom:8px;">Wan 2.2 Dual-Pass &amp; Schedule</div>
              <div class="grid-2">
                <div class="field">
                  <label class="field-label">High-Pass Steps</label>
                  <input id="highStepsInput" type="number" class="input" value="${uiState.form.high_steps}" />
                </div>
                <div class="field">
                  <label class="field-label">Low-Pass Steps</label>
                  <input id="lowStepsInput" type="number" class="input" value="${uiState.form.low_steps}" />
                </div>
              </div>
              <div class="field">
                <label class="field-label"><span>Schedule Shift</span><span>${uiState.form.shift}</span></label>
                <input id="shiftSlider" type="range" min="1" max="12" step="0.5" value="${uiState.form.shift}" />
              </div>
            </div>
          ` : ""}
        </div>
      </div>
    ` : ""}
  `;

  // Wire Wizard events
  stage.querySelectorAll("[data-wstep]").forEach((el) => {
    el.onclick = () => { uiState.wizardStep = Number(el.dataset.wstep); renderPromptBuilder(stage, refreshAll); };
  });
  stage.querySelectorAll("[data-mcat]").forEach((el) => {
    el.onclick = () => {
      uiState.mediaCategory = el.dataset.mcat;
      const list = filterPresetsForCategory(uiState.mediaCategory);
      if (list[0]) uiState.selectedPresetId = list[0].presetId;
      renderPromptBuilder(stage, refreshAll);
    };
  });
  const s2 = document.getElementById("nextToStep2");
  if (s2) s2.onclick = () => { uiState.wizardStep = 2; renderPromptBuilder(stage, refreshAll); };
  const b1 = document.getElementById("backToStep1");
  if (b1) b1.onclick = () => { uiState.wizardStep = 1; renderPromptBuilder(stage, refreshAll); };
  const s3 = document.getElementById("nextToStep3");
  if (s3) s3.onclick = () => { uiState.wizardStep = 3; renderPromptBuilder(stage, refreshAll); };
  const b2 = document.getElementById("backToStep2");
  if (b2) b2.onclick = () => { uiState.wizardStep = 2; renderPromptBuilder(stage, refreshAll); };

  stage.querySelectorAll("[data-preset]").forEach((el) => {
    el.onclick = () => {
      uiState.selectedPresetId = el.dataset.preset;
      const p = caps.find((c) => c.presetId === uiState.selectedPresetId);
      if (p?.options?.steps) uiState.form.steps = p.options.steps.default;
      if (p?.options?.cfg) uiState.form.cfg = p.options.cfg.default;
      uiState.wizardStep = 3;
      renderPromptBuilder(stage, refreshAll);
    };
  });

  const viewGuideBtn = document.getElementById("viewGuideBtn");
  if (viewGuideBtn && selected) {
    viewGuideBtn.onclick = async () => {
      const g = await api(`/prompt-guide/${encodeURIComponent(selected.presetId)}`);
      openModal(`
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <h3 style="margin:0; font-family:var(--font-display);">${esc(g.familyName)} Prompting Guide</h3>
          <button class="btn-secondary btn-sm" id="closeModalBtn">Close</button>
        </div>
        <div class="code-pre">${esc(g.text)}</div>
      `);
      document.getElementById("closeModalBtn").onclick = closeModal;
    };
  }

  // Step 3 form bindings
  const syncText = () => {
    const p = document.getElementById("genPromptInput");
    const n = document.getElementById("genNegInput");
    const sd = document.getElementById("seedInput");
    const ct = document.getElementById("countInput");
    if (p) uiState.form.prompt = p.value;
    if (n) uiState.form.negativePrompt = n.value;
    if (sd) uiState.form.seed = sd.value;
    if (ct) uiState.form.count = Number(ct.value) || 1;
  };
  stage.querySelectorAll("[data-qadd]").forEach((b) => {
    b.onclick = () => {
      syncText();
      const phrase = b.dataset.qadd;
      const cur = (uiState.form.prompt || "").trim();
      if (!cur.toLowerCase().includes(phrase.toLowerCase())) {
        uiState.form.prompt = cur ? `${cur.replace(/[,\s]+$/, "")}, ${phrase}` : phrase;
        const box = document.getElementById("genPromptInput");
        if (box) box.value = uiState.form.prompt;
      }
    };
  });
  stage.querySelectorAll("[data-qmode]").forEach((b) => {
    b.onclick = () => { syncText(); uiState.form.qualityMode = b.dataset.qmode; renderPromptBuilder(stage, refreshAll); };
  });
  stage.querySelectorAll("[data-aspect]").forEach((b) => {
    b.onclick = () => { syncText(); uiState.form.aspectRatio = b.dataset.aspect; renderPromptBuilder(stage, refreshAll); };
  });
  stage.querySelectorAll("[data-res]").forEach((b) => {
    b.onclick = () => { syncText(); uiState.form.resolution = b.dataset.res; renderPromptBuilder(stage, refreshAll); };
  });
  const durS = document.getElementById("durSlider");
  if (durS) durS.oninput = () => { uiState.form.durationSeconds = Number(durS.value); renderPromptBuilder(stage, refreshAll); };
  const stepsS = document.getElementById("stepsSlider");
  if (stepsS) stepsS.oninput = () => { uiState.form.steps = Number(stepsS.value); document.getElementById("stepsVal").textContent = stepsS.value; };
  const cfgS = document.getElementById("cfgSlider");
  if (cfgS) cfgS.oninput = () => { uiState.form.cfg = Number(cfgS.value); document.getElementById("cfgVal").textContent = cfgS.value; };

  const imgFile = document.getElementById("genImageFile");
  if (imgFile) {
    imgFile.onchange = async () => {
      if (!imgFile.files[0]) return;
      const up = await uploadBrowserFile(imgFile.files[0]);
      uiState.form.imageHandle = up.handle;
      toast(`Uploaded ${imgFile.files[0].name}`);
      renderPromptBuilder(stage, refreshAll);
    };
  }

  const addLoraBtn = document.getElementById("addLoraToStackBtn");
  if (addLoraBtn) {
    addLoraBtn.onclick = () => {
      syncText();
      const name = document.getElementById("loraPickSelect").value;
      if (!name) return;
      const found = loras.find((l) => l.name === name);
      if (found && found.baseModel !== selected.baseModel) {
        toast(`Warning: "${found.name}" is built for ${found.baseModel}, current preset is ${selected.baseModel}`);
      }
      uiState.form.loras.push({ name, weight: found?.defaultStrength || 0.85 });
      renderPromptBuilder(stage, refreshAll);
    };
  }
  stage.querySelectorAll("[data-rm-lora]").forEach((b) => {
    b.onclick = () => {
      syncText();
      uiState.form.loras.splice(Number(b.dataset.rmLora), 1);
      renderPromptBuilder(stage, refreshAll);
    };
  });

  const dispatchGen = async (backendMode) => {
    syncText();
    const count = Math.max(1, Math.min(Number(uiState.form.count) || 1, 4));
    try {
      for (let i = 0; i < count; i++) {
        const seedVal = uiState.form.seed ? Number(uiState.form.seed) + i : undefined;
        await api("/generate", {
          method: "POST",
          body: {
            presetId: selected.presetId,
            packId: selected.packId,
            mediaType: selected.mediaType,
            prompt: uiState.form.prompt,
            negativePrompt: uiState.form.negativePrompt,
            backend: backendMode,
            image: uiState.form.imageHandle || undefined,
            loras: uiState.form.loras,
            options: {
              aspectRatio: uiState.form.aspectRatio,
              resolution: uiState.form.resolution,
              qualityMode: uiState.form.qualityMode || "standard",
              durationSeconds: uiState.form.durationSeconds,
              steps: uiState.form.steps,
              cfg: uiState.form.cfg,
              ...(seedVal !== undefined && !Number.isNaN(seedVal) ? { seed: seedVal } : {}),
            },
          },
        });
      }
      uiState.queueOpen = true;
      toast(`Queued ${count} ${selected.mediaType} generation(s) on ${backendMode}!`);
      await refreshAll();
    } catch (err) {
      toast(err.message, true);
    }
  };

  const inlineInstBtn = document.getElementById("inlineInstallEngBtn");
  if (inlineInstBtn) {
    inlineInstBtn.onclick = async () => {
      try {
        await api("/api/ui/engine/install", { method: "POST" });
        toast("Started ComfyUI + PyTorch CUDA installation (check Engine modal for live logs).");
        await refreshAll();
      } catch (err) { toast(err.message, true); }
    };
  }
  const inlineUpgradeBtn = document.getElementById("inlineUpgradeEngBtn");
  if (inlineUpgradeBtn) {
    inlineUpgradeBtn.onclick = async () => {
      try {
        await api("/api/ui/engine/upgrade", { method: "POST" });
        toast("Started upgrading ComfyUI Engine to v0.45.0 (open Engine modal to follow live logs).");
        await refreshAll();
      } catch (err) { toast(err.message, true); }
    };
  }
  const inlineStartBtn = document.getElementById("inlineStartEngBtn");
  if (inlineStartBtn) {
    inlineStartBtn.onclick = async () => {
      try {
        const r = await api("/engine/start", { method: "POST" });
        toast(r.engineRunning ? `Started ${r.workerCount || 1} ComfyUI GPU worker(s)!` : "ComfyUI workers booting...");
        await refreshAll();
      } catch (err) { toast(err.message, true); }
    };
  }
  const inlineStrict = document.getElementById("inlineStrictGpuChk");
  if (inlineStrict) {
    inlineStrict.onchange = async () => {
      try {
        await api("/api/ui/settings", { method: "POST", body: { settings: { strictRealEngine: inlineStrict.checked } } });
        toast(inlineStrict.checked ? "Strict Real GPU Mode enabled." : "Sandbox fallback allowed.");
        await refreshAll();
      } catch (err) { toast(err.message, true); }
    };
  }
  const dlWeightsBtn = document.getElementById("downloadPresetWeightsBtn");
  if (dlWeightsBtn) {
    dlWeightsBtn.onclick = async () => {
      try {
        const r = await api("/api/ui/models/download", { method: "POST", body: { presetId: selected.presetId, packId: selected.packId } });
        toast(r.status === "started" ? `Downloading weights: ${(r.downloading || []).join(", ")}` : "Weights already present.");
        await refreshAll();
      } catch (err) { toast(err.message, true); }
    };
  }
  const localBtn = document.getElementById("runLocalGenBtn");
  if (localBtn) localBtn.onclick = () => dispatchGen("local");
  const cloudBtn = document.getElementById("runCloudGenBtn");
  if (cloudBtn) cloudBtn.onclick = () => dispatchGen("cloud");
  const byokBtn = document.getElementById("runByokGenBtn");
  if (byokBtn) byokBtn.onclick = () => dispatchGen("auto");
}

export function renderCharacters(stage, refreshAll) {
  const chars = uiState.bootstrap?.characters || [];
  const features = uiState.bootstrap?.characterFeatures?.categories || [];
  const jobs = uiState.bootstrap?.jobs || [];
  const active = chars.find((c) => c.id === uiState.selectedCharacterId) || chars[0] || null;
  if (active) uiState.selectedCharacterId = active.id;

  stage.innerHTML = `
    <div class="page-header">
      <div>
        <p class="eyebrow">Character Studio</p>
        <h1 class="page-title">Lock a face once, reuse everywhere</h1>
        <p class="page-sub">Describe a base portrait or upload a photo. Generate scenes by describing only the setting, then enhance and animate.</p>
      </div>
      <button class="btn-primary" id="newCharModalBtn">+ New Character</button>
    </div>

    ${chars.length === 0 ? `
      <div class="card-elevated" style="text-align:center; padding:48px 24px;">
        <div style="font-size:38px; margin-bottom:10px;">👤</div>
        <h3 style="margin:0 0 8px; font-family:var(--font-display);">No characters created yet</h3>
        <p style="color:var(--text-secondary); max-width:46ch; margin:0 auto 18px;">Create your first consistent AI character from Identity Builder menus or by uploading a portrait.</p>
        <button class="btn-primary" id="emptyNewCharBtn">Create First Character</button>
      </div>
    ` : `
      <div class="grid-2" style="grid-template-columns: 300px minmax(0, 1fr);">
        <div class="card">
          <div style="font-size:12px; font-weight:700; color:var(--text-muted); text-transform:uppercase; margin-bottom:10px;">Saved Characters</div>
          ${chars.map((c) => `
            <div class="preset-card ${active?.id === c.id ? "selected" : ""}" data-sel-char="${esc(c.id)}" style="margin-bottom:10px; padding:10px; flex-direction:row; align-items:center;">
              <div style="display:flex; align-items:center; gap:10px;">
                <img src="${esc(appUrl(c.base_image_url || ""))}" alt="" style="width:44px; height:44px; border-radius:9px; object-fit:cover; background:#111;" />
                <div>
                  <div style="font-weight:700; color:#fff;">${esc(c.name)}</div>
                  <div style="font-size:11.5px; color:var(--text-secondary);">${esc(c.gender)} · ${c.generations?.length || 0} assets</div>
                </div>
              </div>
            </div>
          `).join("")}
        </div>

        ${active ? `
          <div class="card-elevated">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:16px; flex-wrap:wrap; margin-bottom:18px;">
              <div style="display:flex; gap:16px; align-items:center;">
                <img src="${esc(appUrl(active.base_image_url || ""))}" alt="${esc(active.name)}" style="width:96px; height:120px; border-radius:12px; object-fit:cover; border:1px solid var(--border-emphasis); background:#000;" />
                <div>
                  <h2 style="margin:0 0 6px; font-family:var(--font-display);">${esc(active.name)}</h2>
                  <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:10px;">
                    <span class="tag cyan">${esc(active.gender)}</span>
                    ${Object.entries(active.identity || {}).map(([k, v]) => `<span class="tag">${esc(k)}: ${esc(v)}</span>`).join("")}
                  </div>
                  <div style="display:flex; gap:8px; flex-wrap:wrap;">
                    <button class="btn-secondary btn-sm" id="enhanceCharBaseBtn">✨ Enhance Base</button>
                    <button class="btn-danger btn-sm" id="deleteCharBtn">Delete</button>
                  </div>
                </div>
              </div>
            </div>

            <div class="grid-2" style="margin-bottom:18px;">
              <div class="card">
                <h4 style="margin:0 0 10px;">1. Generate Scene Image</h4>
                <div class="field">
                  <label class="field-label">Describe ONLY the scene (not the person)</label>
                  <input id="charScenePrompt" class="input" placeholder="e.g. sitting in a Tokyo coffee shop by a rainy window" value="standing on a rooftop at sunset overlooking neon city lights" />
                </div>
                <div style="display:flex; gap:8px;">
                  <select id="charSceneAspect" class="select" style="width:120px;">
                    <option value="16:9">16:9</option>
                    <option value="9:16">9:16</option>
                    <option value="1:1">1:1</option>
                  </select>
                  <button class="btn-primary btn-sm" id="charGenImgBtn" style="flex:1;">Generate Scene</button>
                </div>
              </div>

              <div class="card">
                <h4 style="margin:0 0 10px;">2. Animate Character Video</h4>
                <div class="field">
                  <label class="field-label">Motion Description</label>
                  <input id="charMotionPrompt" class="input" value="smiling gently and looking toward the camera as breeze moves hair" />
                </div>
                <button class="btn-primary btn-sm" id="charGenVidBtn" style="width:100%;">Generate Start Frame &amp; Animate</button>
              </div>
            </div>

            <h4 style="margin:0 0 10px;">Character Dashboard Assets</h4>
            <div class="grid-3">
              ${(active.generations || []).map((jid) => {
                const j = jobs.find((x) => x.jobId === jid);
                if (!j || !j.resultUrl) return "";
                return `
                  <div class="card" style="padding:10px;">
                    ${j.mediaType === "video"
                      ? `<video src="${esc(appUrl(j.resultUrl))}" poster="${esc(appUrl(j.posterUrl || ""))}" controls muted playsinline class="media-thumb"></video>`
                      : `<img src="${esc(appUrl(j.resultUrl))}" class="media-thumb" alt="${esc(j.prompt)}" />`}
                    <div style="font-size:12px; color:var(--text-secondary); margin-top:6px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(j.prompt)}</div>
                    <div style="display:flex; gap:6px; margin-top:8px;">
                      <button class="btn-secondary btn-sm" data-enh-job="${esc(j.jobId)}">✨ Enhance</button>
                      ${j.mediaType === "image" ? `<button class="btn-secondary btn-sm" data-anim-job="${esc(j.jobId)}">🎬 Animate</button>` : ""}
                    </div>
                  </div>
                `;
              }).join("")}
            </div>
          </div>
        ` : ""}
      </div>
    `}
  `;

  const openNewCharModal = () => {
    openModal(`
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
        <h3 style="margin:0; font-family:var(--font-display);">Create Character</h3>
        <button class="btn-secondary btn-sm" id="closeCharModal">Close</button>
      </div>
      <div class="grid-2">
        <div class="field"><label class="field-label">Name</label><input id="newCharName" class="input" value="Kai" /></div>
        <div class="field"><label class="field-label">Gender</label>
          <select id="newCharGender" class="select"><option value="woman">Woman</option><option value="man">Man</option><option value="nonbinary">Nonbinary</option></select>
        </div>
      </div>
      <div class="field">
        <label class="field-label">Creation Mode</label>
        <select id="newCharMode" class="select">
          <option value="generate">Describe a base (Identity Builder)</option>
          <option value="upload">Upload a photo</option>
        </select>
      </div>
      <div id="identityBuilderGrid" class="grid-2">
        ${features.map((cat) => `
          <div class="field">
            <label class="field-label">${esc(cat.label)}</label>
            <select class="select char-feat-sel" data-feat="${esc(cat.id)}">
              ${cat.options.map((o) => `<option value="${esc(o.id)}">${esc(o.label)}</option>`).join("")}
            </select>
          </div>
        `).join("")}
      </div>
      <div id="uploadBaseBox" class="field" style="display:none;">
        <label class="field-label">Upload Base Photo</label>
        <input type="file" id="charBaseFile" accept="image/*" class="input" />
      </div>
      <button class="btn-primary" id="submitCreateCharBtn" style="width:100%; margin-top:10px;">Create Character &amp; Anchor Portrait</button>
    `);

    document.getElementById("closeCharModal").onclick = closeModal;
    const modeSel = document.getElementById("newCharMode");
    modeSel.onchange = () => {
      const isUp = modeSel.value === "upload";
      document.getElementById("identityBuilderGrid").style.display = isUp ? "none" : "grid";
      document.getElementById("uploadBaseBox").style.display = isUp ? "flex" : "none";
    };
    document.getElementById("submitCreateCharBtn").onclick = async () => {
      const name = document.getElementById("newCharName").value.trim();
      const gender = document.getElementById("newCharGender").value;
      const mode = modeSel.value;
      try {
        if (mode === "upload") {
          const file = document.getElementById("charBaseFile").files[0];
          if (!file) return toast("Please choose an image file", true);
          const up = await uploadBrowserFile(file);
          const created = await api("/characters", { method: "POST", body: { name, gender, mode: "upload", baseHandle: up.handle } });
          uiState.selectedCharacterId = created.characterId;
        } else {
          const identity = {};
          document.querySelectorAll(".char-feat-sel").forEach((s) => { identity[s.dataset.feat] = s.value; });
          const created = await api("/characters", { method: "POST", body: { name, gender, mode: "generate", identity } });
          uiState.selectedCharacterId = created.characterId;
        }
        closeModal();
        toast(`Character "${name}" created!`);
        await refreshAll();
      } catch (err) {
        toast(err.message, true);
      }
    };
  };

  const b1 = document.getElementById("newCharModalBtn");
  const b2 = document.getElementById("emptyNewCharBtn");
  if (b1) b1.onclick = openNewCharModal;
  if (b2) b2.onclick = openNewCharModal;

  stage.querySelectorAll("[data-sel-char]").forEach((el) => {
    el.onclick = () => { uiState.selectedCharacterId = el.dataset.selChar; renderCharacters(stage, refreshAll); };
  });

  if (active) {
    document.getElementById("deleteCharBtn").onclick = async () => {
      await api(`/characters/${active.id}`, { method: "DELETE" });
      uiState.selectedCharacterId = null;
      toast("Character deleted");
      await refreshAll();
    };
    document.getElementById("enhanceCharBaseBtn").onclick = async () => {
      await api(`/characters/${active.id}/enhance`, { method: "POST", body: { target: "base", scale: 2, keepResolution: true, applyAsBase: true } });
      toast("Enhancing character base portrait...");
      await refreshAll();
    };
    document.getElementById("charGenImgBtn").onclick = async () => {
      const prompt = document.getElementById("charScenePrompt").value;
      const aspect = document.getElementById("charSceneAspect").value;
      await api(`/characters/${active.id}/generate-image`, { method: "POST", body: { prompt, aspect } });
      uiState.queueOpen = true;
      toast("Generating scene with locked character face...");
      await refreshAll();
    };
    document.getElementById("charGenVidBtn").onclick = async () => {
      const prompt = document.getElementById("charScenePrompt").value;
      const motion = document.getElementById("charMotionPrompt").value;
      const frame = await api(`/characters/${active.id}/generate-frame`, { method: "POST", body: { prompt, aspect: "16:9" } });
      const fJobId = frame.jobIds[0];
      toast("Generating start frame, then animating...");
      setTimeout(async () => {
        await api(`/characters/${active.id}/animate`, { method: "POST", body: { frameJobId: fJobId, motion, aspect: "16:9" } });
        await refreshAll();
      }, 300);
      await refreshAll();
    };
    stage.querySelectorAll("[data-enh-job]").forEach((b) => {
      b.onclick = async () => {
        await api(`/characters/${active.id}/enhance`, { method: "POST", body: { jobId: b.dataset.enhJob, scale: 2 } });
        toast("Upscaling asset 2x...");
        await refreshAll();
      };
    });
    stage.querySelectorAll("[data-anim-job]").forEach((b) => {
      b.onclick = async () => {
        const motion = document.getElementById("charMotionPrompt").value || "natural motion";
        await api(`/characters/${active.id}/animate`, { method: "POST", body: { frameJobId: b.dataset.animJob, motion, aspect: "16:9" } });
        toast("Animating frame...");
        await refreshAll();
      };
    });
  }
}

export function renderGallery(stage, refreshAll) {
  const jobs = (uiState.bootstrap?.jobs || []).filter((j) => j.status === "completed" && j.resultUrl);
  const triggerUpscaleJob = async (job) => {
    try {
      const resp = await fetch(appUrl(job.resultUrl));
      const blob = await resp.blob();
      const up = await uploadBrowserFile(new File([blob], `${job.jobId}.png`, { type: blob.type || "image/png" }));
      await api("/generate", {
        method: "POST",
        body: {
          presetId: "rtx-upscaler",
          packId: "enhancer-pack",
          mediaType: "image",
          prompt: `Enhanced 2x crisp upscale of ${job.presetId}`,
          image: up.handle,
          options: { resolution: "1080p", scale: 2 },
        },
      });
      uiState.queueOpen = true;
      toast("Queued 2x RealESRGAN Upscale in Queue!");
      await refreshAll();
    } catch (err) { toast(err.message, true); }
  };

  stage.innerHTML = `
    <div class="page-header">
      <div>
        <p class="eyebrow">Gallery</p>
        <h1 class="page-title">Finished Generations (${jobs.length})</h1>
        <p class="page-sub">Inspect full-resolution renders, remix prompt/seed, or upscale crispness 2× with RealESRGAN.</p>
      </div>
    </div>
    ${jobs.length === 0 ? `<div class="card" style="padding:36px; text-align:center; color:var(--text-secondary);">No completed generations yet. Start one in the Prompt Builder!</div>` : `
      <div class="grid-3">
        ${jobs.map((j) => `
          <div class="card gallery-card">
            <div>
              <div class="gallery-media-wrap">
                ${j.mediaType === "video"
                  ? `<video src="${esc(appUrl(j.resultUrl))}" poster="${esc(appUrl(j.posterUrl || ""))}" controls muted playsinline class="media-thumb"></video>`
                  : `<img src="${esc(appUrl(j.resultUrl))}" class="media-thumb" alt="${esc(j.prompt)}" style="cursor:pointer;" data-lightbox="${esc(j.jobId)}" />`}
              </div>
              <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px; gap:6px; flex-wrap:wrap;">
                <span class="tag cyan">${esc(j.presetId)}</span>
                ${j.options?.qualityMode && j.options.qualityMode !== "standard" ? `<span class="tag purple">${esc(j.options.qualityMode.toUpperCase())}</span>` : ""}
                <span class="tag ${j.engineUsed === "fallback-synthesizer" ? "amber" : "green"}">${j.engineUsed === "fallback-synthesizer" ? "Sandbox Preview" : esc(j.engineUsed || j.backend)}${j.gpuIndex !== undefined ? ` · GPU #${j.gpuIndex}` : ""}</span>
              </div>
              <div style="font-size:12.5px; color:var(--text-primary); margin-top:6px; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">${esc(j.prompt)}</div>
            </div>
            <div style="display:flex; gap:6px; margin-top:6px; flex-wrap:wrap;">
              <button class="btn-secondary btn-sm" data-remix-job="${esc(j.jobId)}" title="Load prompt, preset &amp; seed into Builder">🔄 Remix</button>
              ${j.mediaType === "image" ? `<button class="btn-secondary btn-sm" data-upscale-job="${esc(j.jobId)}" title="Run 2x RealESRGAN crisp upscale">✨ 2× Upscale</button>` : ""}
              <a class="btn-secondary btn-sm" href="${esc(appUrl(j.resultUrl))}" download style="text-decoration:none; margin-left:auto;">⬇ Save</a>
            </div>
          </div>
        `).join("")}
      </div>
    `}
  `;
  stage.querySelectorAll("[data-remix-job]").forEach((b) => {
    b.onclick = () => {
      const j = jobs.find((x) => x.jobId === b.dataset.remixJob);
      if (!j) return;
      uiState.selectedPresetId = j.presetId;
      uiState.form.prompt = j.prompt;
      uiState.form.seed = j.seed;
      if (j.options?.aspectRatio) uiState.form.aspectRatio = j.options.aspectRatio;
      if (j.options?.resolution) uiState.form.resolution = j.options.resolution;
      if (j.options?.steps) uiState.form.steps = j.options.steps;
      if (j.options?.cfg !== undefined) uiState.form.cfg = j.options.cfg;
      if (j.options?.qualityMode) uiState.form.qualityMode = j.options.qualityMode;
      uiState.screen = "generate";
      uiState.wizardStep = 3;
      toast(`Loaded "${j.presetId}" settings & seed ${j.seed} into Prompt Builder`);
      refreshAll();
    };
  });
  stage.querySelectorAll("[data-upscale-job]").forEach((b) => {
    b.onclick = () => {
      const j = jobs.find((x) => x.jobId === b.dataset.upscaleJob);
      if (j) triggerUpscaleJob(j);
    };
  });
  stage.querySelectorAll("[data-lightbox]").forEach((img) => {
    img.onclick = () => {
      const j = jobs.find((x) => x.jobId === img.dataset.lightbox);
      if (!j) return;
      openModal(`
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <h3 style="margin:0; font-family:var(--font-display);">${esc(j.presetId)} · Seed ${esc(j.seed)}</h3>
          <button class="btn-secondary btn-sm" id="closeLb">Close</button>
        </div>
        <img src="${esc(appUrl(j.resultUrl))}" style="width:100%; border-radius:12px; display:block;" />
        <div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:12px;">
          <span class="tag cyan">${esc(j.options?.aspectRatio || "1:1")} · ${esc(j.options?.resolution || "720p")}</span>
          ${j.options?.qualityMode ? `<span class="tag purple">Pass: ${esc(j.options.qualityMode)}</span>` : ""}
          ${j.options?.steps ? `<span class="tag">Steps: ${esc(j.options.steps)}</span>` : ""}
          ${j.options?.cfg !== undefined ? `<span class="tag">CFG: ${esc(j.options.cfg)}</span>` : ""}
          <span class="tag green">${esc(j.engineUsed || j.backend)}${j.gpuIndex !== undefined ? ` · GPU #${j.gpuIndex}` : ""}</span>
        </div>
        <p style="color:var(--text-secondary); font-size:13px; margin-top:10px;"><strong>Prompt:</strong> ${esc(j.prompt)}</p>
        <p style="color:var(--text-muted); font-size:12px;"><strong>File:</strong> <code>${esc(j.resultPath)}</code></p>
        <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:10px;">
          <button class="btn-primary btn-sm" id="lbUpscaleBtn">✨ Upscale 2× (RealESRGAN)</button>
          <a class="btn-secondary btn-sm" href="${esc(appUrl(j.resultUrl))}" download style="text-decoration:none;">⬇ Download Full Image</a>
        </div>
      `);
      document.getElementById("closeLb").onclick = closeModal;
      document.getElementById("lbUpscaleBtn").onclick = () => { closeModal(); triggerUpscaleJob(j); };
    };
  });
}

export function renderEnhance(stage, refreshAll) {
  const jobs = (uiState.bootstrap?.jobs || []).filter((j) => j.status === "completed" && j.resultUrl);
  stage.innerHTML = `
    <div class="page-header">
      <div>
        <p class="eyebrow">Enhancer &amp; Upscaling</p>
        <h1 class="page-title">Sharpen &amp; upscale up to 4K</h1>
        <p class="page-sub">Choose RTX Fast Upscaler (~100 MB) for crisp still sharpening or SeedVR2 Diffusion Reconstructor for demanding video &amp; stills.</p>
      </div>
    </div>
    <div class="card-elevated" style="max-width:720px;">
      <div class="field">
        <label class="field-label">1. Choose Source from Gallery (or upload file)</label>
        <select id="enhSourceJob" class="select">
          <option value="">-- Select a completed generation --</option>
          ${jobs.map((j) => `<option value="${esc(j.jobId)}">[${esc(j.mediaType)}] ${esc(j.presetId)} — ${esc(j.prompt.slice(0, 50))}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label class="field-label">Or upload a local image/video</label>
        <input type="file" id="enhUploadFile" class="input" accept="image/*,video/*" />
      </div>
      <div class="grid-3">
        <div class="field">
          <label class="field-label">Enhancer Model</label>
          <select id="enhModel" class="select">
            <option value="rtx-upscaler">RTX Fast Upscaler (Images)</option>
            <option value="seedvr2-balanced">SeedVR2 Balanced (Images &amp; Video)</option>
          </select>
        </div>
        <div class="field">
          <label class="field-label">Scale Factor</label>
          <select id="enhScale" class="select">
            <option value="2">2x (up to 4K cap)</option>
            <option value="4">4x (4K max)</option>
          </select>
        </div>
        <div class="field">
          <label class="field-label">Keep Resolution</label>
          <select id="enhKeepRes" class="select">
            <option value="false">No — Expand pixels</option>
            <option value="true">Yes — Upscale &amp; downsample for crispness</option>
          </select>
        </div>
      </div>
      <button class="btn-primary" id="runEnhBtn" style="width:100%;">✨ Run Enhancer</button>
    </div>
  `;

  document.getElementById("runEnhBtn").onclick = async () => {
    try {
      const jobId = document.getElementById("enhSourceJob").value;
      const file = document.getElementById("enhUploadFile").files[0];
      const model = document.getElementById("enhModel").value;
      const scale = Number(document.getElementById("enhScale").value);
      let handle = null;
      let mediaType = model === "seedvr2-balanced" ? "video" : "image";
      if (file) {
        const up = await uploadBrowserFile(file);
        handle = up.handle;
        if (file.type.startsWith("video")) mediaType = "video";
      } else if (jobId) {
        const j = jobs.find((x) => x.jobId === jobId);
        mediaType = j.mediaType;
        if (j?.resultUrl && j.mediaType === "image") {
          const resp = await fetch(appUrl(j.resultUrl));
          const blob = await resp.blob();
          const up = await uploadBrowserFile(new File([blob], `${j.jobId}.png`, { type: blob.type || "image/png" }));
          handle = up.handle;
        }
      } else {
        return toast("Select a Gallery item or upload a file first.", true);
      }
      await api("/generate", {
        method: "POST",
        body: {
          presetId: model,
          packId: "enhancer-pack",
          mediaType: model === "rtx-upscaler" ? "image" : mediaType,
          prompt: `Enhanced ${scale}x render`,
          image: handle || undefined,
          options: { resolution: scale >= 4 ? "4K" : "1080p", scale },
        },
      });
      uiState.queueOpen = true;
      toast("Enhancer job queued!");
      await refreshAll();
    } catch (err) {
      toast(err.message, true);
    }
  };
}

export function renderPresetStore(stage, refreshAll) {
  const packs = uiState.bootstrap?.packs || [];
  stage.innerHTML = `
    <div class="page-header">
      <div>
        <p class="eyebrow">Preset Store</p>
        <h1 class="page-title">Curated Model &amp; Workflow Packs</h1>
        <p class="page-sub">Each pack bundles weights, prompt tuning, and GPU compatibility checks. Uninstalling a pack keeps shared model files safe.</p>
      </div>
      <button class="btn-primary btn-sm" id="updateAllPacksBtn">↻ Update All Packs</button>
    </div>
    <div class="grid-3">
      ${packs.map((p) => `
        <div class="card-elevated" style="display:flex; flex-direction:column; justify-content:space-between; gap:14px;">
          <div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
              <span class="tag">${esc(p.version)}</span>
              <span class="tag ${p.minVramGb <= 8 ? "green" : "amber"}">Min ${p.minVramGb} GB VRAM</span>
            </div>
            <h3 style="margin:0 0 6px; font-family:var(--font-display); font-size:18px;">${esc(p.name)}</h3>
            <p style="margin:0 0 10px; font-size:13px; color:var(--text-secondary); line-height:1.45;">${esc(p.description)}</p>
            <div style="display:flex; gap:5px; flex-wrap:wrap;">
              ${p.presets.map((pid) => `<span class="tag cyan">${esc(pid)}</span>`).join("")}
            </div>
          </div>
          <div>
            ${p.installed
              ? `<button class="btn-secondary btn-sm" data-uninstall-pack="${esc(p.packId)}" style="width:100%;">Installed (Uninstall)</button>`
              : `<button class="btn-primary btn-sm" data-install-pack="${esc(p.packId)}" style="width:100%;">+ Install Pack</button>`}
          </div>
        </div>
      `).join("")}
    </div>
  `;

  document.getElementById("updateAllPacksBtn").onclick = async () => {
    await api("/api/ui/packs/update-all", { method: "POST" });
    toast("All preset packs updated.");
    await refreshAll();
  };
  stage.querySelectorAll("[data-install-pack]").forEach((b) => {
    b.onclick = async () => {
      await api(`/api/ui/packs/${b.dataset.installPack}/install`, { method: "POST" });
      toast(`Installed ${b.dataset.installPack}`);
      await refreshAll();
    };
  });
  stage.querySelectorAll("[data-uninstall-pack]").forEach((b) => {
    b.onclick = async () => {
      await api(`/api/ui/packs/${b.dataset.uninstallPack}/uninstall`, { method: "POST" });
      toast(`Uninstalled ${b.dataset.uninstallPack} (orphaned weights marked External in Model Manager)`);
      await refreshAll();
    };
  });
}

export function renderModelManager(stage, refreshAll) {
  const models = uiState.bootstrap?.models || { totalUsedGb: 0, freeDiskGb: 0, modelsRoot: "models", files: [] };
  const loras = uiState.bootstrap?.loras || [];
  const byok = uiState.bootstrap?.byokKeys || {};
  const downloads = uiState.bootstrap?.downloads || [];
  const downloadablePresets = getCaps().filter((c) => !c.apiProvider && (c.requiredModels || []).length > 0 && !c.weightsOnDisk);

  stage.innerHTML = `
    <div class="page-header">
      <div>
        <p class="eyebrow">Real Disk Model Scanner &amp; HuggingFace Downloader</p>
        <h1 class="page-title">Disk Usage: ${models.totalUsedGb} GB used · ${models.freeDiskGb} GB free</h1>
        <p class="page-sub">Scanning <code>${esc(models.modelsRoot || "models")}</code> for <code>.safetensors</code>, <code>.gguf</code>, <code>.ckpt</code>, and <code>.pt</code> weights. Files marked <strong>External</strong> or <strong>Not in a model folder</strong> can be deleted to reclaim disk space.</p>
      </div>
    </div>

    ${downloads.length > 0 ? `
      <div class="card-elevated" style="margin-bottom:18px;">
        <h3 style="margin:0 0 10px; font-family:var(--font-display);">Active &amp; Recent Weight Downloads</h3>
        ${downloads.map((d) => `
          <div style="padding:8px 0; border-bottom:1px solid var(--border-subtle);">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; font-size:13px;">
              <strong>${esc(d.filename)}</strong>
              <span class="tag ${d.status === "completed" ? "green" : d.status === "failed" ? "amber" : "cyan"}">${esc(d.status)} · ${d.percent ?? 0}%${d.downloadedMb ? ` (${d.downloadedMb} MB)` : ""}${d.speedMbps ? ` · ${d.speedMbps} Mbps` : ""}</span>
            </div>
            ${d.status === "downloading" ? `<div class="progress-bar"><div class="progress-fill" style="width:${d.percent || 5}%;"></div></div>` : ""}
            ${d.error ? `<div style="color:#fda4af; font-size:12px; margin-top:4px;">${esc(d.error)}</div>` : ""}
          </div>
        `).join("")}
      </div>
    ` : ""}

    ${downloadablePresets.length > 0 ? `
      <div class="card" style="margin-bottom:18px;">
        <h3 style="margin:0 0 10px; font-family:var(--font-display);">Download Missing Preset Weights (HuggingFace)</h3>
        <div class="grid-3">
          ${downloadablePresets.map((c) => {
            const totalGb = (c.requiredModels || []).reduce((s, m) => s + (m.sizeGb || 0), 0).toFixed(1);
            return `
              <div style="border:1px solid var(--border-subtle); border-radius:12px; padding:12px; display:flex; flex-direction:column; justify-content:space-between; gap:8px; background:rgba(255,255,255,0.02);">
                <div>
                  <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; margin-bottom:4px;">
                    <span style="font-weight:700; font-size:13.5px; color:#fff;">${esc(c.name)}</span>
                    <span class="tag">${c.minVramGb} GB VRAM</span>
                  </div>
                  <div style="font-size:11.5px; color:var(--text-muted); margin-top:4px; line-height:1.4;">${(c.requiredModels || []).map((m) => esc(m.filename)).join(" + ")}</div>
                </div>
                <button class="btn-secondary btn-sm" data-dl-preset="${esc(c.presetId)}" data-dl-pack="${esc(c.packId)}">⬇ Download (${totalGb} GB)</button>
              </div>
            `;
          }).join("")}
        </div>
      </div>
    ` : ""}

    <div class="grid-2">
      <div class="card-elevated">
        <h3 style="margin:0 0 12px; font-family:var(--font-display);">Scanned Model Files on Disk (${models.files.length})</h3>
        ${models.files.length === 0 ? `<div style="font-size:13px; color:var(--text-secondary);">No .safetensors / .gguf weights found on disk yet. Download weights above or copy existing ComfyUI weights into <code>${esc(models.modelsRoot || "models")}</code>.</div>` : ""}
        ${models.files.map((f) => `
          <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; padding:10px 0; border-bottom:1px solid var(--border-subtle);">
            <div>
              <div style="font-weight:700; font-size:13px; color:#fff;">${esc(f.relativePath || f.filename)}</div>
              <div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:4px;">
                <span class="tag">${esc(f.folder)}/ · ${f.sizeGb > 0 ? `${f.sizeGb} GB` : `${f.sizeMb} MB`}</span>
                <span class="tag ${f.status === "Managed" ? "green" : f.status === "Corrupt / Incomplete" ? "red" : "amber"}">${esc(f.status)}</span>
                ${f.safetensors ? `<span class="tag purple">${f.safetensors.tensorCount} tensors${f.safetensors.baseModel && f.safetensors.baseModel !== "unknown" ? ` · ${esc(f.safetensors.baseModel)}` : ""}</span>` : ""}
                ${f.safetensors?.reason ? `<span class="tag amber">${esc(f.safetensors.reason)}</span>` : ""}
                ${f.usedByPresets.map((p) => `<span class="tag cyan">${esc(p)}</span>`).join("")}
              </div>
            </div>
            <button class="btn-danger btn-sm" data-del-model="${esc(f.relativePath || f.filename)}">Delete</button>
          </div>
        `).join("")}
      </div>

      <div class="card-elevated">
        <h3 style="margin:0 0 12px; font-family:var(--font-display);">LoRA Library on Disk (${loras.length})</h3>
        ${loras.length === 0 ? `<div style="font-size:13px; color:var(--text-secondary);">No .safetensors LoRAs in <code>models/loras/</code> yet.</div>` : ""}
        ${loras.map((l) => `
          <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid var(--border-subtle);">
            <div>
              <div style="font-weight:700; font-size:13.5px;">${esc(l.name)} <span class="tag purple">${esc(l.baseModel)}</span></div>
              <div style="font-size:12px; color:var(--text-secondary);">File: <code>${esc(l.filename)}</code> (${l.sizeMb} MB) · Trigger: <code>${esc(l.triggerWords || "none")}</code> · Strength ${l.defaultStrength}</div>
            </div>
            <button class="btn-danger btn-sm" data-del-lora="${esc(l.id)}">Remove</button>
          </div>
        `).join("")}

        <div style="margin-top:14px; padding-top:14px; border-top:1px solid var(--border-subtle);">
          <div style="font-weight:700; font-size:13px; margin-bottom:8px;">+ Install LoRA (Upload .safetensors or Download URL)</div>
          <div class="grid-2">
            <input id="newLoraName" class="input" placeholder="Display Name" />
            <select id="newLoraBase" class="select">
              <option value="z-image">z-image</option>
              <option value="flux-klein">flux-klein</option>
              <option value="krea-2">krea-2</option>
              <option value="flux">flux</option>
              <option value="sdxl">sdxl</option>
              <option value="wan-2.2">wan-2.2</option>
              <option value="ltx-2">ltx-2</option>
            </select>
          </div>
          <div class="grid-2" style="margin-top:8px;">
            <input id="newLoraTrigger" class="input" placeholder="Trigger words (optional)" />
            <input id="newLoraUrl" class="input" placeholder="HuggingFace / Civitai URL (optional)" />
          </div>
          <div style="display:flex; gap:8px; align-items:center; margin-top:8px; flex-wrap:wrap;">
            <input id="newLoraFile" type="file" accept=".safetensors,.pt,.ckpt" class="input" style="flex:1; padding:6px;" />
            <button id="saveLoraBtn" class="btn-primary btn-sm">Install LoRA</button>
          </div>
        </div>

        <div style="margin-top:18px; padding-top:14px; border-top:1px solid var(--border-subtle);">
          <div style="font-weight:700; font-size:13px; margin-bottom:8px;">Download Tokens &amp; BYOK API Keys</div>
          <div class="grid-2">
            <input id="hfKeyInput" type="password" class="input" placeholder="${byok.huggingface ? "HuggingFace Token saved" : "HuggingFace Read Token (hf_...)"}" />
            <input id="civitaiKeyInput" type="password" class="input" placeholder="${byok.civitai ? "Civitai Key saved" : "Civitai API Key"}" />
            <input id="googleKeyInput" type="password" class="input" placeholder="${byok.google ? "Google AI Studio Key saved" : "Google Gemini/Veo Key"}" />
            <input id="openaiKeyInput" type="password" class="input" placeholder="${byok.openai ? "OpenAI Key saved" : "OpenAI GPT-Image Key"}" />
          </div>
          <button id="saveKeysBtn" class="btn-secondary btn-sm" style="margin-top:8px;">Save API Keys</button>
        </div>
      </div>
    </div>
  `;

  stage.querySelectorAll("[data-dl-preset]").forEach((b) => {
    b.onclick = async () => {
      try {
        const r = await api("/api/ui/models/download", {
          method: "POST",
          body: { presetId: b.dataset.dlPreset, packId: b.dataset.dlPack },
        });
        toast(r.status === "started" ? `Downloading: ${(r.downloading || []).join(", ")}` : "Weights already present.");
        await refreshAll();
      } catch (err) { toast(err.message, true); }
    };
  });
  stage.querySelectorAll("[data-del-model]").forEach((b) => {
    b.onclick = async () => {
      const r = await api(`/api/ui/models/${encodeURIComponent(b.dataset.delModel)}`, { method: "DELETE" });
      toast(`Deleted ${r.deleted} (reclaimed ${r.reclaimedGb} GB)`);
      await refreshAll();
    };
  });
  stage.querySelectorAll("[data-del-lora]").forEach((b) => {
    b.onclick = async () => {
      await api(`/loras/${encodeURIComponent(b.dataset.delLora)}`, { method: "DELETE" });
      toast("LoRA removed.");
      await refreshAll();
    };
  });
  document.getElementById("saveLoraBtn").onclick = async () => {
    const name = document.getElementById("newLoraName").value.trim();
    const baseModel = document.getElementById("newLoraBase").value;
    const triggerWords = document.getElementById("newLoraTrigger").value.trim();
    const url = document.getElementById("newLoraUrl")?.value.trim() || "";
    const fileInput = document.getElementById("newLoraFile");
    if (!name) return toast("Enter a LoRA name", true);
    try {
      let uploadHandle = "";
      let filename = "";
      if (fileInput?.files?.[0]) {
        const up = await uploadBrowserFile(fileInput.files[0]);
        uploadHandle = up.handle;
        filename = fileInput.files[0].name;
      }
      await api("/loras", { method: "POST", body: { name, filename, baseModel, triggerWords, url, uploadHandle } });
      toast(`Installed LoRA "${name}"`);
      await refreshAll();
    } catch (err) { toast(err.message, true); }
  };
  document.getElementById("saveKeysBtn").onclick = async () => {
    const patch = {};
    const hf = document.getElementById("hfKeyInput").value.trim();
    const civ = document.getElementById("civitaiKeyInput").value.trim();
    const g = document.getElementById("googleKeyInput").value.trim();
    const o = document.getElementById("openaiKeyInput").value.trim();
    if (hf) patch.huggingface = hf;
    if (civ) patch.civitai = civ;
    if (g) patch.google = g;
    if (o) patch.openai = o;
    await api("/api/ui/settings", { method: "POST", body: { byokKeys: patch } });
    toast("Keys saved locally.");
    await refreshAll();
  };
}
