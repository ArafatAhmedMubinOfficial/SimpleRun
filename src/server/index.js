// src/server/index.js
// SimpleTun HTTP Control API + Static Studio Server.
// Binds to loopback (127.0.0.1:48199 by default) and enforces DNS-rebinding Host checks
// and Bearer pairing token authentication matching the SimpliGen Control API contract.

import http from "node:http";
import dns from "node:dns";
import net from "node:net";
import fs from "node:fs";

try {
  dns.setDefaultResultOrder("ipv4first");
  if (typeof net.setDefaultAutoSelectFamilyAttemptTimeout === "function") {
    net.setDefaultAutoSelectFamilyAttemptTimeout(250);
  }
} catch {
  // ignore on older runtimes
}
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SimpleTunStore, ApiError } from "./state.js";
import {
  CHARACTER_FEATURES,
  CHARACTER_PRESETS,
  RECIPE_BLOCKS,
  GPU_COMPATIBILITY_LIST,
  getPromptGuideForPreset,
} from "./catalog.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..", "..");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const REA_DIR = path.join(ROOT_DIR, "rea-evidence");

const MAX_BODY_BYTES = 50 * 1024 * 1024; // 50 MB as documented in Control API spec

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
};

function extractHostname(hostHeader = "") {
  const host = String(hostHeader).toLowerCase().trim();
  if (!host) return "";
  return host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0];
}

function isLoopbackHost(hostHeader = "") {
  const hostname = extractHostname(hostHeader);
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]" || hostname === "::1";
}

function isAllowedHost(hostHeader = "", { allowRemoteHosts = false, allowedHosts = [] } = {}) {
  const hostname = extractHostname(hostHeader);
  if (!hostname) return false;
  if (isLoopbackHost(hostHeader)) return true;
  if (allowRemoteHosts) return true;
  return allowedHosts.some((entry) => {
    const clean = String(entry || "").toLowerCase().trim();
    if (!clean) return false;
    if (clean.startsWith("*.")) return hostname.endsWith(clean.slice(1));
    return hostname === clean;
  });
}

function resolveNetworkConfig(opts = {}) {
  const argv = process.argv.slice(2);
  const hasRemoteFlag = argv.includes("--remote") || argv.includes("--allow-remote");
  const hostArg = argv.find((a) => a.startsWith("--host="))?.slice("--host=".length);
  const envHost = process.env.SIMPLETUN_HOST || process.env.HOST;
  const host = opts.host || hostArg || envHost || (hasRemoteFlag ? "0.0.0.0" : "127.0.0.1");

  const envAllowed = (process.env.SIMPLETUN_ALLOWED_HOSTS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const allowedHosts = Array.isArray(opts.allowedHosts) ? opts.allowedHosts : envAllowed;

  const allowRemoteHosts =
    opts.allowRemoteHosts ??
    (hasRemoteFlag ||
      process.env.SIMPLETUN_ALLOW_REMOTE === "1" ||
      process.env.SIMPLETUN_ALLOW_REMOTE === "true" ||
      process.env.SIMPLETUN_ALLOW_ALL_HOSTS === "1" ||
      host === "0.0.0.0" ||
      host === "::");

  return { host, allowRemoteHosts, allowedHosts };
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new ApiError(413, "asset_too_large", "Request body exceeds 50 MB limit."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("error", reject);
    req.on("end", () => {
      if (chunks.length === 0) return resolve({});
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new ApiError(400, "invalid_json", "Body is not valid JSON."));
      }
    });
  });
}

function serveFileWithRange(req, res, filePath) {
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  const stat = fs.statSync(filePath);
  const range = req.headers.range;

  if (range) {
    const match = /bytes=(\d+)-(\d*)/.exec(range);
    if (match) {
      const start = Number(match[1]);
      const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": end - start + 1,
        "Content-Type": contentType,
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
      return;
    }
  }

  res.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": stat.size,
    "Accept-Ranges": "bytes",
  });
  fs.createReadStream(filePath).pipe(res);
}

