/**
 * Slot trace → linear draw runs (gh#170 pass 2): the Session timeline's
 * rendering doctrine applied to the Routine editor. A slot's replay trace
 * is piecewise linear in (routine beat → track seconds); each maximal
 * linear stretch becomes a RUN mapping a linear beat range onto a linear
 * track range, and the styled-column interpreter (sets/ladderWaveStyle —
 * the same persisted Waveform style every surface renders) draws each run
 * with LOD-correct averaging. Columns sample the run's track mapping, not
 * the screen, so the image is stable under scroll/zoom — the per-column
 * band point-sampling this replaces aliased into erratic shimmer.
 */
import type { RoutineTracePoint } from '../sets/routinePlan';

/** A linear stretch: routine beats [b0, b1] map onto track seconds
 * [ph0, ph1] (equal = paused/frozen frame; the interpreter repeats the
 * column, which is what a parked deck looks like). */
export interface BeatRun {
  b0: number;
  b1: number;
  ph0: number;
  ph1: number;
  /** The deck was NOT advancing here (a hold/park — gh#190): the span
   * renders as a dimmed held frame, never a stretched smear (a recorded
   * pause's position can CREEP a fraction of a second, which stretched
   * across beats aliases into garbage). */
  held?: boolean;
}

/** Out-of-span CONTEXT to render around the routine window (#205 design
 * round): the surrounding track material each slot would play if the
 * clock ran on — the pair editor showed both whole tracks, and aligning
 * an incoming against an outgoing needs the structure OUTSIDE the window.
 * Beats before beat 0 / after durationBeats. */
export interface RunContext {
  beforeBeats: number;
  afterBeats: number;
}

/**
 * Cut a slot trace into draw runs over [0, durationBeats] — extended by
 * `context` beats on each side when given.
 *
 * - Before the first point: parked at its position (the recording's
 *   pre-entry posture — the deck sat loaded at the entry mark). With
 *   context, a slot MOVING at its first point instead extrapolates its
 *   motion BACKWARD (the trim-widen preview's rule; RoutinePlayer's
 *   lead-in does the same at audition) — the material it would have been
 *   playing. A parked first point stays parked (no invented motion).
 * - p→q where q is a JUMP landing: ride p's motion to the jump instant
 *   (traceStateAt's rule), then the next run starts at q's snap.
 * - p→q otherwise: linear (paused segments have ph0 = ph1).
 * - Past the last point: extrapolate its motion to the routine end (+
 *   trailing context when the slot is still moving there — the exit
 *   slot's play-out; a released deck's material just stops).
 */
export function traceDrawRuns(
  trace: RoutineTracePoint[],
  durationBeats: number,
  context?: RunContext
): BeatRun[] {
  const runs: BeatRun[] = [];
  if (trace.length === 0) return runs;
  const before = Math.max(0, context?.beforeBeats ?? 0);
  const after = Math.max(0, context?.afterBeats ?? 0);
  const first = trace[0];
  // Backward context is only truthful for a slot ROLLING at the window
  // open (first point at beat ≈ 0, moving) — RoutinePlayer's lead-in rule.
  // A later-entering slot sat parked at its entry mark; its pre-entry
  // material is fiction, so it keeps the held park (drawn blank).
  if (before > 0 && first.moving && first.ratePerBeat > 0 && first.beat <= 0.5) {
    const b0 = first.beat - before;
    runs.push({ b0, b1: first.beat, ph0: first.pos - first.ratePerBeat * before, ph1: first.pos });
  } else if (first.beat > 0) {
    runs.push({ b0: 0, b1: first.beat, ph0: first.pos, ph1: first.pos, held: true });
  }
  for (let i = 0; i < trace.length - 1; i++) {
    const p = trace[i];
    const q = trace[i + 1];
    const db = q.beat - p.beat;
    if (db <= 0) continue;
    const ph1 = q.jump
      ? p.pos + (p.moving ? p.ratePerBeat * db : 0)
      : q.pos;
    runs.push({ b0: p.beat, b1: q.beat, ph0: p.pos, ph1, held: !p.moving });
  }
  const last = trace[trace.length - 1];
  const end = durationBeats + (last.moving ? after : 0);
  if (last.beat < end) {
    const db = end - last.beat;
    runs.push({
      b0: last.beat,
      b1: end,
      ph0: last.pos,
      ph1: last.pos + (last.moving ? last.ratePerBeat * db : 0),
      held: !last.moving,
    });
  }
  return runs;
}
