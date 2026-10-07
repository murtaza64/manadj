/** Electron preload bridge (desktop/preload.js, #297). Absent in browsers. */
interface FileDropBridge {
  /** Absolute filesystem path of a dropped File (folders included). */
  pathForFile(file: File): string;
}

interface Window {
  manadjFiles?: FileDropBridge;
}
