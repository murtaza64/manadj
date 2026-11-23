const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("manadjLibraryCloud", {
  state: () => ipcRenderer.invoke("library-cloud:state"),
  connect: () => ipcRenderer.invoke("library-cloud:connect"),
  resume: () => ipcRenderer.invoke("library-cloud:resume"),
  disconnect: () => ipcRenderer.invoke("library-cloud:disconnect"),
  review: () => ipcRenderer.invoke("library-cloud:review"),
  upload: (review) => ipcRenderer.invoke("library-cloud:upload", review),
  snapshots: () => ipcRenderer.invoke("library-cloud:snapshots"),
  deleteSnapshot: (snapshot) => ipcRenderer.invoke("library-cloud:deleteSnapshot", snapshot),
  cancel: () => ipcRenderer.invoke("library-cloud:cancel"),
});

contextBridge.exposeInMainWorld("manadjLocalSpeech", {
  capability: () => ipcRenderer.invoke("local-speech:capability"),
  start: () => ipcRenderer.invoke("local-speech:start"),
  stop: () => ipcRenderer.invoke("local-speech:stop"),
  subscribe: (listener) => {
    const receive = (_event, value) => listener(value);
    ipcRenderer.on("local-speech:event", receive);
    return () => ipcRenderer.removeListener("local-speech:event", receive);
  },
});

contextBridge.exposeInMainWorld("manadjFeedback", {
  captureScreenshot: () => ipcRenderer.invoke("feedback:capture"),
});

contextBridge.exposeInMainWorld("manadjVisualizer", {
  displays: () => ipcRenderer.invoke("visualizer:displays"),
  fullscreenOn: (displayId) => ipcRenderer.invoke("visualizer:fullscreen", displayId),
  windowed: () => ipcRenderer.invoke("visualizer:windowed"),
  toggleFullscreen: () => ipcRenderer.invoke("visualizer:toggle-fullscreen"),
});

contextBridge.exposeInMainWorld("manadjSettings", {
  // Settings → Library folder pickers (packaged-app #277). Resolves to the
  // chosen absolute path, or null when cancelled.
  pickFolder: (options) => ipcRenderer.invoke("settings:pick-folder", options),
  // Open an https URL in the system browser (Spotify sign-in #347: the
  // user's browser already holds their Spotify session).
  openExternal: (url) => ipcRenderer.invoke("settings:open-external", url),
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
