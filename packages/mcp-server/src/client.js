// packages/mcp-server/src/client.js
// HTTP Control API client for SimpleTun (compatible with SimpliGen Control API).
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { resolveUserDataDir, readDiscoveryPort } from "./userdata.js";

export class ControlApiError extends Error {
  constructor(status, errorCode, message) {
    super(message || errorCode || `HTTP ${status}`);
    this.name = "ControlApiError";
    this.status = status;
    this.errorCode = errorCode || null;
  }
}

export const LONG_REQUEST_TIMEOUT_MS = 21 * 60 * 1000;

export class ControlApiClient {
  constructor(opts = {}) {
    const env = opts.env || process.env;
    this.token = opts.token || env.SIMPLETUN_TOKEN || env.SIMPLIGEN_TOKEN || null;
    this.fetch = opts.fetchImpl || globalThis.fetch;
    if (opts.baseUrl) {
      this.baseUrl = opts.baseUrl;
    } else {
      const envPort = env.SIMPLETUN_API_PORT || env.SIMPLIGEN_API_PORT;
      const port = opts.port || (envPort ? Number(envPort) : readDiscoveryPort(resolveUserDataDir(env)));
      this.baseUrl = port ? `http://127.0.0.1:${port}` : null;
    }
  }

  async #req(method, p, body) {
    this.#ready();
    const res = await this.fetch(`${this.baseUrl}${p}`, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    let json = {};
    try {
      json = await res.json();
    } catch {
      // empty body
    }
    if (!res.ok) throw new ControlApiError(res.status, json.errorCode, json.message);
    return json;
  }

