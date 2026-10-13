/**
 * Cameo plan sources (#140) — pure functions under vitest.
 *
 * The planner consumes one uniform shape (CameoPlanSource) for both pin
 * kinds: a saved Cameo's authored payload, or a Cameo Take's raw capture
 * slice reduced to the same geometry. V1 is deliberately crude — the
 * two-edged window and the guest's start position, played with linear
 * fade ramps — full Cameo vectorization (per-lane idealization, Jumps on
 * both roles) arrives with the kind-aware editor (deferred with it).
 */
import type { CaptureEvent } from '../capture/events';

/** What the planner needs to play one Cameo (#140): the two-edged window
 * anchored in HOST track seconds (mix time ≡ the host's elapsed play
 * inside the window), the guest's start position, and fade ramps. */
export interface CameoPlanSource {
  guestTrackId: number;
  /** Guest entry/exit anchors, in seconds of host track time. */
  entryHostSec: number;
  exitHostSec: number;
  /** Guest track position (seconds) at the entry anchor. */
  guestStartSec: number;
  /** Guest deck pitch percent (v1: 0 — tempo-match idealization waits
   * for Cameo vectorization). */
  pitchPercent: number;
  /** Linear fade ramps (seconds) replacing authored lanes in v1. */
  fadeInSec: number;
  fadeOutSec: number;
}

export const DEFAULT_CAMEO_FADE_IN_S = 0.5;
export const DEFAULT_CAMEO_FADE_OUT_S = 1;

/** Parse a saved Cameo's opaque payload (the authoring shape this client
 * writes — no editor writes it yet, so tolerate anything and return null
 * for garbage: a dangling/unreadable Cameo pin plays nothing). */
export function cameoSourceFromData(
  guestTrackId: number,
  data: Record<string, unknown>
): CameoPlanSource | null {
  const num = (k: string): number | null =>
    typeof data[k] === 'number' && Number.isFinite(data[k] as number)
      ? (data[k] as number)
      : null;
  const entryHostSec = num('entryHostSec');
  const exitHostSec = num('exitHostSec');
  if (entryHostSec === null || exitHostSec === null || exitHostSec <= entryHostSec) return null;
  return {
    guestTrackId,
    entryHostSec,
    exitHostSec,
    guestStartSec: Math.max(0, num('guestStartSec') ?? 0),
    pitchPercent: num('pitchPercent') ?? 0,
    fadeInSec: num('fadeInSec') ?? DEFAULT_CAMEO_FADE_IN_S,
    fadeOutSec: num('fadeOutSec') ?? DEFAULT_CAMEO_FADE_OUT_S,
  };
}

/** A deck's playhead at capture instant `at`, read from the slice's
 * role-relabeled ticks and transport events (nearest sample at or before
 * `at`, advanced by the gap — ticks are ~1 Hz, so the error is bounded
 * by a second of playback). Null when the slice never saw the deck. */
function playheadAt(events: readonly CaptureEvent[], role: 'A' | 'B', at: number): number | null {
  let best: { t: number; pos: number } | null = null;
  for (const ev of events) {
    if (ev.t > at) break;
    if (ev.kind === 'tick') {
      const p = ev.playheads[role];
      if (p !== undefined) best = { t: ev.t, pos: p };
    } else if (ev.kind === 'transport' && ev.channel === role) {
      best = { t: ev.t, pos: ev.playhead };
    }
  }
  if (!best) return null;
  return best.pos + (at - best.t);
}

/** Reduce a Cameo Take's evidence to a plan source (#140, crude v1): the
 * window IS the engagement (host track time read off the host playhead at
 * its edges), the guest starts where the capture saw it start. Returns
 * null when the slice is too thin to read (no playhead samples). */
export function cameoSourceFromTake(take: {
  guestTrackId: number;
  windowStartS: number;
  windowEndS: number;
  events: readonly CaptureEvent[];
}): CameoPlanSource | null {
  const entryHostSec = playheadAt(take.events, 'A', take.windowStartS);
  const guestStartSec = playheadAt(take.events, 'B', take.windowStartS);
  if (entryHostSec === null || guestStartSec === null) return null;
  // Mix time ≡ the host's elapsed play (glossary): the exit anchor is
  // entry + the engagement's elapsed time — robust to recorded host
  // Jumps, whose replay waits for Cameo vectorization anyway.
  const exitHostSec = entryHostSec + (take.windowEndS - take.windowStartS);
  if (exitHostSec <= entryHostSec) return null;
  return {
    guestTrackId: take.guestTrackId,
    entryHostSec,
    exitHostSec,
    guestStartSec: Math.max(0, guestStartSec),
    pitchPercent: 0,
    fadeInSec: DEFAULT_CAMEO_FADE_IN_S,
    fadeOutSec: DEFAULT_CAMEO_FADE_OUT_S,
  };
}
