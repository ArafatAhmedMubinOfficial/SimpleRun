// public/app.js
// Main frontend router, bootstrapper, Queue Drawer, System Strip popovers, and Ctrl+Z binding.

import { uiState, api, appUrl, toast, openModal, closeModal, esc } from "./api.js";
import {
  renderPromptBuilder,
  renderCharacters,
  renderGallery,
  renderEnhance,
  renderPresetStore,
  renderModelManager,
} from "./views-generate.js";
import {
  renderVideoStudio,
  renderProductOrUgcStudio,
  renderRecipes,
  renderAgentMcp,
} from "./views-studios.js";
import {
  renderLandingPage,
  renderGpuCheck,
  renderDocs,
  renderReaForensics,
} from "./views-site.js";

function renderQueueDrawer() {
  const drawer = document.getElementById("queueDrawer");
  const contents = document.getElementById("queueContents");
  const badge = document.getElementById("queueBadge");
  if (!drawer || !contents) return;

  drawer.classList.toggle("open", uiState.queueOpen);
  const jobs = uiState.bootstrap?.jobs || [];
  const active = jobs.filter((j) => j.status === "queued" || j.status === "processing");
  const failed = jobs.filter((j) => j.status === "failed");
  const recent = jobs.filter((j) => j.status === "completed").slice(0, 10);

  if (badge) badge.textContent = String(active.length);

  const renderJobRow = (j) => `
    <div class="job-card">
      <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
        <span class="tag ${j.status === "completed" ? "green" : j.status === "failed" ? "amber" : "cyan"}">${esc(j.status)}</span>
        <span style="font-size:11.5px; color:var(--text-muted);">${esc(j.presetId)}${j.engineUsed ? ` · ${esc(j.engineUsed)}` : ""}</span>
      </div>
      <div style="font-size:12.5px; margin-top:6px; color:var(--text-primary);">${esc((j.prompt || "").slice(0, 80))}</div>
      ${j.status === "processing" || j.status === "queued" ? `
        <div class="progress-bar"><div class="progress-fill" style="width:${j.progress || 25}%;"></div></div>
        <button class="btn-danger btn-sm" data-cancel-job="${esc(j.jobId)}" style="margin-top:8px;">Cancel</button>
      ` : ""}
      ${j.status === "completed" && j.resultUrl ? `
        <div style="margin-top:8px;">
          ${j.mediaType === "video"
            ? `<video src="${esc(appUrl(j.resultUrl))}" poster="${esc(appUrl(j.posterUrl || ""))}" controls muted playsinline class="media-thumb"></video>`
            : `<img src="${esc(appUrl(j.resultUrl))}" class="media-thumb" alt="" />`}
        </div>
      ` : ""}
      ${j.errorMessage ? `<div style="color:#fda4af; font-size:12px; margin-top:6px;">${esc(j.errorMessage)}</div>` : ""}
    </div>
  `;

  contents.innerHTML = `
    <div style="margin-bottom:14px;">
      <div style="font-size:11.5px; font-weight:800; text-transform:uppercase; color:var(--brand-cyan); margin-bottom:8px;">Now Running &amp; Up Next (${active.length})</div>
      ${active.length === 0 ? `<div style="font-size:12.5px; color:var(--text-muted);">Queue is idle.</div>` : active.map(renderJobRow).join("")}
    </div>
    ${failed.length > 0 ? `
      <div style="margin-bottom:14px;">
        <div style="font-size:11.5px; font-weight:800; text-transform:uppercase; color:var(--amber); margin-bottom:8px;">Needs Attention (${failed.length})</div>
        ${failed.slice(0, 5).map(renderJobRow).join("")}
      </div>
    ` : ""}
    <div>
      <div style="font-size:11.5px; font-weight:800; text-transform:uppercase; color:var(--emerald); margin-bottom:8px;">Completed (${recent.length})</div>
      ${recent.length === 0 ? `<div style="font-size:12.5px; color:var(--text-muted);">Completed jobs appear here and in Gallery.</div>` : recent.map(renderJobRow).join("")}
    </div>
  `;

  contents.querySelectorAll("[data-cancel-job]").forEach((b) => {
    b.onclick = async () => {
      await api(`/jobs/${b.dataset.cancelJob}/cancel`, { method: "POST" });
      await refreshAll();
    };
  });
}

