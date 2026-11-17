// packages/mcp-server/src/userdata.js
// Resolves SimpleTun's workspace-local or user data discovery directory.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_DATA_DIR = path.resolve(__dirname, "..", "..", "..", "data");

export function resolveUserDataDir(env = process.env, platform = process.platform) {
  if (env.SIMPLETUN_USERDATA_DIR) return env.SIMPLETUN_USERDATA_DIR;
  if (env.SIMPLIGEN_USERDATA_DIR) return env.SIMPLIGEN_USERDATA_DIR;
  if (fs.existsSync(path.join(WORKSPACE_DATA_DIR, "agent-api.json"))) {
    return WORKSPACE_DATA_DIR;
  }
  const name = env.SIMPLETUN_APP_NAME || "simpletun";
  if (platform === "win32") {
    const appData = env.APPDATA || path.join(env.USERPROFILE || os.homedir(), "AppData", "Roaming");
    return path.join(appData, name);
  }
  if (platform === "darwin") {
    return path.join(env.HOME || os.homedir(), "Library", "Application Support", name);
  }
  return path.join(env.HOME || os.homedir(), ".config", name);
}

export function readDiscoveryPort(userDataDir) {
  try {
    const raw = fs.readFileSync(path.join(userDataDir, "agent-api.json"), "utf8");
    const port = JSON.parse(raw).port;
    return Number.isInteger(port) ? port : null;
  } catch {
    return null;
  }
}
