const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("manadjVisualizer", {
  displays: () => ipcRenderer.invoke("visualizer:displays"),
  fullscreenOn: (displayId) => ipcRenderer.invoke("visualizer:fullscreen", displayId),
  windowed: () => ipcRenderer.invoke("visualizer:windowed"),
  toggleFullscreen: () => ipcRenderer.invoke("visualizer:toggle-fullscreen"),
});

contextBridge.exposeInMainWorld("manadjRecording", {
  start: (meta) => ipcRenderer.invoke("recording:start", meta),
  // Electron transfer lists accept MessagePorts, not ArrayBuffers. PCM
  // batches are small and infrequent enough to use structured-clone copy.
  write: (id, buffer) => ipcRenderer.send("recording:chunk", { id, buffer }),
  stop: (id) => ipcRenderer.invoke("recording:stop", id),
  save: (request) => ipcRenderer.invoke("recording:save", request),
  discard: (id) => ipcRenderer.invoke("recording:discard", id),
});

// Drop import (#297): absolute paths for files/folders dragged in from the
// filesystem (File.path is gone since Electron 32).
const { webUtils } = require("electron");
contextBridge.exposeInMainWorld("manadjFiles", {
  pathForFile: (file) => webUtils.getPathForFile(file),
});
