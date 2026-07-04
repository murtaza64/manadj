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

/** Wheel step ratio (matches the renderer's own zoomIn/zoomOut step). */
const STEP_RATIO = 1.2;

export function clampVisibleSeconds(seconds: number): number {
  if (!isFinite(seconds)) return DEFAULT_VISIBLE_SECONDS;
  return Math.max(MIN_VISIBLE_SECONDS, Math.min(MAX_VISIBLE_SECONDS, seconds));
}

/** One wheel notch: in = fewer visible seconds, out = more. Clamped. */
export function stepVisibleSeconds(current: number, direction: 'in' | 'out'): number {
  const next = direction === 'in' ? current / STEP_RATIO : current * STEP_RATIO;
  return clampVisibleSeconds(next);
}