function loadReaEvidenceSummary() {
  const result = {};
  for (const name of ["mcp-summary.json", "mcp-modules.json", "web-summary.json", "mcp-audit.json", "simpletun-self-audit.json"]) {
    const p = path.join(REA_DIR, name);
    if (fs.existsSync(p)) {
      try {
        result[name] = JSON.parse(fs.readFileSync(p, "utf8"));
      } catch {
        result[name] = null;
      }
    }
  }
  return result;
}

const PUBLIC_STATIC_FILES = new Set([
  "/styles.css",
  "/app.js",
  "/api.js",
  "/views-generate.js",
  "/views-studios.js",
  "/views-site.js",
]);

export function createSimpleTunServer({ rootDir = ROOT_DIR, allowRemoteHosts, allowedHosts } = {}) {
  const store = new SimpleTunStore(rootDir);
  const netCfg = resolveNetworkConfig({ allowRemoteHosts, allowedHosts });

  const server = http.createServer(async (req, res) => {
    try {
      // DNS-rebinding guard: reject non-loopback Host headers unless remote access is configured
      if (!isAllowedHost(req.headers.host, netCfg)) {
        return sendJson(res, 403, {
          errorCode: "forbidden_host",
          message:
            "Non-loopback Host header rejected. To access from a remote PC or cloud proxy, start with: npm run start:remote (or SIMPLETUN_ALLOW_REMOTE=1).",
        });
      }

      const safeHost = req.headers.host || "127.0.0.1";
      const url = new URL(req.url || "/", `http://${safeHost}`);
      let pathname = decodeURIComponent(url.pathname);
      // Support sub-path reverse proxies (e.g. /proxy/48199/...) even if they do not strip the prefix
      pathname = pathname.replace(/^\/proxy\/\d+(?=\/|$)/, "") || "/";
      const method = req.method || "GET";

      // Static frontend & media routes (no Bearer auth needed for browser UI assets)
      if (method === "GET" && (pathname === "/" || pathname === "/landing" || pathname === "/video-studio" || pathname === "/gpu-check" || pathname === "/docs" || pathname === "/pricing")) {
        return serveFileWithRange(req, res, path.join(PUBLIC_DIR, "index.html"));
      }
      if (method === "GET" && (PUBLIC_STATIC_FILES.has(pathname) || pathname.startsWith("/assets/"))) {
        const rel = pathname.replace(/^\/+/, "");
        const safePath = path.resolve(PUBLIC_DIR, rel);
        if (!safePath.startsWith(PUBLIC_DIR)) return sendJson(res, 403, { errorCode: "forbidden", message: "Forbidden" });
        return serveFileWithRange(req, res, safePath);
      }
      if (method === "GET" && pathname.startsWith("/media/outputs/")) {
        const fileName = path.basename(pathname);
        return serveFileWithRange(req, res, path.join(store.outputsDir, fileName));
      }
      if (method === "GET" && pathname.startsWith("/media/uploads/")) {
        const fileName = path.basename(pathname);
        return serveFileWithRange(req, res, path.join(store.uploadsDir, fileName));
      }

      // Unauthenticated liveness probe
      if (method === "GET" && pathname === "/health") {
        return sendJson(res, 200, { ok: true, name: "simpletun", compatibleWith: "simpligen", version: 1 });
      }

      // Authentication: Bearer token OR built-in local Studio UI header
      const authHeader = req.headers.authorization || "";
      const isUiRequest = req.headers["x-simpletun-ui"] === "1";
      let tokenEntry = null;
      if (authHeader.startsWith("Bearer ")) {
        const rawTok = authHeader.slice(7).trim();
        tokenEntry = store.validateToken(rawTok);
        if (!tokenEntry) {
          return sendJson(res, 401, { errorCode: "unauthorized", message: "Invalid pairing token." });
        }
        tokenEntry.lastUsedAt = new Date().toISOString();
      } else if (!isUiRequest) {
        return sendJson(res, 401, { errorCode: "unauthorized", message: "Missing Authorization: Bearer token." });
      }

      const body = method === "POST" || method === "PATCH" || method === "PUT" ? await readJsonBody(req) : {};

      // ---- Built-in UI Management Endpoints ----
      if (method === "GET" && pathname === "/api/ui/bootstrap") {
        return sendJson(res, 200, {
          status: await store.getStatus(),
          capabilities: store.getCapabilities(),
          packs: store.listPacks(),
          models: store.listModelFiles(),
          loras: store.listLoras(),
          tokens: store.listTokens(),
          projects: store.listProjects(),
          jobs: store.listJobs(),
          characters: store.listCharacters(),
          characterFeatures: CHARACTER_FEATURES,
          characterPresets: CHARACTER_PRESETS,
          products: store.listProducts(),
          locations: store.listLocations(),
          recipes: store.listRecipes(),
          films: store.listFilms(),
          gpuList: GPU_COMPATIBILITY_LIST,
          byokKeys: {
            google: Boolean(store.state.byokKeys.google),
            openai: Boolean(store.state.byokKeys.openai),
            huggingface: Boolean(store.state.byokKeys.huggingface),
            civitai: Boolean(store.state.byokKeys.civitai),
          },
          settings: store.state.settings,
          hardware: await store.getHardware(),
          downloads: store.downloadManager.listDownloads(),
          engine: {
            installed: store.engineManager.isInstalled(),
            installing: store.engineManager.installing,
            installStage: store.engineManager.installStage,
            comfyUiUrl: store.engineManager.comfyUrl,
            externalComfyDir: store.engineManager.externalComfyDir,
            logs: store.engineManager.logs.slice(-40),
          },
          reaEvidence: loadReaEvidenceSummary(),
        });
      }
      if (method === "GET" && pathname === "/api/ui/hardware") {
        const refresh = url.searchParams.get("refresh") === "1";
        return sendJson(res, 200, { hardware: await store.getHardware(refresh) });
      }
      if (method === "POST" && pathname === "/api/ui/engine/install") {
        return sendJson(res, 202, store.installLocalEngine());
      }
      if (method === "GET" && pathname === "/api/ui/engine/logs") {
        return sendJson(res, 200, {
          installed: store.engineManager.isInstalled(),
          installing: store.engineManager.installing,
          installStage: store.engineManager.installStage,
          logs: store.engineManager.logs.slice(-80),
        });
      }
      if (method === "POST" && pathname === "/api/ui/models/download") {
        const r = store.preparePreset({ ...body, downloadWeights: true });
        return sendJson(res, r.status === "started" ? 202 : 200, r);
      }
      if (method === "GET" && pathname === "/api/ui/rea-evidence") {
        return sendJson(res, 200, loadReaEvidenceSummary());
      }
      if (method === "POST" && pathname === "/api/ui/tokens") {
        return sendJson(res, 201, { token: store.createToken(body) });
      }
      if (method === "DELETE" && pathname.startsWith("/api/ui/tokens/")) {
        const id = pathname.split("/")[4];
        return sendJson(res, 200, store.revokeToken(id));
      }
      if (method === "POST" && pathname.startsWith("/api/ui/packs/") && pathname.endsWith("/install")) {
        const id = pathname.split("/")[4];
        return sendJson(res, 200, { pack: store.installPack(id) });
      }
      if (method === "POST" && pathname.startsWith("/api/ui/packs/") && pathname.endsWith("/uninstall")) {
        const id = pathname.split("/")[4];
        return sendJson(res, 200, { pack: store.uninstallPack(id) });
      }
      if (method === "POST" && pathname === "/api/ui/packs/update-all") {
        store.state.packs.forEach((p) => { p.updateAvailable = false; });
        store.save();
        return sendJson(res, 200, { packs: store.listPacks() });
      }
      if (method === "DELETE" && pathname.startsWith("/api/ui/models/")) {
        const filename = decodeURIComponent(pathname.slice("/api/ui/models/".length));
        return sendJson(res, 200, store.deleteModelFile(filename));
      }
      if (method === "POST" && pathname === "/api/ui/cloud/connect") {
        store.state.cloudConnected = true;
        store.save();
        return sendJson(res, 200, { cloudConnected: true, creditBalance: store.state.creditBalance });
      }
      if (method === "POST" && pathname === "/api/ui/cloud/disconnect") {
        store.state.cloudConnected = false;
        store.save();
        return sendJson(res, 200, { cloudConnected: false });
      }
      if (method === "POST" && pathname === "/api/ui/cloud/topup") {
        const amount = Math.max(100, Math.min(50000, Number(body.credits) || 1000));
        store.state.creditBalance += amount;
        store.save();
        return sendJson(res, 200, { creditBalance: store.state.creditBalance });
      }
      if (method === "POST" && pathname === "/api/ui/settings") {
        if (body.comfyUiUrl) {
          store.state.settings.comfyUiUrl = body.comfyUiUrl;
          store.engineManager.comfyUrl = body.comfyUiUrl;
          store.engineManager.workers = [];
        }
        if (typeof body.externalComfyDir === "string") {
          store.state.settings.externalComfyDir = body.externalComfyDir;
          store.engineManager.externalComfyDir = body.externalComfyDir;
        }
        if (body.modelsDir) {
          store.state.settings.modelsDir = body.modelsDir;
          store.engineManager.modelsDir = body.modelsDir;
        }
        if (body.byokKeys) store.state.byokKeys = { ...store.state.byokKeys, ...body.byokKeys };
        if (body.settings) {
          store.state.settings = { ...store.state.settings, ...body.settings };
          if (body.settings.comfyUiUrl) {
            store.engineManager.comfyUrl = body.settings.comfyUiUrl;
            store.engineManager.workers = [];
          }
          if (typeof body.settings.externalComfyDir === "string") store.engineManager.externalComfyDir = body.settings.externalComfyDir;
          if (body.settings.modelsDir) store.engineManager.modelsDir = body.settings.modelsDir;
        }
        store.save();
        return sendJson(res, 200, { ok: true, settings: store.state.settings });
      }

      // ---- Core Control API ----
      if (method === "GET" && pathname === "/capabilities") {
        return sendJson(res, 200, { capabilities: store.getCapabilities() });
      }
      if (method === "GET" && pathname === "/status") {
        return sendJson(res, 200, await store.getStatus());
      }
      if (method === "POST" && pathname === "/engine/start") {
        const r = await store.startEngine();
        return sendJson(res, r.engineStarting && !r.engineRunning ? 202 : 200, r);
      }
      if (method === "POST" && pathname === "/engine/stop") {
        return sendJson(res, 200, await store.stopEngine());
      }
      if (method === "POST" && pathname === "/engine/restart") {
        const r = await store.restartEngine();
        return sendJson(res, r.engineStarting && !r.engineRunning ? 202 : 200, r);
      }
      if (method === "GET" && pathname === "/projects") {
        return sendJson(res, 200, { projects: store.listProjects() });
      }
      if (method === "POST" && pathname === "/projects") {
        return sendJson(res, 201, { project: store.createProject(body.name) });
      }
      if (method === "POST" && pathname === "/uploads") {
        return sendJson(res, 201, store.saveUpload(body));
      }
      if (method === "GET" && pathname === "/loras") {
        return sendJson(res, 200, { loras: store.listLoras() });
      }
      if (method === "POST" && pathname === "/loras") {
        return sendJson(res, 201, { lora: await store.addLora(body) });
      }
      if (method === "DELETE" && pathname.startsWith("/loras/")) {
        return sendJson(res, 200, store.removeLora(pathname.slice("/loras/".length)));
      }
      if (method === "GET" && pathname.startsWith("/prompt-guide/")) {
        const presetId = pathname.slice("/prompt-guide/".length);
        const guide = getPromptGuideForPreset(presetId);
        if (!guide) throw new ApiError(404, "unknown_preset", `Unknown preset: ${presetId}`);
        return sendJson(res, 200, guide);
      }
      if (method === "POST" && pathname === "/generate") {
        const resObj = store.startGeneration(body, tokenEntry, { allowExternalFromUi: isUiRequest });
        return sendJson(res, 201, resObj);
      }
      if (method === "GET" && pathname === "/jobs") {
        return sendJson(res, 200, { jobs: store.listJobs() });
      }
      if (method === "GET" && pathname.startsWith("/jobs/")) {
        const id = pathname.slice("/jobs/".length);
        return sendJson(res, 200, { job: store.getJob(id) });
      }
      if (method === "POST" && pathname.startsWith("/jobs/") && pathname.endsWith("/cancel")) {
        const id = pathname.split("/")[2];
        return sendJson(res, 200, store.cancelJob(id));
      }
      if (method === "POST" && pathname === "/presets/prepare") {
        const r = store.preparePreset(body);
        return sendJson(res, r.status === "started" ? 202 : 200, r);
      }
      if (method === "GET" && pathname === "/presets/prepare") {
        return sendJson(res, 200, { downloads: store.downloadManager.listDownloads() });
      }

      // ---- App UI Context & Approvals ----
      if (method === "GET" && pathname === "/app/context") {
        return sendJson(res, 200, store.runtime.appContext);
      }
      if (method === "POST" && pathname === "/app/generate-form") {
        store.runtime.appContext.form = { ...store.runtime.appContext.form, ...body };
        if (body.presetId) store.runtime.appContext.selectedPresetId = body.presetId;
        return sendJson(res, 200, { ok: true, form: store.runtime.appContext.form });
      }
      if (method === "POST" && pathname === "/app/screen") {
        store.runtime.appContext.screen = body.screen || "generate";
        if (body.id) store.runtime.appContext.selectedCharacterId = body.id;
        return sendJson(res, 200, { ok: true, context: store.runtime.appContext });
      }
      if (method === "GET" && pathname.startsWith("/approvals/") && pathname.endsWith("/wait")) {
        const id = pathname.split("/")[2];
        const ap = store.runtime.approvals.get(id);
        return sendJson(res, 200, ap || { status: "done", result: { status: 200, json: { ok: true } } });
      }

      // ---- Character Studio ----
      if (method === "GET" && pathname === "/characters") {
        return sendJson(res, 200, { characters: store.listCharacters() });
      }
      if (method === "GET" && pathname === "/character-features") {
        return sendJson(res, 200, CHARACTER_FEATURES);
      }
      if (method === "GET" && pathname === "/character-presets") {
        return sendJson(res, 200, CHARACTER_PRESETS);
      }
      if (method === "POST" && pathname === "/characters") {
        return sendJson(res, 201, store.createCharacter(body));
      }
      if (pathname.startsWith("/characters/")) {
        const parts = pathname.split("/").filter(Boolean); // ["characters", id, action?]
        const charId = parts[1];
        const action = parts[2];
        if (method === "GET" && !action) return sendJson(res, 200, { character: store.getCharacter(charId) });
        if (method === "DELETE" && !action) return sendJson(res, 200, store.removeCharacter(charId));
        if (method === "POST" && action === "generate-image") return sendJson(res, 201, store.generateCharacterImage(charId, body));
        if (method === "POST" && action === "generate-frame") return sendJson(res, 201, store.generateCharacterFrame(charId, body));
        if (method === "POST" && action === "animate") return sendJson(res, 201, store.animateCharacter(charId, body));
        if (method === "POST" && action === "accept-base") return sendJson(res, 200, store.acceptCharacterBase(charId, body));
        if (method === "POST" && action === "preset") return sendJson(res, 200, store.setCharacterPreset(charId, body));
        if (method === "POST" && action === "enhance") return sendJson(res, 201, store.enhanceCharacterMedia(charId, body));
        if (method === "POST" && action === "regenerate-base") return sendJson(res, 201, store.regenerateCharacterBase(charId, body));
      }

      // ---- Recipes, Products, Subjects, Locations ----
      if (method === "GET" && pathname === "/recipe-blocks") {
        return sendJson(res, 200, RECIPE_BLOCKS);
      }
      if (method === "POST" && pathname === "/recipes/validate") {
        return sendJson(res, 200, { validation: store.validateRecipe(body) });
      }
      if (method === "GET" && pathname === "/recipes") {
        return sendJson(res, 200, { recipes: store.listRecipes() });
      }
      if (method === "POST" && pathname === "/recipes") {
        return sendJson(res, 201, store.composeRecipe(body));
      }
      if (pathname.startsWith("/recipes/")) {
        const parts = pathname.split("/").filter(Boolean);
        const recId = parts[1];
        const action = parts[2];
        if (method === "GET" && !action) return sendJson(res, 200, { recipe: store.getRecipe(recId) });
        if (method === "POST" && action === "publish") return sendJson(res, 200, store.publishRecipe(recId, body));
        if (method === "POST" && action === "run") return sendJson(res, 201, store.runRecipe(recId, body, tokenEntry));
        if (method === "GET" && action === "runs") return sendJson(res, 200, { runs: store.listRecipeRuns(recId) });
      }
      if (pathname.startsWith("/recipe-runs/")) {
        const parts = pathname.split("/").filter(Boolean);
        const runId = parts[1];
        const action = parts[2];
        if (method === "GET" && !action) return sendJson(res, 200, { run: store.getRecipeRun(runId) });
        if (method === "POST" && action === "cancel") return sendJson(res, 200, store.cancelRecipeRun(runId));
      }
      if (method === "GET" && pathname === "/subjects") {
        return sendJson(res, 200, { subjects: store.listSubjects() });
      }
      if (method === "GET" && pathname === "/products") {
        return sendJson(res, 200, { products: store.listProducts() });
      }
      if (method === "POST" && pathname === "/products") {
        return sendJson(res, 201, store.createProduct(body));
      }
      if (method === "GET" && pathname.startsWith("/products/")) {
        return sendJson(res, 200, { product: store.getProduct(pathname.slice("/products/".length)) });
      }
      if (method === "DELETE" && pathname.startsWith("/products/")) {
        return sendJson(res, 200, store.removeProduct(pathname.slice("/products/".length)));
      }
      if (method === "GET" && pathname === "/locations") {
        return sendJson(res, 200, { locations: store.listLocations() });
      }
      if (method === "POST" && pathname === "/locations") {
        return sendJson(res, 201, store.createLocation(body));
      }

      // ---- Video Studio (/films) ----
      if (method === "GET" && pathname === "/films") {
        const projectId = url.searchParams.get("projectId") || undefined;
        return sendJson(res, 200, { films: store.listFilms(projectId) });
      }
      if (method === "POST" && pathname === "/films") {
        return sendJson(res, 201, store.createFilm(body));
      }
      if (pathname.startsWith("/films/")) {
        const parts = pathname.split("/").filter(Boolean); // ["films", filmId, ...]
        const filmId = parts[1];
        const sub = parts[2];
        if (!sub) {
          if (method === "GET") return sendJson(res, 200, store.getFilm(filmId));
          if (method === "PATCH") return sendJson(res, 200, store.updateFilmSettings(filmId, body));
        }
        if (sub === "undo" && method === "POST") return sendJson(res, 200, store.undoFilm(filmId));
        if (sub === "redo" && method === "POST") return sendJson(res, 200, store.redoFilm(filmId));
        if (sub === "tracks" && !parts[3] && method === "POST") return sendJson(res, 201, store.addTrack(filmId, body));
        if (sub === "tracks" && parts[3] && method === "PATCH") return sendJson(res, 200, store.moveTrack(filmId, parts[3], body));
        if (sub === "tempo" && method === "POST") return sendJson(res, 200, await store.detectTempo(filmId, body));
        if (sub === "plan" && method === "POST") return sendJson(res, 200, store.applyFilmPlan(filmId, body));
        if (sub === "fades" && method === "POST") return sendJson(res, 200, store.setFades(filmId, body));
        if (sub === "markers" && method === "POST") return sendJson(res, 200, store.addMarker(filmId, body));
        if (sub === "export-range" && method === "POST") return sendJson(res, 200, store.setExportRange(filmId, body));
        if (sub === "renders" && method === "POST") {
          const r = store.renderClips(filmId, body, tokenEntry);
          return sendJson(res, r.started.length > 0 ? 202 : 200, r);
        }
        if (sub === "export" && method === "POST") {
          return sendJson(res, 201, await store.exportFilm(filmId));
        }
        if (sub === "clips") {
          if (!parts[3] && method === "POST") return sendJson(res, 201, store.addClip(filmId, body));
          if (parts[3] === "import" && method === "POST") return sendJson(res, 201, store.importClip(filmId, body));
          const clipRef = parts[3];
          const clipAction = parts[4];
          if (clipRef && !clipAction) {
            if (method === "PATCH") return sendJson(res, 200, store.updateClip(filmId, clipRef, body));
            if (method === "DELETE") return sendJson(res, 200, store.removeClip(filmId, clipRef));
          }
          if (clipRef && clipAction === "move" && method === "POST") return sendJson(res, 200, store.moveClip(filmId, clipRef, body));
          if (clipRef && clipAction === "trim" && method === "POST") return sendJson(res, 200, store.trimClip(filmId, clipRef, body));
          if (clipRef && clipAction === "takes" && method === "GET") return sendJson(res, 200, store.listTakes(filmId, clipRef));
          if (clipRef && clipAction === "take" && method === "POST") return sendJson(res, 200, store.useTake(filmId, clipRef, body.generationId));
        }
      }

      return sendJson(res, 404, { errorCode: "not_found", message: `Unknown route: ${method} ${pathname}` });
    } catch (err) {
      if (err instanceof ApiError || (err && Number.isInteger(err.status) && err.errorCode)) {
        return sendJson(res, err.status, {
          errorCode: err.errorCode,
          message: err.message,
          ...(err.details ? { details: err.details } : {}),
        });
      }
      console.error("[SimpleTun] Internal server error:", err);
      return sendJson(res, 500, { errorCode: "internal_error", message: err?.message || "Unexpected server error." });
    }
  });

  return { server, store };
}

