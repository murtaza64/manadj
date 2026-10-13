/** Desktop-shell settings bridge (packaged-app #277) — present only under
 * Electron (desktop/preload.js). Mirrors displayBridge.d.ts. */

interface SettingsBridge {
  /** Native directory picker. Resolves to the chosen absolute path, or null
   * when cancelled. */
  pickFolder(options?: { title?: string; defaultPath?: string }): Promise<string | null>;
  /** Open an https URL in the system browser (absent in older shells). */
  openExternal?(url: string): Promise<boolean>;
}

interface Window {
  manadjSettings?: SettingsBridge;
}
