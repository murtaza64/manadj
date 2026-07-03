/**
 * Time-based waveform zoom (performance-mode issue 05, pure).
 *
 * The renderer's zoomFactor is track-length-relative (visibleFraction =
 * 1/zoom), so the same factor shows different timespans on different tracks
 * — useless for cross-deck visual beatmatching. The Performance view zooms
 * in *visible seconds* instead and converts per deck through these
 * functions; equal effective BPM then means equal beat spacing on screen.
 */

export const MIN_VISIBLE_SECONDS = 4;
export const MAX_VISIBLE_SECONDS = 240;
export const DEFAULT_VISIBLE_SECONDS = 20;

/** Wheel step ratio (matches the renderer's own zoomIn/zoomOut step). */
const STEP_RATIO = 1.2;

/**
 * Guard rail: the renderer builds geometry for the whole track at the
 * current zoom (~canvasWidth × factor columns), so an unbounded factor on a
 * very long file (a 2-hour mix at 4s visible → factor 1800) is a tab-killer.
 * Capped, a >27-minute file just shows more than the requested seconds —
 * cross-deck exactness degrades only for such outliers.
 */
export const MAX_ZOOM_FACTOR = 400;

export function clampVisibleSeconds(seconds: number): number {
  if (!isFinite(seconds)) return DEFAULT_VISIBLE_SECONDS;
  return Math.max(MIN_VISIBLE_SECONDS, Math.min(MAX_VISIBLE_SECONDS, seconds));
}

/**
 * The track-relative zoom factor that makes `visibleSeconds` of this track
 * fill the canvas. Never below 1 (a window wider than the track just shows
 * the whole track); degenerate durations show the whole track.
 */
export function zoomFactorForVisibleSeconds(
  durationSeconds: number,
  visibleSeconds: number
): number {
  if (!isFinite(durationSeconds) || durationSeconds <= 0) return 1;
  const factor = durationSeconds / clampVisibleSeconds(visibleSeconds);
  return Math.max(1, Math.min(MAX_ZOOM_FACTOR, factor));
}

/** Inverse: how many seconds a zoom factor shows of a given track. */
export function visibleSecondsForZoom(durationSeconds: number, zoomFactor: number): number {
  if (!isFinite(durationSeconds) || durationSeconds <= 0) return DEFAULT_VISIBLE_SECONDS;
  if (!isFinite(zoomFactor) || zoomFactor <= 0) return DEFAULT_VISIBLE_SECONDS;
  return durationSeconds / zoomFactor;
}

/** One wheel notch: in = fewer visible seconds, out = more. Clamped. */
export function stepVisibleSeconds(current: number, direction: 'in' | 'out'): number {
  const next = direction === 'in' ? current / STEP_RATIO : current * STEP_RATIO;
  return clampVisibleSeconds(next);
}