function updateChrome() {
  const b = uiState.bootstrap;
  if (!b) return;

  // Projects dropdown
  const projSel = document.getElementById("projectSelect");
  if (projSel) {
    projSel.innerHTML = b.projects
      .map((p) => `<option value="${esc(p.id)}" ${p.id === b.status.activeProject.id ? "selected" : ""}>📁 ${esc(p.name)}</option>`)
      .join("");
  }

  // Badges
  document.getElementById("charCountBadge").textContent = String(b.characters.length);
  document.getElementById("filmCountBadge").textContent = String(b.films.length);
  document.getElementById("galleryCountBadge").textContent = String(b.jobs.filter((j) => j.status === "completed").length);

  // Engine System Strip
  const dot = document.getElementById("engineDot");
  const est = document.getElementById("engineStatusText");
  const esub = document.getElementById("engineSubText");
  if (b.status.engineRunning) {
    dot.className = "dot green";
    est.textContent = "ComfyUI Live";
    est.style.color = "var(--emerald)";
    esub.textContent = b.status.gpuName ? `${b.status.gpuName} · ${b.status.vramGb}GB` : b.status.comfyUiUrl;
  } else if (b.status.engineInstalling) {
    dot.className = "dot cyan";
    est.textContent = "Installing Engine";
    est.style.color = "var(--brand-cyan)";
    esub.textContent = b.status.engineInstallStage || "ComfyUI + PyTorch";
  } else if (b.status.engineInstalled) {
    dot.className = "dot amber";
    est.textContent = "Engine Stopped";
    est.style.color = "var(--amber)";
    esub.textContent = b.status.gpuName ? `${b.status.gpuName} · Ready to start` : "ComfyUI Ready to start";
  } else {
    dot.className = "dot red";
    est.textContent = "Engine Missing";
    est.style.color = "var(--rose)";
    esub.textContent = b.status.gpuName ? `${b.status.gpuName} (${b.status.vramGb} GB)` : "Click to install ComfyUI";
  }

  // Cloud System Strip
  const cDot = document.getElementById("cloudDot");
  const cBal = document.getElementById("creditBalanceText");
  cDot.className = b.status.cloudConnected ? "dot cyan" : "dot red";
  cBal.textContent = b.status.cloudConnected ? `${b.status.creditBalance} cr` : "Disconnected";

  // Nav active states
  document.querySelectorAll(".top-nav-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === uiState.mode);
  });
  document.querySelectorAll(".rail-item[data-screen]").forEach((btn) => {
    btn.classList.toggle("active", uiState.mode === "studio" && btn.dataset.screen === uiState.screen);
  });

  // Hide left rail when viewing full-width Website / GPU Check / Docs / REA pages
  const appBody = document.getElementById("appBody");
  const leftRail = document.getElementById("leftRail");
  const showRail = uiState.mode === "studio" || uiState.mode === "video-studio";
  leftRail.style.display = showRail ? "flex" : "none";
  appBody.style.gridTemplateColumns = showRail ? "" : "1fr";
}

