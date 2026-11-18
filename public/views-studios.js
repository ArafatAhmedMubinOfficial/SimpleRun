// public/views-studios.js
// Video Studio (Timeline, Tempo/Bars, Cast, Shots, Takes, Export, Undo/Redo),
// Product Studio, UGC Studio, Recipe Editor (Flows), and Connect Agent (MCP).

import { uiState, api, appUrl, uploadBrowserFile, toast, openModal, closeModal, esc, renderMediaPreview } from "./api.js";

export async function renderVideoStudio(stage, refreshAll) {
  const films = uiState.bootstrap?.films || [];
  const chars = uiState.bootstrap?.characters || [];
  const locs = uiState.bootstrap?.locations || [];

  if (!uiState.selectedFilmId && films.length > 0) {
    uiState.selectedFilmId = films[0].id;
  }

  let film = null;
  if (uiState.selectedFilmId) {
    try {
      film = await api(`/films/${encodeURIComponent(uiState.selectedFilmId)}`);
      uiState.activeFilmTimeline = film;
    } catch {
      uiState.selectedFilmId = null;
    }
  }

  const selectedClip = film?.clips?.find((c) => c.id === uiState.selectedClipId) || film?.clips?.[0] || null;
  if (selectedClip) uiState.selectedClipId = selectedClip.id;

  stage.innerHTML = `
    <div class="page-header">
      <div>
        <p class="eyebrow">Video Studio · Director Timeline</p>
        <h1 class="page-title">${film ? esc(film.name) : "Direct a whole AI film, shot by shot"}</h1>
        <p class="page-sub">Cast consistent characters &amp; locations across every shot, snap clips to song bars, switch takes, and export one finished MP4 film.</p>
      </div>
      <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
        ${films.length > 0 ? `
          <select id="filmPickSelect" class="select-pill">
            ${films.map((f) => `<option value="${esc(f.id)}" ${f.id === film?.id ? "selected" : ""}>${esc(f.name)} (${f.clipCount} clips)</option>`).join("")}
          </select>
        ` : ""}
        <button class="btn-secondary btn-sm" id="newFilmBtn">+ New Film</button>
        ${film ? `
          <button class="btn-secondary btn-sm" id="undoFilmBtn" ${film.canUndo ? "" : "disabled"}>↶ Undo (Ctrl+Z)</button>
          <button class="btn-secondary btn-sm" id="redoFilmBtn" ${film.canRedo ? "" : "disabled"}>↷ Redo</button>
          <button class="btn-secondary btn-sm" id="renderStaleBtn">⚡ Render Clips</button>
          <button class="btn-primary btn-sm" id="exportFilmBtn">🎞 Export Film</button>
        ` : ""}
      </div>
    </div>

    ${!film ? `
      <div class="card-elevated" style="text-align:center; padding:48px 24px;">
        <div style="font-size:40px; margin-bottom:10px;">🎬</div>
        <h3 style="margin:0 0 8px; font-family:var(--font-display);">Start your first Video Studio film</h3>
        <p style="color:var(--text-secondary); max-width:50ch; margin:0 auto 18px;">Create a film timeline, add a soundtrack for bar-locked cuts, assign your cast, and render every clip locally or in the cloud.</p>
        <button class="btn-primary" id="emptyCreateFilmBtn">+ Create First Film</button>
      </div>
    ` : `
      <div class="grid-3" style="margin-bottom:16px;">
        <div class="card">
          <div class="field-label" style="margin-bottom:8px;">Film Settings</div>
          <div style="display:flex; gap:6px; flex-wrap:wrap;">
            <span class="tag cyan">${esc(film.aspect)}</span>
            <span class="tag cyan">${esc(film.quality)}</span>
            <span class="tag">${esc(film.renderOn)}</span>
            <span class="tag ${film.tempo ? "green" : ""}">${film.tempo ? `${film.tempo.bpm} BPM` : "Seconds Ruler"}</span>
          </div>
          <div style="margin-top:10px; display:flex; gap:6px; flex-wrap:wrap;">
            <select id="filmAspectSel" class="select" style="width:92px; padding:5px;">
              ${["16:9", "9:16", "1:1"].map((a) => `<option value="${a}" ${film.aspect === a ? "selected" : ""}>${a}</option>`).join("")}
            </select>
            <select id="filmQualSel" class="select" style="width:92px; padding:5px;">
              ${["480p", "720p", "1080p"].map((q) => `<option value="${q}" ${film.quality === q ? "selected" : ""}>${q}</option>`).join("")}
            </select>
            <select id="filmRenderSel" class="select" style="width:96px; padding:5px;">
              ${["local", "cloud"].map((r) => `<option value="${r}" ${film.renderOn === r ? "selected" : ""}>${r}</option>`).join("")}
            </select>
          </div>
        </div>

        <div class="card">
          <div class="field-label" style="margin-bottom:8px;">
            <span>Film Cast &amp; Location</span>
            <button class="btn-secondary btn-sm" id="addLocationQuickBtn">+ Location</button>
          </div>
          <div style="font-size:12px; color:var(--text-secondary); margin-bottom:6px;">Cast inherited by clips (${film.cast.length}):</div>
          <div style="display:flex; gap:5px; flex-wrap:wrap; margin-bottom:8px;">
            ${chars.length === 0 ? `<span style="color:var(--text-muted); font-size:12px;">Create characters in Character Studio first</span>` : chars.map((c) => {
              const inCast = film.cast.includes(c.name);
              return `<button class="chip ${inCast ? "active" : ""}" data-toggle-cast="${esc(c.name)}" style="padding:3px 9px; font-size:11.5px;">@${esc(c.name)}</button>`;
            }).join("")}
          </div>
          <select id="filmLocationSel" class="select" style="padding:6px;">
            <option value="">-- No default location --</option>
            ${locs.map((l) => `<option value="${esc(l.name)}" ${film.location === l.name ? "selected" : ""}>📍 ${esc(l.name)}</option>`).join("")}
          </select>
        </div>

        <div class="card">
          <div class="field-label" style="margin-bottom:8px;">
            <span>Audio Track &amp; Tempo</span>
            ${film.tracks.length > 0 ? `<button class="btn-secondary btn-sm" id="detectTempoBtn">🥁 Detect Tempo</button>` : ""}
          </div>
          <div style="display:flex; gap:8px; align-items:center;">
            <input type="file" id="trackUploadFile" accept="audio/*" class="input" style="padding:6px; font-size:12px;" />
          </div>
          <div style="margin-top:8px; font-size:12px; color:var(--text-secondary);">
            ${film.tracks.length === 0 ? "Upload WAV/MP3 for bar-locked cuts &amp; lip-sync." : film.tracks.map((t) => `${esc(t.name)} (${esc(t.kind)})`).join(", ")}
          </div>
        </div>
      </div>

      <!-- Timeline View -->
      <div class="timeline-box" style="margin-bottom:18px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; flex-wrap:wrap; gap:8px;">
          <div style="font-weight:700; font-size:13.5px;">
            Timeline ${film.tempo ? `<span class="tag green" style="margin-left:8px;">Bars &amp; Beats · ${film.tempo.bpm} BPM</span>` : `<span class="tag" style="margin-left:8px;">Seconds Mode</span>`}
            ${film.rendersRunning ? `<span class="tag cyan" style="margin-left:8px;">Rendering clips...</span>` : ""}
          </div>
          <div style="display:flex; gap:8px;">
            <button class="btn-secondary btn-sm" id="addClipBtn">+ Add Clip</button>
            <button class="btn-secondary btn-sm" id="applyPlanModalBtn">📋 Apply Film Plan</button>
          </div>
        </div>

        <div class="timeline-ruler">
          ${Array.from({ length: 8 }, (_, i) => {
            const label = film.tempo ? `Bar ${i * 2 + 1}` : `${i * 4}s`;
            return `<div class="ruler-tick">${label}</div>`;
          }).join("")}
        </div>

        <div class="timeline-lane">
          ${film.clips.length === 0
            ? `<div style="color:var(--text-muted); font-size:12.5px; padding:10px;">No clips on timeline yet. Click "+ Add Clip" or "Apply Film Plan".</div>`
            : film.clips.map((c) => `
              <div class="clip-block ${selectedClip?.id === c.id ? "selected" : ""}" data-clip-id="${esc(c.id)}" style="flex:${Math.max(1, c.length)} 0 120px;">
                <div style="display:flex; justify-content:space-between; align-items:center; gap:6px;">
                  <span style="font-weight:700; font-size:12.5px; color:#fff;">#${c.number} ${esc(c.name)}</span>
                  <span class="tag ${c.take === "current" ? "green" : c.take === "rendering" ? "cyan" : "amber"}">${esc(c.take)}</span>
                </div>
                <div style="font-size:11px; color:var(--text-secondary); margin-top:4px;">
                  ${c.at}s · ${c.length}s ${c.bars ? `(${c.bars} bars)` : ""} · ${esc(c.link)}
                </div>
                <div style="font-size:11px; color:#cbd5e1; margin-top:3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                  ${esc(c.shots?.[0]?.prompt || "")}
                </div>
              </div>
            `).join("")}
        </div>

        ${film.tracks.map((t) => `
          <div class="timeline-lane" style="min-height:46px;">
            <div class="audio-block">
              <span>🎵 <strong>${esc(t.name)}</strong> <span class="tag purple">${esc(t.kind)}</span></span>
              <span style="color:var(--text-secondary);">Start: ${t.at}s · Vol ${Math.round((t.volume ?? 1) * 100)}%</span>
            </div>
          </div>
        `).join("")}
      </div>

      <!-- Clip Shot Editor + Preview -->
      <div class="grid-2">
        <div class="card-elevated">
          ${selectedClip ? `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
              <h3 style="margin:0; font-family:var(--font-display);">Clip #${selectedClip.number}: ${esc(selectedClip.name)}</h3>
              <button class="btn-danger btn-sm" id="removeClipBtn">Remove Clip</button>
            </div>
            <div class="grid-3">
              <div class="field">
                <label class="field-label">Length (sec)</label>
                <input id="clipLenInput" type="number" step="0.5" min="1" class="input" value="${selectedClip.length}" />
              </div>
              <div class="field">
                <label class="field-label">Link Mode</label>
                <select id="clipLinkSel" class="select">
                  <option value="fresh" ${selectedClip.link === "fresh" ? "selected" : ""}>fresh (new shot)</option>
                  <option value="continue" ${selectedClip.link === "continue" ? "selected" : ""}>continue (last frame)</option>
                  <option value="motion" ${selectedClip.link === "motion" ? "selected" : ""}>motion (LTX 2.5)</option>
                </select>
              </div>
              <div class="field">
                <label class="field-label">Framing</label>
                <select id="shotFramingSel" class="select">
                  ${["wide", "medium", "close-up", "extreme close-up"].map((fr) => `<option value="${fr}" ${selectedClip.shots?.[0]?.framing === fr ? "selected" : ""}>${fr}</option>`).join("")}
                </select>
              </div>
            </div>
            <div class="field">
              <label class="field-label">
                <span>Shot Prompt (use @Name to reference cast)</span>
                <span>${film.cast.map((n) => `<button type="button" class="chip mention-btn" data-mention="@${esc(n)}" style="padding:2px 6px; font-size:11px;">@${esc(n)}</button>`).join(" ")}</span>
              </label>
              <textarea id="shotPromptInput" class="textarea" style="min-height:74px;">${esc(selectedClip.shots?.[0]?.prompt || "")}</textarea>
            </div>
            <div class="grid-2">
              <div class="field">
                <label class="field-label">Spoken / Sung Line (Lip-Sync)</label>
                <input id="shotLineInput" class="input" value="${esc(selectedClip.shots?.[0]?.line || "")}" placeholder="Optional lyric or spoken dialogue" />
              </div>
              <div class="field">
                <label class="field-label">Speaker</label>
                <input id="shotSpeakerInput" class="input" value="${esc(selectedClip.shots?.[0]?.speaker || "")}" placeholder="Cast member name" />
              </div>
            </div>
            <div style="display:flex; gap:8px;">
              <button class="btn-primary btn-sm" id="saveClipBtn">Save Shot &amp; Timing</button>
              <button class="btn-secondary btn-sm" id="renderSingleClipBtn">⚡ Render This Clip</button>
            </div>

            ${selectedClip.takes?.length > 0 ? `
              <div style="margin-top:14px; border-top:1px solid var(--border-subtle); padding-top:10px;">
                <div style="font-size:12px; font-weight:700; color:var(--text-secondary); margin-bottom:6px;">Takes (${selectedClip.takes.length})</div>
                <div style="display:flex; gap:6px; flex-wrap:wrap;">
                  ${selectedClip.takes.map((t, i) => `
                    <button class="chip ${t.generationId === selectedClip.activeTakeId ? "active" : ""}" data-use-take="${esc(t.generationId)}">Take #${i + 1}</button>
                  `).join("")}
                </div>
              </div>
            ` : ""}
          ` : `<div style="color:var(--text-secondary);">Select a clip on the timeline to edit its shots.</div>`}
        </div>

        <div class="card-elevated">
          <h3 style="margin:0 0 12px; font-family:var(--font-display);">Monitor &amp; Exported Film</h3>
          ${film.lastExportUrl ? `
            <div style="margin-bottom:14px;">
              <span class="tag green" style="margin-bottom:6px;">Final Exported Film Ready</span>
              ${renderMediaPreview(film.lastExportUrl, { style: "aspect-ratio:16/9;" })}
              <div style="font-size:12px; color:var(--text-muted); margin-top:6px;">Saved to <code>${esc(film.lastExportPath)}</code></div>
            </div>
          ` : selectedClip?.resultUrl ? `
            <div>
              <span class="tag cyan" style="margin-bottom:6px;">Clip #${selectedClip.number} Active Take</span>
              ${renderMediaPreview(selectedClip.resultUrl, { poster: selectedClip.posterUrl, style: "aspect-ratio:16/9;" })}
            </div>
          ` : `
            <div style="aspect-ratio:16/9; border-radius:12px; background:#090b10; border:1px dashed var(--border-emphasis); display:flex; align-items:center; justify-content:center; color:var(--text-muted); font-size:13px;">
              Render clips to preview takes and export finished MP4 film
            </div>
          `}
        </div>
      </div>
    `}
  `;

  // Wire Film events
  const openNewFilmModal = async () => {
    const name = prompt("Film Title:", "Neon Rain Music Video");
    if (!name) return;
    const created = await api("/films", { method: "POST", body: { name, aspect: "16:9", quality: "720p", renderOn: "local" } });
    uiState.selectedFilmId = created.id;
    toast(`Created film "${created.name}"`);
    await refreshAll();
  };
  const nf1 = document.getElementById("newFilmBtn");
  const nf2 = document.getElementById("emptyCreateFilmBtn");
  if (nf1) nf1.onclick = openNewFilmModal;
  if (nf2) nf2.onclick = openNewFilmModal;

  const fSel = document.getElementById("filmPickSelect");
  if (fSel) fSel.onchange = () => { uiState.selectedFilmId = fSel.value; uiState.selectedClipId = null; renderVideoStudio(stage, refreshAll); };

  if (!film) return;

  document.getElementById("undoFilmBtn").onclick = async () => { await api(`/films/${film.id}/undo`, { method: "POST" }); renderVideoStudio(stage, refreshAll); };
  document.getElementById("redoFilmBtn").onclick = async () => { await api(`/films/${film.id}/redo`, { method: "POST" }); renderVideoStudio(stage, refreshAll); };

  document.getElementById("filmAspectSel").onchange = async (e) => { await api(`/films/${film.id}`, { method: "PATCH", body: { aspect: e.target.value } }); renderVideoStudio(stage, refreshAll); };
  document.getElementById("filmQualSel").onchange = async (e) => { await api(`/films/${film.id}`, { method: "PATCH", body: { quality: e.target.value } }); renderVideoStudio(stage, refreshAll); };
  document.getElementById("filmRenderSel").onchange = async (e) => { await api(`/films/${film.id}`, { method: "PATCH", body: { renderOn: e.target.value } }); renderVideoStudio(stage, refreshAll); };
  document.getElementById("filmLocationSel").onchange = async (e) => { await api(`/films/${film.id}`, { method: "PATCH", body: { location: e.target.value || null } }); renderVideoStudio(stage, refreshAll); };

  stage.querySelectorAll("[data-toggle-cast]").forEach((b) => {
    b.onclick = async () => {
      const name = b.dataset.toggleCast;
      const next = film.cast.includes(name) ? film.cast.filter((x) => x !== name) : [...film.cast, name];
      await api(`/films/${film.id}`, { method: "PATCH", body: { cast: next } });
      renderVideoStudio(stage, refreshAll);
    };
  });

  document.getElementById("addLocationQuickBtn").onclick = async () => {
    const locName = prompt("Location Name (e.g. Rooftop):", "Neon Rooftop");
    if (!locName) return;
    const j = await api("/generate", { method: "POST", body: { presetId: "z-image-turbo", mediaType: "image", prompt: `${locName}, wide architectural establishing shot` } });
    toast("Generating location picture...");
    setTimeout(async () => {
      await api("/locations", { method: "POST", body: { name: locName, description: locName, fromJob: j.jobId } });
      await api(`/films/${film.id}`, { method: "PATCH", body: { location: locName } });
      toast(`Saved location "${locName}"!`);
      await refreshAll();
    }, 350);
  };

  const trackInput = document.getElementById("trackUploadFile");
  trackInput.onchange = async () => {
    if (!trackInput.files[0]) return;
    const up = await uploadBrowserFile(trackInput.files[0]);
    await api(`/films/${film.id}/tracks`, { method: "POST", body: { upload: up.handle, name: trackInput.files[0].name, kind: "singing" } });
    toast(`Added track "${trackInput.files[0].name}"`);
    renderVideoStudio(stage, refreshAll);
  };
  const dtBtn = document.getElementById("detectTempoBtn");
  if (dtBtn) {
    dtBtn.onclick = async () => {
      const res = await api(`/films/${film.id}/tempo`, { method: "POST", body: {} });
      toast(`Detected tempo: ${res.bpm} BPM`);
      renderVideoStudio(stage, refreshAll);
    };
  }

  document.getElementById("addClipBtn").onclick = async () => {
    const res = await api(`/films/${film.id}/clips`, { method: "POST", body: { length: 4 } });
    uiState.selectedClipId = res.clipId;
    renderVideoStudio(stage, refreshAll);
  };

  document.getElementById("applyPlanModalBtn").onclick = () => {
    const sample = JSON.stringify({
      mode: "append",
      clips: [
        { seconds: 4, shots: [{ prompt: "Wide rooftop skyline at dusk, rain reflections", framing: "wide" }] },
        { seconds: 4, link: "continue", shots: [{ prompt: "Slow dolly-in across neon street", framing: "medium" }] },
      ],
    }, null, 2);
    openModal(`
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
        <h3 style="margin:0; font-family:var(--font-display);">Apply Atomic Film Plan</h3>
        <button class="btn-secondary btn-sm" id="closePlanModal">Close</button>
      </div>
      <textarea id="planJsonInput" class="textarea" style="min-height:200px; font-family:var(--font-mono); font-size:12px;">${esc(sample)}</textarea>
      <button class="btn-primary" id="submitPlanBtn" style="margin-top:10px; width:100%;">Validate &amp; Apply Plan</button>
    `);
    document.getElementById("closePlanModal").onclick = closeModal;
    document.getElementById("submitPlanBtn").onclick = async () => {
      try {
        const plan = JSON.parse(document.getElementById("planJsonInput").value);
        await api(`/films/${film.id}/plan`, { method: "POST", body: plan });
        closeModal();
        toast("Applied film plan!");
        renderVideoStudio(stage, refreshAll);
      } catch (err) {
        toast(err.details?.problems ? err.details.problems.join("; ") : err.message, true);
      }
    };
  };

  stage.querySelectorAll("[data-clip-id]").forEach((el) => {
    el.onclick = () => { uiState.selectedClipId = el.dataset.clipId; renderVideoStudio(stage, refreshAll); };
  });

  if (selectedClip) {
    stage.querySelectorAll(".mention-btn").forEach((b) => {
      b.onclick = () => {
        const area = document.getElementById("shotPromptInput");
        area.value = `${area.value} ${b.dataset.mention}`.trim();
      };
    });
    document.getElementById("saveClipBtn").onclick = async () => {
      const length = Number(document.getElementById("clipLenInput").value) || 4;
      const link = document.getElementById("clipLinkSel").value;
      const framing = document.getElementById("shotFramingSel").value;
      const prompt = document.getElementById("shotPromptInput").value;
      const line = document.getElementById("shotLineInput").value;
      const speaker = document.getElementById("shotSpeakerInput").value;
      await api(`/films/${film.id}/clips/${selectedClip.id}/trim`, { method: "POST", body: { length } });
      await api(`/films/${film.id}/clips/${selectedClip.id}`, {
        method: "PATCH",
        body: { link, shots: [{ prompt, seconds: length, framing, ...(line ? { line } : {}), ...(speaker ? { speaker } : {}) }] },
      });
      toast("Saved shot & timing.");
      renderVideoStudio(stage, refreshAll);
    };
    document.getElementById("renderSingleClipBtn").onclick = async () => {
      await api(`/films/${film.id}/renders`, { method: "POST", body: { clips: [selectedClip.id] } });
      toast("Rendering clip...");
      setTimeout(() => renderVideoStudio(stage, refreshAll), 350);
    };
    document.getElementById("removeClipBtn").onclick = async () => {
      await api(`/films/${film.id}/clips/${selectedClip.id}`, { method: "DELETE" });
      uiState.selectedClipId = null;
      toast("Clip removed (press Ctrl+Z to undo)");
      renderVideoStudio(stage, refreshAll);
    };
    stage.querySelectorAll("[data-use-take]").forEach((b) => {
      b.onclick = async () => {
        await api(`/films/${film.id}/clips/${selectedClip.id}/take`, { method: "POST", body: { generationId: b.dataset.useTake } });
        toast("Switched active take.");
        renderVideoStudio(stage, refreshAll);
      };
    });
  }

  document.getElementById("renderStaleBtn").onclick = async () => {
    try {
      const res = await api(`/films/${film.id}/renders`, { method: "POST", body: { clips: "stale" } });
      toast(res.started.length > 0 ? `Started rendering ${res.started.length} clip(s)...` : res.note);
      setTimeout(() => renderVideoStudio(stage, refreshAll), 450);
    } catch (err) {
      toast(err.message, true);
    }
  };

  document.getElementById("exportFilmBtn").onclick = async () => {
    try {
      const res = await api(`/films/${film.id}/export`, { method: "POST", body: {} });
      toast(`Film exported to ${res.path}`);
      renderVideoStudio(stage, refreshAll);
    } catch (err) {
      toast(err.message, true);
    }
  };
}

