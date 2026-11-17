// electron/main.js
// Real Electron Desktop App Shell for SimpleTun on Windows / Linux / macOS.
// Starts the local HTTP Control API + ComfyUI Supervisor in-process and renders the Studio UI.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, Tray, Menu, ipcMain, dialog, nativeImage } from "electron";
import { startServer } from "../src/server/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");

let mainWindow = null;
let tray = null;
let serverHandle = null;

function createTrayIcon() {
  // Minimal 16x16 PNG data URL for tray icon
  const png16 =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAH0lEQVQ4T2Nk+M9QzwAEjAwMDP8ZsQKGYQ0jGg0BAwC+4QMQ8P8fSAAAAABJRU5ErkJggg==";
  return nativeImage.createFromDataURL(png16);
}

async function bootDesktop() {
  serverHandle = await startServer({ port: 48199, rootDir: ROOT_DIR });

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    title: "SimpleTun Studio",
    backgroundColor: "#07080d",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  await mainWindow.loadURL(serverHandle.url);

  mainWindow.on("close", (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  tray = new Tray(createTrayIcon());
  tray.setToolTip(`SimpleTun Control API (${serverHandle.url})`);
  const menu = Menu.buildFromTemplate([
    { label: "Open SimpleTun Studio", click: () => mainWindow.show() },
    { label: `Control API: ${serverHandle.url}`, enabled: false },
    { type: "separator" },
    {
      label: "Quit SimpleTun",
      click: async () => {
        app.isQuitting = true;
        if (serverHandle?.store?.engineManager) {
          await serverHandle.store.engineManager.stopEngine();
        }
        serverHandle?.server?.close();
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
  tray.on("double-click", () => mainWindow.show());
}

ipcMain.handle("dialog:selectFolder", async () => {
  const res = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory"] });
  return res.canceled ? null : res.filePaths[0];
});

app.whenReady().then(bootDesktop);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    // Keep alive in tray unless app.isQuitting is set
  }
});
