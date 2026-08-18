/**
 * Visualizer window handle (realtime-visualization 02) — main-window side.
 * One named window ('manadj-visualizer'): the TopBar toggle opens it,
 * focuses it when open-but-backgrounded, and closes it when it already has
 * focus. Module state like the playback stores; the ref is best-effort
 * (a window opened by URL by hand is adopted on the next toggle via the
 * shared window name).
 */

export const VISUALIZER_WINDOW_NAME = 'manadj-visualizer';
const FEATURES = 'width=960,height=540';

let vizWindow: Window | null = null;

export function isVisualizerOpen(): boolean {
  return !!vizWindow && !vizWindow.closed;
}

/** Open when closed; focus when open but elsewhere; close when focused. */
export function toggleVisualizer(): void {
  if (!vizWindow || vizWindow.closed) {
    vizWindow = window.open('/visualizer', VISUALIZER_WINDOW_NAME, FEATURES);
    return;
  }
  let focused = false;
  try {
    focused = vizWindow.document.hasFocus();
  } catch {
    focused = false; // cross-origin/dead handle: treat as unfocused
  }
  if (focused) {
    vizWindow.close();
    vizWindow = null;
  } else {
    vizWindow.focus();
  }
}
