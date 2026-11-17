// electron/preload.js
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("simpletunDesktop", {
  isElectron: true,
  selectFolder: () => ipcRenderer.invoke("dialog:selectFolder"),
});