export function renderProductOrUgcStudio(stage, category, refreshAll) {
  const recipes = (uiState.bootstrap?.recipes || []).filter((r) => r.category === category);
  const products = uiState.bootstrap?.products || [];
  const characters = uiState.bootstrap?.characters || [];
  const title = category === "product" ? "Product Studio" : "UGC Studio";
  const sub = category === "product"
    ? "Turn one product photo into commercial reveals, splash ads, and clean hero shots."
    : "Cast your consistent character alongside your product in authentic creator-style video ads.";

  stage.innerHTML = `
    <div class="page-header">
      <div>
        <p class="eyebrow">${title}</p>
        <h1 class="page-title">${title} Recipes</h1>
        <p class="page-sub">${sub}</p>
      </div>
      <button class="btn-primary btn-sm" id="addProductModalBtn">+ Add Product</button>
    </div>

    <div class="card" style="margin-bottom:18px;">
      <div style="font-size:12px; font-weight:700; color:var(--text-muted); text-transform:uppercase; margin-bottom:10px;">Saved Products (${products.length})</div>
      ${products.length === 0 ? `<div style="font-size:13px; color:var(--text-secondary);">No products added yet. Add a product photo &amp; material description to run recipes.</div>` : `
        <div style="display:flex; gap:12px; flex-wrap:wrap;">
          ${products.map((p) => `
            <div style="display:flex; align-items:center; gap:10px; border:1px solid var(--border-subtle); padding:8px 12px; border-radius:12px;">
              <img src="${esc(appUrl(p.imageUrl))}" style="width:42px; height:42px; border-radius:8px; object-fit:cover;" />
              <div>
                <div style="font-weight:700; font-size:13px;">${esc(p.name)}</div>
                <div style="font-size:11.5px; color:var(--text-secondary);">${esc(p.description.slice(0, 40))}</div>
              </div>
              <button class="btn-danger btn-sm" data-del-prod="${esc(p.id)}">×</button>
            </div>
          `).join("")}
        </div>
      `}
    </div>

    <div class="grid-3">
      ${recipes.map((r) => `
        <div class="card-elevated" style="display:flex; flex-direction:column; justify-content:space-between; gap:12px;">
          <div>
            <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
              <span class="tag cyan">${r.steps.length} steps</span>
              <span class="tag green">${r.priceTokens ? `${r.priceTokens} cr` : "Free Recipe"}</span>
            </div>
            <h3 style="margin:0 0 6px; font-family:var(--font-display);">${esc(r.name)}</h3>
            <p style="margin:0; font-size:13px; color:var(--text-secondary); line-height:1.45;">${esc(r.description)}</p>
          </div>
          <button class="btn-primary btn-sm" data-run-studio-rec="${esc(r.id)}">Run Recipe →</button>
        </div>
      `).join("")}
    </div>
  `;

  document.getElementById("addProductModalBtn").onclick = () => {
    openModal(`
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <h3 style="margin:0; font-family:var(--font-display);">Add Product</h3>
        <button class="btn-secondary btn-sm" id="closeProdModal">Close</button>
      </div>
      <div class="field"><label class="field-label">Product Name</label><input id="prodName" class="input" value="Amber Glass Serum" /></div>
      <div class="field"><label class="field-label">Description (shape, material, color, exact label text)</label>
        <textarea id="prodDesc" class="textarea" style="min-height:70px;">Cylindrical amber glass dropper bottle with matte black cap and white label reading "GLOW SERUM"</textarea>
      </div>
      <div class="field"><label class="field-label">Product Photo (or leave empty to auto-generate sample photo)</label><input type="file" id="prodFile" accept="image/*" class="input" /></div>
      <button class="btn-primary" id="submitProdBtn" style="width:100%;">Save Product</button>
    `);
    document.getElementById("closeProdModal").onclick = closeModal;
    document.getElementById("submitProdBtn").onclick = async () => {
      try {
        const name = document.getElementById("prodName").value.trim();
        const description = document.getElementById("prodDesc").value.trim();
        const file = document.getElementById("prodFile").files[0];
        let handle = null;
        if (file) {
          handle = (await uploadBrowserFile(file)).handle;
        } else {
          // Create a tiny valid 1x1 PNG sample upload so demo works seamlessly even without choosing a file
          const samplePng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
          handle = (await api("/uploads", { method: "POST", body: { filename: "sample-product.png", dataBase64: samplePng } })).handle;
        }
        await api("/products", { method: "POST", body: { name, description, image: handle, category } });
        closeModal();
        toast(`Saved product "${name}"`);
        await refreshAll();
      } catch (err) {
        toast(err.message, true);
      }
    };
  };

  stage.querySelectorAll("[data-del-prod]").forEach((b) => {
    b.onclick = async () => { await api(`/products/${b.dataset.delProd}`, { method: "DELETE" }); await refreshAll(); };
  });

  stage.querySelectorAll("[data-run-studio-rec]").forEach((b) => {
    b.onclick = () => {
      const rec = recipes.find((x) => x.id === b.dataset.runStudioRec);
      if (!rec) return;
      openModal(`
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <h3 style="margin:0; font-family:var(--font-display);">Run: ${esc(rec.name)}</h3>
          <button class="btn-secondary btn-sm" id="closeRunRec">Close</button>
        </div>
        ${rec.inputs.map((inp) => {
          if (inp.kind === "subject") {
            const list = inp.key === "character" ? characters : products;
            return `<div class="field"><label class="field-label">${esc(inp.label || inp.key)}</label>
              <select class="select rec-in" data-key="${esc(inp.key)}">
                ${list.length === 0 ? `<option value="">-- Add a ${inp.key} first --</option>` : list.map((x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join("")}
              </select></div>`;
          }
          if (inp.kind === "select") {
            return `<div class="field"><label class="field-label">${esc(inp.label || inp.key)}</label>
              <select class="select rec-in" data-key="${esc(inp.key)}">${(inp.options || []).map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join("")}</select></div>`;
          }
          return `<div class="field"><label class="field-label">${esc(inp.label || inp.key)}</label><input class="input rec-in" data-key="${esc(inp.key)}" value="${esc(inp.default || "")}" /></div>`;
        }).join("")}
        <button class="btn-primary" id="execRecBtn" style="width:100%;">⚡ Execute Multi-Step Pipeline</button>
      `);
      document.getElementById("closeRunRec").onclick = closeModal;
      document.getElementById("execRecBtn").onclick = async () => {
        const inputs = {};
        document.querySelectorAll(".rec-in").forEach((el) => { inputs[el.dataset.key] = el.value; });
        const res = await api(`/recipes/${rec.id}/run`, { method: "POST", body: { inputs, engine: "local" } });
        closeModal();
        uiState.queueOpen = true;
        toast(`Recipe run ${res.runId} started (${res.steps.length} steps)!`);
        await refreshAll();
      };
    };
  });
}

export function renderRecipes(stage, refreshAll) {
  const recipes = uiState.bootstrap?.recipes || [];
  const caps = uiState.bootstrap?.capabilities || [];

  stage.innerHTML = `
    <div class="page-header">
      <div>
        <p class="eyebrow">Creator Recipe Editor</p>
        <h1 class="page-title">Compose &amp; Publish Multi-Step Flows</h1>
        <p class="page-sub">Chain presets into repeatable pipelines with auto-wired media ports, validate specs, and publish to the open marketplace.</p>
      </div>
    </div>

    <div class="grid-2">
      <div class="card-elevated">
        <h3 style="margin:0 0 12px; font-family:var(--font-display);">Compose New Recipe</h3>
        <div class="grid-2">
          <div class="field"><label class="field-label">Recipe Name</label><input id="compName" class="input" value="Product to Orbital Ad" /></div>
          <div class="field"><label class="field-label">Category</label>
            <select id="compCat" class="select"><option value="product">product</option><option value="ugc">ugc</option><option value="custom">custom</option></select>
          </div>
        </div>
        <div class="field">
          <label class="field-label">Step 1 Preset (Create / Edit Image)</label>
          <select id="compStep1" class="select">
            ${caps.filter((c) => c.mediaType === "image").map((c) => `<option value="${esc(c.packId)}:${esc(c.presetId)}">${esc(c.name)} (${esc(c.packId)})</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label class="field-label">Step 2 Preset (Video / Upscale)</label>
          <select id="compStep2" class="select">
            ${caps.filter((c) => c.mediaType === "video" || c.promptFamily === "no-prompt").map((c) => `<option value="${esc(c.packId)}:${esc(c.presetId)}">${esc(c.name)} (${esc(c.packId)})</option>`).join("")}
          </select>
        </div>
        <div style="display:flex; gap:8px;">
          <button class="btn-secondary" id="valRecipeBtn">Validate Spec</button>
          <button class="btn-primary" id="saveRecipeBtn" style="flex:1;">Compose &amp; Save Recipe</button>
        </div>
      </div>

      <div class="card-elevated">
        <h3 style="margin:0 0 12px; font-family:var(--font-display);">Installed &amp; Draft Recipes (${recipes.length})</h3>
        ${recipes.map((r) => `
          <div style="padding:10px 0; border-bottom:1px solid var(--border-subtle); display:flex; justify-content:space-between; align-items:center; gap:10px;">
            <div>
              <div style="font-weight:700;">${esc(r.name)} <span class="tag">${esc(r.category)}</span> ${r.published ? `<span class="tag green">Published</span>` : `<span class="tag amber">Draft</span>`}</div>
              <div style="font-size:12px; color:var(--text-secondary);">${r.steps.length} steps · v${esc(r.version)}</div>
            </div>
            <div style="display:flex; gap:6px;">
              ${!r.published ? `<button class="btn-secondary btn-sm" data-pub-rec="${esc(r.id)}">Publish</button>` : ""}
              <button class="btn-primary btn-sm" data-quick-run="${esc(r.id)}">Run</button>
            </div>
          </div>
        `).join("")}
      </div>
    </div>
  `;

  const buildSpec = () => ({
    name: document.getElementById("compName").value.trim(),
    category: document.getElementById("compCat").value,
    steps: [
      { preset: document.getElementById("compStep1").value },
      { preset: document.getElementById("compStep2").value },
    ],
  });

  document.getElementById("valRecipeBtn").onclick = async () => {
    const res = await api("/recipes/validate", { method: "POST", body: { spec: buildSpec() } });
    toast(res.validation.valid ? "✓ Spec is valid!" : res.validation.errors.join("; "), !res.validation.valid);
  };
  document.getElementById("saveRecipeBtn").onclick = async () => {
    const res = await api("/recipes", { method: "POST", body: { spec: buildSpec() } });
    toast(res.valid ? `Composed recipe ${res.recipeId}!` : res.errors.join("; "), !res.valid);
    await refreshAll();
  };
  stage.querySelectorAll("[data-pub-rec]").forEach((b) => {
    b.onclick = async () => {
      await api(`/recipes/${b.dataset.pubRec}/publish`, { method: "POST", body: { priceTokens: 0 } });
      toast("Published to open-source marketplace!");
      await refreshAll();
    };
  });
  stage.querySelectorAll("[data-quick-run]").forEach((b) => {
    b.onclick = async () => {
      const r = await api(`/recipes/${b.dataset.quickRun}/run`, { method: "POST", body: { inputs: {}, engine: "local" } });
      uiState.queueOpen = true;
      toast(`Started recipe run ${r.runId}`);
      await refreshAll();
    };
  });
}

export function renderAgentMcp(stage, refreshAll) {
  const tokens = uiState.bootstrap?.tokens || [];
  const port = location.port || "48199";
  const mcpPath = "packages/mcp-server/src/bin.js";
  const sampleJson = JSON.stringify({
    mcpServers: {
      simpletun: {
        command: "node",
        args: [mcpPath, "--port", String(port)],
        env: { SIMPLETUN_TOKEN: "st-agent-simpletun-open" },
      },
    },
  }, null, 2);

  stage.innerHTML = `
    <div class="page-header">
      <div>
        <p class="eyebrow">AI Agents &amp; Control API</p>
        <h1 class="page-title">Connect Claude, Cursor, Codex, or Gemini CLI</h1>
        <p class="page-sub">SimpleTun exposes 74 MCP tools via <code>@simpletun/mcp</code> backed by your local Loopback HTTP Control API (port ${esc(port)}).</p>
      </div>
    </div>

    <div class="grid-2">
      <div class="card-elevated">
        <h3 style="margin:0 0 10px; font-family:var(--font-display);">Pairing Tokens &amp; Spend Caps</h3>
        ${tokens.map((t) => `
          <div style="display:flex; justify-content:space-between; align-items:center; padding:9px 0; border-bottom:1px solid var(--border-subtle);">
            <div>
              <div style="font-weight:700; font-size:13px;">${esc(t.clientName)}</div>
              <div style="font-size:12px; color:var(--text-secondary);"><code>${esc(t.tokenPrefix)}</code> · Cap: ${t.spendCap === null ? "Unlimited" : t.spendCap === 0 ? "Local-Only (0)" : t.spendCap + " cr"} · Spent: ${t.spentCredits} cr</div>
            </div>
            ${t.id !== "tok_default" ? `<button class="btn-danger btn-sm" data-rev-tok="${esc(t.id)}">Revoke</button>` : `<span class="tag green">Default OSS</span>`}
          </div>
        `).join("")}

        <div style="margin-top:14px; display:flex; gap:8px;">
          <input id="newTokClient" class="input" placeholder="Client name (e.g. Claude Code)" />
          <input id="newTokCap" type="number" class="input" style="width:120px;" placeholder="Cap (blank=∞)" />
          <button id="mintTokBtn" class="btn-primary btn-sm">Mint Token</button>
        </div>
      </div>

      <div class="card-elevated">
        <h3 style="margin:0 0 10px; font-family:var(--font-display);">1-Click MCP Client Config</h3>
        <p style="font-size:13px; color:var(--text-secondary); margin-top:0;">Paste into <code>.mcp.json</code>, Claude Desktop, Cursor, Windsurf, or Zed:</p>
        <div class="code-pre">${esc(sampleJson)}</div>
        <h4 style="margin:14px 0 8px;">Direct curl Control API Example</h4>
        <div class="code-pre">curl -s http://127.0.0.1:${esc(port)}/capabilities -H "Authorization: Bearer st-agent-simpletun-open"</div>
      </div>
    </div>
  `;

  document.getElementById("mintTokBtn").onclick = async () => {
    const clientName = document.getElementById("newTokClient").value.trim() || "MCP Client";
    const spendCap = document.getElementById("newTokCap").value.trim();
    const r = await api("/api/ui/tokens", { method: "POST", body: { clientName, spendCap: spendCap === "" ? null : Number(spendCap) } });
    openModal(`
      <h3 style="margin-top:0; font-family:var(--font-display);">New Pairing Token Created</h3>
      <p style="color:var(--text-secondary); font-size:13.5px;">Copy this token now:</p>
      <div class="code-pre">${esc(r.token.token)}</div>
      <button class="btn-primary" id="closeTokModal" style="margin-top:12px;">Done</button>
    `);
    document.getElementById("closeTokModal").onclick = () => { closeModal(); refreshAll(); };
  };

  stage.querySelectorAll("[data-rev-tok]").forEach((b) => {
    b.onclick = async () => {
      await api(`/api/ui/tokens/${b.dataset.revTok}`, { method: "DELETE" });
      toast("Token revoked immediately.");
      await refreshAll();
    };
  });
}
