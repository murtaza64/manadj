/** Desktop-shell display bridge (realtime-visualization 03) — present only
 * under Electron (desktop/preload.js). Mirrors masterRecordingBridge.d.ts. */

interface VisualizerDisplayInfo {
  id: number;
  label: string;
  width: number;
  height: number;
  primary: boolean;
  /** The display the visualizer window currently sits on. */
  current: boolean;
  /** True when the visualizer is fullscreen on this display. */
  fullscreen: boolean;
}

interface VisualizerDisplayBridge {
  displays(): Promise<VisualizerDisplayInfo[]>;
  fullscreenOn(displayId: number): Promise<{ ok: boolean; reason?: string }>;
  windowed(): Promise<{ ok: boolean; reason?: string }>;
  toggleFullscreen(): Promise<{ ok: boolean; reason?: string }>;
}

interface Window {
  manadjVisualizer?: VisualizerDisplayBridge;
}
