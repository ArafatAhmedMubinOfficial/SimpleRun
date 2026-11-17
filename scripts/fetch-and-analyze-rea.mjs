import fs from "node:fs";
import path from "node:path";
import { execFileSync, execSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
const TARGETS_DIR = path.join(ROOT, "rea-evidence", "targets");
const MCP_DIR = path.join(TARGETS_DIR, "simpligen-mcp");
const WEB_DIR = path.join(TARGETS_DIR, "simpligen-web");
const EVIDENCE_DIR = path.join(ROOT, "rea-evidence");

function ensureDirs() {
  for (const dir of [TARGETS_DIR, MCP_DIR, WEB_DIR, EVIDENCE_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function downloadFile(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buf);
  return buf.length;
}

function runRea(args, options = {}) {
  const cmd = `npx -y rea-agents@latest ${args.join(" ")}`;
  return execSync(cmd, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 100 * 1024 * 1024,
    ...options,
  });
}

async function main() {
  ensureDirs();
  console.log("[REA Pipeline] Step 1: Downloading @simpligen/mcp@0.9.1 tarball...");
  const tgzPath = path.join(MCP_DIR, "simpligen-mcp-0.9.1.tgz");
  const tgzSize = await downloadFile(
    "https://registry.npmjs.org/@simpligen/mcp/-/mcp-0.9.1.tgz",
    tgzPath
  );
  console.log(`[REA Pipeline] Downloaded ${tgzSize} bytes -> ${tgzPath}`);

  const packageDir = path.join(MCP_DIR, "package");
  if (fs.existsSync(packageDir)) {
    fs.rmSync(packageDir, { recursive: true, force: true });
  }
  execFileSync("tar", ["-xzf", tgzPath, "-C", MCP_DIR], { stdio: "inherit" });
  console.log(`[REA Pipeline] Extracted MCP package to ${packageDir}`);

  console.log("[REA Pipeline] Step 2: Fetching simpligen.io pages & JS chunks...");
  const pages = [
    "https://www.simpligen.io/",
    "https://www.simpligen.io/video-studio",
    "https://www.simpligen.io/gpu-check",
    "https://www.simpligen.io/pricing",
  ];
  const chunkPaths = new Set();
  for (const url of pages) {
    try {
      const html = await (await fetch(url)).text();
      const matches = html.match(/\/_next\/static\/chunks\/[a-zA-Z0-9._-]+\.js/g) || [];
      for (const m of matches) {
        chunkPaths.add(m);
      }
    } catch (err) {
      console.warn(`[REA Pipeline] Warning fetching ${url}: ${err.message}`);
    }
  }

  let downloadedChunks = 0;
  for (const rel of chunkPaths) {
    const filename = path.basename(rel);
    const dest = path.join(WEB_DIR, filename);
    try {
      await downloadFile(`https://www.simpligen.io${rel}`, dest);
      downloadedChunks++;
    } catch (err) {
      console.warn(`[REA Pipeline] Warning downloading chunk ${rel}: ${err.message}`);
    }
  }
  console.log(`[REA Pipeline] Downloaded ${downloadedChunks} JS chunks into ${WEB_DIR}`);

  console.log("[REA Pipeline] Step 3: Running REA analyze-javascript-application on @simpligen/mcp...");
  const mcpEvidencePath = path.join(EVIDENCE_DIR, "mcp-evidence.json");
  const mcpSummaryPath = path.join(EVIDENCE_DIR, "mcp-summary.json");
  if (fs.existsSync(mcpEvidencePath)) fs.unlinkSync(mcpEvidencePath);

  const mcpSummaryOut = runRea([
    "analyze-javascript-application",
    `"${packageDir}"`,
    "--detail",
    "summary",
    "--evidence_output",
    `"${mcpEvidencePath}"`,
    "--format",
    "json",
  ]);
  fs.writeFileSync(mcpSummaryPath, mcpSummaryOut, "utf8");
  console.log(`[REA Pipeline] Saved ${mcpEvidencePath} & ${mcpSummaryPath}`);

  console.log("[REA Pipeline] Step 4: Inspecting module & route views via REA inspect-analysis-view...");
  const viewReqPath = path.join(EVIDENCE_DIR, "_mcp-modules-req.json");
  fs.writeFileSync(
    viewReqPath,
    JSON.stringify({
      source: { kind: "evidence-file", path: mcpEvidencePath },
      view: { kind: "page", collection: "modules", offset: 0, limit: 100 },
    }),
    "utf8"
  );
  const mcpModulesOut = runRea([
    "inspect-analysis-view",
    `"${viewReqPath}"`,
    "--format",
    "json",
  ]);
  fs.writeFileSync(path.join(EVIDENCE_DIR, "mcp-modules.json"), mcpModulesOut, "utf8");
  fs.unlinkSync(viewReqPath);

  console.log("[REA Pipeline] Step 5: Running REA analyze-javascript-application on simpligen.io web chunks...");
  const webEvidencePath = path.join(EVIDENCE_DIR, "web-chunks-evidence.json");
  const webSummaryPath = path.join(EVIDENCE_DIR, "web-summary.json");
  if (fs.existsSync(webEvidencePath)) fs.unlinkSync(webEvidencePath);

  const webSummaryOut = runRea([
    "analyze-javascript-application",
    `"${WEB_DIR}"`,
    "--detail",
    "summary",
    "--evidence_output",
    `"${webEvidencePath}"`,
    "--format",
    "json",
  ]);
  fs.writeFileSync(webSummaryPath, webSummaryOut, "utf8");
  console.log(`[REA Pipeline] Saved ${webEvidencePath} & ${webSummaryPath}`);

  console.log("[REA Pipeline] Step 6: Generating REA Reconstruction Obligation Ledger...");
  const ledgerReqPath = path.join(EVIDENCE_DIR, "_ledger-req.json");
  fs.writeFileSync(
    ledgerReqPath,
    JSON.stringify({
      evidence: { kind: "evidence-file", path: mcpEvidencePath },
      offset: 0,
      limit: 100,
    }),
    "utf8"
  );
  try {
    const ledgerOut = runRea([
      "build-reconstruction-obligation-ledger",
      `"${ledgerReqPath}"`,
      "--format",
      "json",
    ]);
    fs.writeFileSync(path.join(EVIDENCE_DIR, "obligation-ledger.json"), ledgerOut, "utf8");
    console.log("[REA Pipeline] Saved obligation-ledger.json");
  } catch (err) {
    console.warn(`[REA Pipeline] Ledger generation note: ${err.message}`);
  } finally {
    if (fs.existsSync(ledgerReqPath)) fs.unlinkSync(ledgerReqPath);
  }

  console.log("[REA Pipeline] Done!");
}

main().catch((err) => {
  console.error("[REA Pipeline] Error:", err);
  process.exit(1);
});
