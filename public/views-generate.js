// public/views-generate.js
// Prompt Builder (3-step wizard), Character Studio, Enhancer, Gallery, Preset Store, Model Manager.

import { uiState, api, uploadBrowserFile, toast, openModal, closeModal, esc } from "./api.js";

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
          return `
            <div class="preset-card ${isSel ? "selected" : ""}" data-preset="${esc(p.presetId)}">
              <div>
                <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:8px;">
                  <span class="tag">${esc(p.packId)}</span>
                  ${p.apiProvider ? `<span class="tag amber">BYOK · ${esc(p.apiProvider)}</span>` : vramFit ? `<span class="tag green">✓ Fits your GPU</span>` : `<span class="tag amber">Use Cloud</span>`}
                </div>
                <div style="font-family:var(--font-display); font-size:17px; font-weight:700; color:#fff; margin-bottom:6px;">${esc(p.name)}</div>
                <div style="font-size:13px; color:var(--text-secondary); line-height:1.45;">${esc(p.description)}</div>
              </div>
              <div style="display:flex; flex-wrap:wrap; gap:6px; padding-top:8px; border-top:1px solid var(--border-subtle);">
                ${p.weightsOnDisk ? `<span class="tag green">Weights Ready</span>` : p.apiProvider ? `<span class="tag amber">Remote API</span>` : `<span class="tag amber">Missing Weights</span>`}
                ${p.localReady && !p.apiProvider ? `<span class="tag green">Local Ready</span>` : ""}
                ${p.cloudEligible ? `<span class="tag cyan">Cloud · ${p.cloudCost} cr</span>` : ""}
                ${p.inputs.supportsLoras ? `<span class="tag purple">LoRAs</span>` : ""}
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
              <span style="font-weight:500; color:var(--text-muted);">Lead with subject &amp; lighting</span>
            </label>
            <textarea id="genPromptInput" class="textarea" placeholder="Describe subject, setting, camera angle, lighting...">${esc(uiState.form.prompt)}</textarea>
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
            <label class="field-label"><span>Negative Prompt (What to avoid)</span><span style="font-weight:500; color:var(--text-muted);">Appended to preset default</span></label>
            <input id="genNegInput" class="input" value="${esc(uiState.form.negativePrompt)}" placeholder="e.g. extra fingers, watermark, plastic skin" />
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

          <div style="display:flex; gap:10px; margin-top:18px; flex-wrap:wrap;">
            ${!selected.apiProvider ? `
              ${!selected.weightsOnDisk ? `<button class="btn-secondary" id="downloadPresetWeightsBtn">⬇ Download Model Weights (${esc((selected.requiredModels || []).map((m) => m.sizeGb).reduce((a, b) => a + b, 0).toFixed(1))} GB)</button>` : ""}
              <button class="btn-primary" id="runLocalGenBtn" style="flex:1;">⚡ Generate Local ($0)</button>
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
              <input type="range" id="cfgSlider" min="${selected.options.cfg.min}" max="${selected.options.cfg.max}" step="0.5" value="${uiState.form.cfg}" />
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
                <img src="${esc(c.base_image_url || "")}" alt="" style="width:44px; height:44px; border-radius:9px; object-fit:cover; background:#111;" />
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
                <img src="${esc(active.base_image_url || "")}" alt="${esc(active.name)}" style="width:96px; height:120px; border-radius:12px; object-fit:cover; border:1px solid var(--border-emphasis); background:#000;" />
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
                      ? `<video src="${esc(j.resultUrl)}" poster="${esc(j.posterUrl || "")}" controls muted playsinline class="media-thumb"></video>`
                      : `<img src="${esc(j.resultUrl)}" class="media-thumb" alt="${esc(j.prompt)}" />`}
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
  stage.innerHTML = `
    <div class="page-header">
      <div>
        <p class="eyebrow">Gallery</p>
        <h1 class="page-title">Finished Generations (${jobs.length})</h1>
        <p class="page-sub">Inspect full-resolution renders, copy seeds to refine, or send straight to the Enhancer.</p>
      </div>
    </div>
    ${jobs.length === 0 ? `<div class="card" style="padding:36px; text-align:center; color:var(--text-secondary);">No completed generations yet. Start one in the Prompt Builder!</div>` : `
      <div class="grid-3">
        ${jobs.map((j) => `
          <div class="card" style="padding:12px;">
            ${j.mediaType === "video"
              ? `<video src="${esc(j.resultUrl)}" poster="${esc(j.posterUrl || "")}" controls muted playsinline class="media-thumb"></video>`
              : `<img src="${esc(j.resultUrl)}" class="media-thumb" alt="${esc(j.prompt)}" style="cursor:pointer;" data-lightbox="${esc(j.jobId)}" />`}
            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px; gap:6px; flex-wrap:wrap;">
              <span class="tag cyan">${esc(j.presetId)}</span>
              <span class="tag">${esc(j.engineUsed || j.backend)}</span>
            </div>
            <div style="font-size:12.5px; color:var(--text-primary); margin-top:6px; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">${esc(j.prompt)}</div>
            <div style="display:flex; gap:6px; margin-top:10px; flex-wrap:wrap;">
              <button class="btn-secondary btn-sm" data-reuse-seed="${esc(j.seed)}">Seed: ${esc(j.seed)}</button>
              <a class="btn-secondary btn-sm" href="${esc(j.resultUrl)}" download style="text-decoration:none;">⬇ Save</a>
            </div>
          </div>
        `).join("")}
      </div>
    `}
  `;
  stage.querySelectorAll("[data-reuse-seed]").forEach((b) => {
    b.onclick = () => {
      uiState.form.seed = b.dataset.reuseSeed;
      uiState.screen = "generate";
      uiState.wizardStep = 3;
      toast(`Loaded seed ${b.dataset.reuseSeed} into Prompt Builder`);
      refreshAll();
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
        <img src="${esc(j.resultUrl)}" style="width:100%; border-radius:12px; display:block;" />
        <p style="color:var(--text-secondary); font-size:13px; margin-top:10px;"><strong>Prompt:</strong> ${esc(j.prompt)}</p>
        <p style="color:var(--text-muted); font-size:12px;"><strong>Execution Engine:</strong> <code>${esc(j.engineUsed || j.backend)}</code> · <strong>File:</strong> <code>${esc(j.resultPath)}</code></p>
      `);
      document.getElementById("closeLb").onclick = closeModal;
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
        // Generate an enhanced derivative
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
              <span class="tag ${d.status === "completed" ? "green" : d.status === "failed" ? "amber" : "cyan"}">${esc(d.status)} · ${d.percent ?? 0}%${d.speedMbps ? ` (${d.speedMbps} MB/s)` : ""}</span>
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
          ${downloadablePresets.slice(0, 6).map((c) => {
            const totalGb = (c.requiredModels || []).reduce((s, m) => s + (m.sizeGb || 0), 0).toFixed(1);
            return `
              <div style="border:1px solid var(--border-subtle); border-radius:10px; padding:10px; display:flex; flex-direction:column; justify-content:space-between; gap:8px;">
                <div>
                  <div style="font-weight:700; font-size:13px;">${esc(c.name)}</div>
                  <div style="font-size:11.5px; color:var(--text-muted); margin-top:4px;">${(c.requiredModels || []).map((m) => esc(m.filename)).join(" + ")}</div>
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
                <span class="tag ${f.status === "Managed" ? "green" : "amber"}">${esc(f.status)}</span>
                ${f.safetensors ? `<span class="tag purple">${f.safetensors.tensorCount} tensors${f.safetensors.baseModel && f.safetensors.baseModel !== "unknown" ? ` · ${esc(f.safetensors.baseModel)}` : ""}</span>` : ""}
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
              <option value="flux">flux</option>
              <option value="z-image">z-image</option>
              <option value="wan-2.2">wan-2.2</option>
              <option value="ltx-2">ltx-2</option>
              <option value="sdxl">sdxl</option>
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