function renderActiveStage() {
  const stage = document.getElementById("mainStage");
  if (!stage) return;
  updateChrome();
  renderQueueDrawer();

  if (uiState.mode === "landing") return renderLandingPage(stage, switchMode);
  if (uiState.mode === "gpu-check") return renderGpuCheck(stage, switchMode);
  if (uiState.mode === "docs") return renderDocs(stage);
  if (uiState.mode === "rea") return renderReaForensics(stage);
  if (uiState.mode === "video-studio") return renderVideoStudio(stage, refreshAll);

  switch (uiState.screen) {
    case "generate":
      return renderPromptBuilder(stage, refreshAll);
    case "characters":
      return renderCharacters(stage, refreshAll);
    case "video-studio":
      return renderVideoStudio(stage, refreshAll);
    case "product-studio":
      return renderProductOrUgcStudio(stage, "product", refreshAll);
    case "ugc-studio":
      return renderProductOrUgcStudio(stage, "ugc", refreshAll);
    case "recipes":
      return renderRecipes(stage, refreshAll);
    case "enhance":
      return renderEnhance(stage, refreshAll);
    case "gallery":
      return renderGallery(stage, refreshAll);
    case "preset-store":
      return renderPresetStore(stage, refreshAll);
    case "model-manager":
      return renderModelManager(stage, refreshAll);
    case "agent-mcp":
      return renderAgentMcp(stage, refreshAll);
    default:
      return renderPromptBuilder(stage, refreshAll);
  }
}

export async function switchMode(mode, screen = null) {
  uiState.mode = mode;
  if (screen) uiState.screen = screen;
  if (mode === "video-studio") uiState.screen = "video-studio";
  renderActiveStage();
}

export async function refreshAll() {
  uiState.bootstrap = await api("/api/ui/bootstrap");
  renderActiveStage();
}

