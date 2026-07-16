const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("manadjRecording", {
  start: (meta) => ipcRenderer.invoke("recording:start", meta),
  write: (id, buffer) => ipcRenderer.postMessage("recording:chunk", { id, buffer }, [buffer]),
  stop: (id) => ipcRenderer.invoke("recording:stop", id),
  save: (request) => ipcRenderer.invoke("recording:save", request),
  discard: (id) => ipcRenderer.invoke("recording:discard", id),
});