export async function startServer({
  port = Number(process.env.SIMPLETUN_PORT || process.env.PORT || 48199),
  host,
  allowRemoteHosts,
  allowedHosts,
  rootDir = ROOT_DIR,
} = {}) {
  const netCfg = resolveNetworkConfig({ host, allowRemoteHosts, allowedHosts });
  const listenHost = netCfg.host;
  const { server, store } = createSimpleTunServer({
    rootDir,
    allowRemoteHosts: netCfg.allowRemoteHosts,
    allowedHosts: netCfg.allowedHosts,
  });

  await new Promise((resolve, reject) => {
    const onError = (err) => {
      if (err.code === "EADDRINUSE" && port !== 0) {
        server.listen(0, listenHost, resolve);
      } else {
        reject(err);
      }
    };
    server.once("error", onError);
    server.listen(port, listenHost, () => {
      server.off("error", onError);
      resolve();
    });
  });

  const addr = server.address();
  const actualPort = typeof addr === "object" && addr ? addr.port : port;
  store.writeDiscovery(actualPort);

  const displayHost = listenHost === "0.0.0.0" || listenHost === "::" ? "127.0.0.1" : listenHost;
  return {
    server,
    store,
    port: actualPort,
    host: listenHost,
    allowRemoteHosts: netCfg.allowRemoteHosts,
    url: `http://${displayHost}:${actualPort}`,
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  startServer().then(({ port, host, allowRemoteHosts, url }) => {
    console.log(`[SimpleTun] Control API & Studio running at ${url} (bound ${host}:${port})`);
    if (allowRemoteHosts) {
      console.log(`[SimpleTun] Remote/Proxy Host mode ENABLED (listening on ${host}:${port}). Protect public ports with a firewall or trusted proxy.`);
    }
    console.log(`[SimpleTun] Open-Source Pairing Token: st-agent-simpletun-open`);
  });
}