function wireGlobalEvents() {
  document.getElementById("brandHomeBtn").onclick = () => switchMode("studio", "generate");

  document.querySelectorAll(".top-nav-btn").forEach((b) => {
    b.onclick = () => switchMode(b.dataset.mode);
  });

  document.querySelectorAll(".rail-item[data-screen]").forEach((b) => {
    b.onclick = () => switchMode("studio", b.dataset.screen);
  });

  document.getElementById("queueToggleBtn").onclick = () => {
    uiState.queueOpen = !uiState.queueOpen;
    renderQueueDrawer();
  };
  document.getElementById("closeQueueBtn").onclick = () => {
    uiState.queueOpen = false;
    renderQueueDrawer();
  };

  document.getElementById("newProjectBtn").onclick = async () => {
    const name = prompt("New Project Name:", "Campaign Assets");
    if (!name) return;
    await api("/projects", { method: "POST", body: { name } });
    toast(`Switched to project "${name}"`);
    await refreshAll();
  };

  // Engine Popover
  document.getElementById("engineSysCard").onclick = () => {
    const st = uiState.bootstrap?.status || {};
    const hw = uiState.bootstrap?.hardware || {};
    const eng = uiState.bootstrap?.engine || {};
    const settings = uiState.bootstrap?.settings || {};
    const logs = (eng.logs || []).slice(-18).join("\n");
    openModal(`
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
        <h3 style="margin:0; font-family:var(--font-display);">Real Local Engine &amp; ComfyUI Manager</h3>
        <button class="btn-secondary btn-sm" id="closeEngM">Close</button>
      </div>
      <div class="card" style="padding:12px; margin-bottom:12px; font-size:13px; color:var(--text-secondary);">
        <div><strong>Hardware:</strong> ${esc(hw.gpuName || st.gpuName || "Unknown")} (${hw.vramGb || st.vramGb || 0} GB VRAM · ${hw.cudaSupported ? `CUDA sm_${hw.computeCap || "?"}` : "No CUDA"} · RAM ${hw.totalRamGb || "?"} GB · Free Disk ${hw.freeDiskGb || "?"} GB)</div>
        <div style="margin-top:4px;"><strong>Engine:</strong> ${st.engineRunning ? `<span style="color:var(--emerald);">Running (${esc(st.engineVersion)})</span>` : st.engineInstalling ? `<span style="color:var(--brand-cyan);">Installing (${esc(st.engineInstallStage)})</span>` : st.engineInstalled ? "Installed (Stopped)" : "Not Installed"}</div>
      </div>
      <div style="display:flex; gap:8px; margin-bottom:14px; flex-wrap:wrap;">
        ${!st.engineInstalled ? `<button class="btn-primary btn-sm" id="engInstallBtn" ${st.engineInstalling ? "disabled" : ""}>⬇ ${st.engineInstalling ? "Installing ComfyUI..." : "Install ComfyUI + PyTorch Engine"}</button>` : ""}
        <button class="btn-primary btn-sm" id="engStartBtn">Start Engine</button>
        <button class="btn-secondary btn-sm" id="engRestartBtn">Restart Engine</button>
        <button class="btn-danger btn-sm" id="engStopBtn">Stop Engine (Free VRAM)</button>
        <button class="btn-secondary btn-sm" id="engModelsBtn">Model Manager</button>
      </div>
      <div class="field">
        <label class="field-label">ComfyUI Endpoint URL (local or attached external)</label>
        <input id="comfyUrlInput" class="input" value="${esc(st.comfyUiUrl || "http://127.0.0.1:8188")}" />
      </div>
      <div class="field">
        <label class="field-label">External ComfyUI Folder Path (optional, if already installed)</label>
        <input id="extComfyDirInput" class="input" value="${esc(eng.externalComfyDir || "")}" placeholder="e.g. C:\\ComfyUI_windows_portable\\ComfyUI" />
      </div>
      <label style="display:flex; align-items:center; gap:8px; font-size:13px; margin-bottom:12px; cursor:pointer;">
        <input type="checkbox" id="strictRealChk" ${settings.strictRealEngine ? "checked" : ""} />
        <span><strong>Strict Real Engine Mode</strong> (require live ComfyUI + weights on disk; disable procedural fallback)</span>
      </label>
      <div style="display:flex; gap:8px; margin-bottom:12px;">
        <button class="btn-secondary btn-sm" id="saveComfyUrlBtn">Save Settings &amp; Re-Probe</button>
        <button class="btn-secondary btn-sm" id="refreshLogsBtn">Refresh Logs</button>
      </div>
      ${logs ? `<pre class="code-pre" style="max-height:150px; overflow:auto; font-size:11px;">${esc(logs)}</pre>` : ""}
    `);
    document.getElementById("closeEngM").onclick = closeModal;
    const instBtn = document.getElementById("engInstallBtn");
    if (instBtn) {
      instBtn.onclick = async () => {
        try {
          await api("/api/ui/engine/install", { method: "POST" });
          toast("Started downloading ComfyUI & creating Python PyTorch venv...");
          await refreshAll();
          document.getElementById("engineSysCard").click();
        } catch (err) { toast(err.message, true); }
      };
    }
    document.getElementById("engStartBtn").onclick = async () => {
      try { await api("/engine/start", { method: "POST" }); closeModal(); await refreshAll(); }
      catch (err) { toast(err.message, true); }
    };
    document.getElementById("engRestartBtn").onclick = async () => {
      try { await api("/engine/restart", { method: "POST" }); closeModal(); await refreshAll(); }
      catch (err) { toast(err.message, true); }
    };
    document.getElementById("engStopBtn").onclick = async () => {
      try { await api("/engine/stop", { method: "POST" }); closeModal(); await refreshAll(); }
      catch (err) { toast(err.message, true); }
    };
    document.getElementById("engModelsBtn").onclick = () => { closeModal(); switchMode("studio", "model-manager"); };
    document.getElementById("refreshLogsBtn").onclick = async () => { await refreshAll(); document.getElementById("engineSysCard").click(); };
    document.getElementById("saveComfyUrlBtn").onclick = async () => {
      try {
        await api("/api/ui/settings", {
          method: "POST",
          body: {
            comfyUiUrl: document.getElementById("comfyUrlInput").value.trim(),
            externalComfyDir: document.getElementById("extComfyDirInput").value.trim(),
            settings: { strictRealEngine: document.getElementById("strictRealChk").checked },
          },
        });
        toast("Engine settings saved.");
        closeModal();
        await refreshAll();
      } catch (err) { toast(err.message, true); }
    };
  };

  // Cloud Popover
  document.getElementById("cloudSysCard").onclick = () => {
    const st = uiState.bootstrap?.status;
    openModal(`
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
        <h3 style="margin:0; font-family:var(--font-display);">Cloud Simulation &amp; Open Credits</h3>
        <button class="btn-secondary btn-sm" id="closeCloudM">Close</button>
      </div>
      <p style="color:var(--text-secondary); font-size:13.5px;">
        Status: <strong>${st.cloudConnected ? "Connected" : "Disconnected"}</strong> · Balance: <strong>${st.creditBalance} credits</strong>
      </p>
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button class="btn-primary btn-sm" id="topupBtn">+ Add 1,000 Free Test Credits</button>
        ${st.cloudConnected
          ? `<button class="btn-danger btn-sm" id="discCloudBtn">Disconnect Cloud</button>`
          : `<button class="btn-secondary btn-sm" id="connCloudBtn">Connect Cloud</button>`}
      </div>
    `);
    document.getElementById("closeCloudM").onclick = closeModal;
    document.getElementById("topupBtn").onclick = async () => { await api("/api/ui/cloud/topup", { method: "POST", body: { credits: 1000 } }); closeModal(); toast("Added 1,000 credits!"); await refreshAll(); };
    const dc = document.getElementById("discCloudBtn");
    if (dc) dc.onclick = async () => { await api("/api/ui/cloud/disconnect", { method: "POST" }); closeModal(); await refreshAll(); };
    const cc = document.getElementById("connCloudBtn");
    if (cc) cc.onclick = async () => { await api("/api/ui/cloud/connect", { method: "POST" }); closeModal(); await refreshAll(); };
  };

  document.getElementById("modalBackdrop").onclick = (e) => {
    if (e.target.id === "modalBackdrop") closeModal();
  };

  // Global Ctrl+Z / Ctrl+Y undo/redo for active Video Studio film
  window.addEventListener("keydown", async (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) {
      if ((uiState.mode === "video-studio" || uiState.screen === "video-studio") && uiState.selectedFilmId) {
        e.preventDefault();
        if (e.shiftKey) await api(`/films/${uiState.selectedFilmId}/redo`, { method: "POST" });
        else await api(`/films/${uiState.selectedFilmId}/undo`, { method: "POST" });
        toast(e.shiftKey ? "Redid film change" : "Undid film change");
        renderActiveStage();
      }
    }
  });
}

async function init() {
  wireGlobalEvents();
  const path = location.pathname;
  if (/(?:^|\/)landing\/?$/.test(path)) uiState.mode = "landing";
  else if (/(?:^|\/)gpu-check\/?$/.test(path)) uiState.mode = "gpu-check";
  else if (/(?:^|\/)docs\/?$/.test(path)) uiState.mode = "docs";
  else if (/(?:^|\/)video-studio\/?$/.test(path)) uiState.mode = "video-studio";

  await refreshAll();

  // Poll quietly when jobs, film renders, engine install, or weight downloads are active
  setInterval(async () => {
    const jobs = uiState.bootstrap?.jobs || [];
    const downloads = uiState.bootstrap?.downloads || [];
    const hasActiveJob = jobs.some((j) => j.status === "queued" || j.status === "processing");
    const hasActiveDownload = downloads.some((d) => d.status === "downloading");
    const hasActiveInstall = Boolean(uiState.bootstrap?.status?.engineInstalling);
    const hasActiveFilm = Boolean(uiState.activeFilmTimeline?.rendersRunning);
    if (hasActiveJob || hasActiveDownload || hasActiveInstall || hasActiveFilm) {
      await refreshAll();
    }
  }, 600);
}

init();
