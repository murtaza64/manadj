/**
 * Pure math for the performance-data overlay diff viewer.
 *
 * Beat positions are computed from the FULL tempo-change list — the viewer
 * exists to judge grids, so it must not inherit the deck renderer's
 * first-tempo-change-only limitation (PRD).
 */

export interface TempoChangeLike {
  start_time: number; // seconds
  bpm: number;
  bar_position: number; // 1-4: bar position of the segment's first beat
}

export interface BeatMarker {
  time: number; // seconds
  isDownbeat: boolean;
}

const MAX_MARKERS = 200_000; // pathological-grid guard

/** Mirrors the backend's CUE_TIME_TOLERANCE (compare.py) — the backend is
 * authoritative for divergence; this only drives display decisions. */
export const CUE_TIME_TOLERANCE_S = 0.001;

/**
 * Expand tempo changes into beat markers across [0, duration).
 * Each segment runs from its start_time to the next change's start_time
 * (or the track end), stepping at its own BPM; downbeats fall every 4 beats
 * anchored by the segment's bar_position.
 */
export function beatMarkersFromTempoChanges(
  changes: TempoChangeLike[],
  duration: number,
): BeatMarker[] {
  const markers: BeatMarker[] = [];
  if (duration <= 0) return markers;

  const sorted = [...changes].sort((a, b) => a.start_time - b.start_time);
  for (let i = 0; i < sorted.length; i++) {
    const change = sorted[i];
    if (change.bpm <= 0) continue;
    const segmentEnd = i + 1 < sorted.length
      ? Math.min(sorted[i + 1].start_time, duration)
      : duration;
    const secondsPerBeat = 60 / change.bpm;
    let beat = 0;
    for (
      let t = change.start_time;
      t < segmentEnd && markers.length < MAX_MARKERS;
      t = change.start_time + ++beat * secondsPerBeat
    ) {
      if (t < 0) continue;
      // bar_position names the first beat's place in the bar (1-4)
      const positionInBar = ((beat + change.bar_position - 1) % 4) + 1;
      markers.push({ time: t, isDownbeat: positionInBar === 1 });
    }
    if (markers.length >= MAX_MARKERS) break;
  }
  return markers;
}

/** The subset of markers inside a visible window (inclusive start). */
export function markersInWindow(
  markers: BeatMarker[],
  windowStart: number,
  windowSeconds: number,
): BeatMarker[] {
  const end = windowStart + windowSeconds;
  return markers.filter((m) => m.time >= windowStart && m.time < end);
}

/** Zoom about a fixed time point (the time under the cursor stays put). */
export function zoomWindow(
  windowStart: number,
  windowSeconds: number,
  anchorTime: number,
  factor: number,
  duration: number,
  minSeconds = 0.5,
): { windowStart: number; windowSeconds: number } {
  const nextSeconds = clamp(windowSeconds * factor, minSeconds, duration);
  const anchorFrac = (anchorTime - windowStart) / windowSeconds;
  const nextStart = clamp(anchorTime - anchorFrac * nextSeconds, 0, duration - nextSeconds);
  return { windowStart: nextStart, windowSeconds: nextSeconds };
}

export function panWindow(
  windowStart: number,
  windowSeconds: number,
  deltaSeconds: number,
  duration: number,
): number {
  return clamp(windowStart + deltaSeconds, 0, Math.max(0, duration - windowSeconds));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}