  #ready() {
    if (!this.baseUrl) {
      throw new ControlApiError(0, "app_not_running", "SimpleTun is not running (no control-API port found). Start SimpleTun.");
    }
    if (!this.token) {
      throw new ControlApiError(0, "missing_token", "No pairing token. Set SIMPLETUN_TOKEN (or SIMPLIGEN_TOKEN).");
    }
  }

  #longReq(method, p, body) {
    this.#ready();
    const data = body !== undefined ? JSON.stringify(body) : null;
    return new Promise((resolve, reject) => {
      const req = http.request(
        new URL(p, this.baseUrl),
        {
          method,
          headers: {
            Authorization: `Bearer ${this.token}`,
            "Content-Type": "application/json",
            ...(data !== null ? { "Content-Length": Buffer.byteLength(data) } : {}),
          },
          timeout: LONG_REQUEST_TIMEOUT_MS,
        },
        (res) => {
          let raw = "";
          res.setEncoding("utf8");
          res.on("data", (c) => { raw += c; });
          res.on("error", reject);
          res.on("end", () => {
            let json = {};
            try { json = raw ? JSON.parse(raw) : {}; } catch { /* ignore */ }
            if (res.statusCode < 200 || res.statusCode >= 300) {
              reject(new ControlApiError(res.statusCode, json.errorCode, json.message));
            } else {
              resolve(json);
            }
          });
        }
      );
      req.on("timeout", () => req.destroy(new ControlApiError(0, "timeout", "SimpleTun did not answer in time.")));
      req.on("error", reject);
      if (data !== null) req.write(data);
      req.end();
    });
  }

  getCapabilities() { return this.#req("GET", "/capabilities"); }
  getStatus() { return this.#req("GET", "/status"); }
  startEngine() { return this.#req("POST", "/engine/start"); }
  stopEngine() { return this.#req("POST", "/engine/stop"); }
  restartEngine() { return this.#req("POST", "/engine/restart"); }
  listProjects() { return this.#req("GET", "/projects"); }
  createProject(name) { return this.#req("POST", "/projects", { name }); }
  listLoras() { return this.#req("GET", "/loras"); }
  getPromptGuide(presetId) { return this.#req("GET", `/prompt-guide/${encodeURIComponent(presetId)}`); }
  generate(args) { return this.#req("POST", "/generate", args); }
  waitForApproval(id, timeoutSeconds) { return this.#req("GET", `/approvals/${encodeURIComponent(id)}/wait?timeoutSeconds=${timeoutSeconds}`); }
  getAppContext() { return this.#req("GET", "/app/context"); }
  fillGenerateForm(body) { return this.#req("POST", "/app/generate-form", body); }
  openScreen(body) { return this.#req("POST", "/app/screen", body); }
  getJob(id) { return this.#req("GET", `/jobs/${encodeURIComponent(id)}`); }
  listJobs() { return this.#req("GET", "/jobs"); }
  cancelJob(id) { return this.#req("POST", `/jobs/${encodeURIComponent(id)}/cancel`, {}); }
  preparePreset(args) { return this.#req("POST", "/presets/prepare", args); }
  getActiveDownloads() { return this.#req("GET", "/presets/prepare"); }

  listCharacters() { return this.#req("GET", "/characters"); }
  getCharacter(id) { return this.#req("GET", `/characters/${encodeURIComponent(id)}`); }
  listCharacterFeatures() { return this.#req("GET", "/character-features"); }
  listCharacterPresets() { return this.#req("GET", "/character-presets"); }
  createCharacter(args) { return this.#req("POST", "/characters", args); }
  generateCharacterImage(id, args) { return this.#req("POST", `/characters/${encodeURIComponent(id)}/generate-image`, args); }
  generateCharacterFrame(id, args) { return this.#req("POST", `/characters/${encodeURIComponent(id)}/generate-frame`, args); }
  animateCharacter(id, args) { return this.#req("POST", `/characters/${encodeURIComponent(id)}/animate`, args); }
  acceptBase(id, args) { return this.#req("POST", `/characters/${encodeURIComponent(id)}/accept-base`, args); }
  setCharacterPreset(id, args) { return this.#req("POST", `/characters/${encodeURIComponent(id)}/preset`, args); }
  enhanceCharacterMedia(id, args) { return this.#req("POST", `/characters/${encodeURIComponent(id)}/enhance`, args); }
  regenerateCharacterBase(id, args) { return this.#req("POST", `/characters/${encodeURIComponent(id)}/regenerate-base`, args); }
  removeCharacter(id) { return this.#req("DELETE", `/characters/${encodeURIComponent(id)}`); }

  listRecipeBlocks() { return this.#req("GET", "/recipe-blocks"); }
  composeRecipe(args) { return this.#req("POST", "/recipes", args); }
  validateRecipe(args) { return this.#req("POST", "/recipes/validate", args); }
  listRecipes() { return this.#req("GET", "/recipes"); }
  getRecipe(id) { return this.#req("GET", `/recipes/${encodeURIComponent(id)}`); }
  publishRecipe(id, args) { return this.#req("POST", `/recipes/${encodeURIComponent(id)}/publish`, args); }
  runRecipe(id, args) { return this.#req("POST", `/recipes/${encodeURIComponent(id)}/run`, args); }
  listRecipeRuns(id) { return this.#req("GET", `/recipes/${encodeURIComponent(id)}/runs`); }
  getRecipeRun(runId) { return this.#req("GET", `/recipe-runs/${encodeURIComponent(runId)}`); }
  cancelRecipeRun(runId) { return this.#req("POST", `/recipe-runs/${encodeURIComponent(runId)}/cancel`, {}); }
  listSubjects() { return this.#req("GET", "/subjects"); }
  listProducts() { return this.#req("GET", "/products"); }
  createProduct(args) { return this.#req("POST", "/products", args); }
  removeProduct(id) { return this.#req("DELETE", `/products/${encodeURIComponent(id)}`); }

  #film(filmId, rest = "") { return `/films/${encodeURIComponent(filmId)}${rest}`; }
  #clip(filmId, clip, rest = "") { return this.#film(filmId, `/clips/${encodeURIComponent(String(clip))}${rest}`); }
  listFilms(projectId) { return this.#req("GET", `/films${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`); }
  createFilm(args) { return this.#req("POST", "/films", args); }
  getFilm(filmId) { return this.#req("GET", this.#film(filmId)); }
  updateFilmSettings(filmId, args) { return this.#req("PATCH", this.#film(filmId), args); }
  addTrack(filmId, args) { return this.#req("POST", this.#film(filmId, "/tracks"), args); }
  moveTrack(filmId, track, args) { return this.#req("PATCH", this.#film(filmId, `/tracks/${encodeURIComponent(String(track))}`), args); }
  detectTempo(filmId, args = {}) { return this.#req("POST", this.#film(filmId, "/tempo"), args); }
  addClip(filmId, args = {}) { return this.#req("POST", this.#film(filmId, "/clips"), args); }
  importClip(filmId, args = {}) { return this.#req("POST", this.#film(filmId, "/clips/import"), args); }
  updateClip(filmId, clip, args) { return this.#req("PATCH", this.#clip(filmId, clip), args); }
  moveClip(filmId, clip, args) { return this.#req("POST", this.#clip(filmId, clip, "/move"), args); }
  trimClip(filmId, clip, args) { return this.#req("POST", this.#clip(filmId, clip, "/trim"), args); }
  removeClip(filmId, clip) { return this.#req("DELETE", this.#clip(filmId, clip)); }
  applyFilmPlan(filmId, plan) { return this.#req("POST", this.#film(filmId, "/plan"), plan); }
  setFades(filmId, args) { return this.#req("POST", this.#film(filmId, "/fades"), args); }
  addMarker(filmId, args) { return this.#req("POST", this.#film(filmId, "/markers"), args); }
  setExportRange(filmId, args) { return this.#req("POST", this.#film(filmId, "/export-range"), args); }
  renderClips(filmId, args = {}) { return this.#req("POST", this.#film(filmId, "/renders"), args); }
  listTakes(filmId, clip) { return this.#req("GET", this.#clip(filmId, clip, "/takes")); }
  useTake(filmId, clip, generationId) { return this.#req("POST", this.#clip(filmId, clip, "/take"), { generationId }); }
  exportFilm(filmId) { return this.#longReq("POST", this.#film(filmId, "/export"), {}); }
  listLocations() { return this.#req("GET", "/locations"); }
  createLocation(args) { return this.#req("POST", "/locations", args); }

  async uploadFile(filePath) {
    let buf;
    try {
      buf = fs.readFileSync(filePath);
    } catch (e) {
      throw new ControlApiError(0, "file_not_found", `Cannot read file to upload: ${filePath} (${e.code || e.message}).`);
    }
    return this.#req("POST", "/uploads", { filename: path.basename(filePath), dataBase64: buf.toString("base64") });
  }
}
