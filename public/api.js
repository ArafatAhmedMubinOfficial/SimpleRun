// public/api.js
// Shared API client, UI state store, toast notifications, and modal helpers.

export const uiState = {
  mode: "studio", // studio | video-studio | landing | gpu-check | docs | rea
  screen: "generate",
  wizardStep: 1,
  mediaCategory: "image", // image | image-edit | t2v | i2v
  selectedPackFilter: "all",
  selectedPresetId: "z-image-turbo",
  selectedCharacterId: null,
  selectedFilmId: null,
  selectedClipId: null,
  selectedRecipeId: "product-180-reveal",
  gpuAnswers: { os: "windows", brand: "nvidia", series: "rtx30_40_50", vram: "12" },
  docsSection: "getting-started",
  queueOpen: false,
  bootstrap: null,
  activeFilmTimeline: null,
  form: {
    prompt: "a red fox standing in fresh pine forest snow, crisp morning rim light, 50mm lens",
    negativePrompt: "",
    aspectRatio: "16:9",
    resolution: "720p",
    durationSeconds: 4,
    steps: 8,
    cfg: 2.0,
    denoise: 0.72,
    high_steps: 10,
    low_steps: 10,
    shift: 5.0,
    seed: "",
    count: 1,
    loras: [],
    imageHandle: null,
    videoHandle: null,
    audioHandle: null,
  },
};

export const BASE_PATH = (() => {
  const clean = window.location.pathname.replace(/\/(landing|gpu-check|docs|pricing|video-studio)\/?$/, "/");
  return clean.endsWith("/") ? clean.slice(0, -1) : clean;
})();

export function appUrl(p) {
  if (!p) return "";
  if (/^https?:\/\//i.test(p) || p.startsWith("data:") || p.startsWith("blob:")) return p;
  return p.startsWith("/") ? `${BASE_PATH}${p}` : `${BASE_PATH}/${p}`;
}

export async function api(path, opts = {}) {
  const res = await fetch(appUrl(path), {
    method: opts.method || "GET",
    headers: {
      "Content-Type": "application/json",
      "X-SimpleTun-UI": "1",
      ...(opts.headers || {}),
    },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  let json = {};
  try {
    json = await res.json();
  } catch {
    // ignore
  }
  if (!res.ok) {
    const err = new Error(json.message || json.errorCode || `HTTP ${res.status}`);
    err.errorCode = json.errorCode;
    err.details = json.details;
    throw err;
  }
  return json;
}

export async function uploadBrowserFile(file) {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  const dataBase64 = btoa(binary);
  return api("/uploads", {
    method: "POST",
    body: { filename: file.name, dataBase64 },
  });
}

export function toast(msg, isError = false) {
  const wrap = document.getElementById("toastWrap");
  if (!wrap) return;
  const el = document.createElement("div");
  el.className = "toast";
  el.style.borderColor = isError ? "rgba(251,113,133,0.6)" : "rgba(35,184,229,0.5)";
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

export function openModal(html) {
  const backdrop = document.getElementById("modalBackdrop");
  const box = document.getElementById("modalBox");
  box.innerHTML = html;
  backdrop.classList.add("open");
}

export function closeModal() {
  document.getElementById("modalBackdrop")?.classList.remove("open");
}

export function esc(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
