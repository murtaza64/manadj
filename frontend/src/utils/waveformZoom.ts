/**
 * Time-based waveform zoom (performance-mode issue 05, pure).
 *
 * The Performance view zooms in *visible seconds* shared across decks; equal
 * effective BPM then means equal beat spacing on screen. The renderer (ADR
 * 0015) consumes visible seconds directly — the old track-relative
 * zoom-factor conversion (and its MAX_ZOOM_FACTOR tab-killer guard, which
 * existed only because the legacy renderer built whole-track geometry) is
 * gone with the legacy renderer.
 */

export const MIN_VISIBLE_SECONDS = 4;
export const MAX_VISIBLE_SECONDS = 240;
export const DEFAULT_VISIBLE_SECONDS = 20;

/** Where scrolling waveforms pin the playhead, as a fraction of the canvas
 * width (the renderer's playMarkerPosition). One constant — the play-guide
 * overlay projects against the same fraction the waveforms render with. */
export const PLAY_MARKER_FRACTION = 0.25;

/** Wheel step ratio per notch — THE zoom sensitivity, shared by the
 * linked Performance zoom, the library deck renderer, and the sync
 * view's diff viewer. Must be > 1 (in = ÷ratio, out = ×ratio; 1.0 would
 * be no zoom). History: decks 1.2, old diff viewer 1.25, then 1.1;
 * 1.05 ≈ quarter of the original 1.2 log-step. */
export const STEP_RATIO = 1.05;

export function clampVisibleSeconds(seconds: number): number {
  if (!isFinite(seconds)) return DEFAULT_VISIBLE_SECONDS;
  return Math.max(MIN_VISIBLE_SECONDS, Math.min(MAX_VISIBLE_SECONDS, seconds));
}

/** One wheel notch: in = fewer visible seconds, out = more. Clamped. */
export function stepVisibleSeconds(current: number, direction: 'in' | 'out'): number {
  const next = direction === 'in' ? current / STEP_RATIO : current * STEP_RATIO;
  return clampVisibleSeconds(next);
}

/**
 * The track-time window a deck playing at `rate` should render for a shared
 * wall-clock zoom (performance-mode 06). The renderer consumes seconds of
 * TRACK time; a pitched deck plays them faster, so an unscaled window kept
 * base-BPM beat spacing on screen. Scaling by the rate makes the viewport a
 * fixed wall-clock duration on every deck — equal effective BPM means equal
 * beat spacing, which is what beatmatching eyes need.
 *
 * Callers pass a PITCH-only rate: a nudge's momentary bend must not breathe
 * the zoom while you're watching beat alignment.
 */
export function trackWindowSeconds(visibleSeconds: number, rate: number): number {
  return visibleSeconds * rate;
}
