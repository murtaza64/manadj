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

/**
 * Cut a slot trace into draw runs over [0, durationBeats].
 *
 * - Before the first point: parked at its position (the recording's
 *   pre-entry posture — the deck sat loaded at the entry mark).
 * - p→q where q is a JUMP landing: ride p's motion to the jump instant
 *   (traceStateAt's rule), then the next run starts at q's snap.
 * - p→q otherwise: linear (paused segments have ph0 = ph1).
 * - Past the last point: extrapolate its motion to the routine end.
 */
export function traceDrawRuns(trace: RoutineTracePoint[], durationBeats: number): BeatRun[] {
  const runs: BeatRun[] = [];
  if (trace.length === 0) return runs;
  const first = trace[0];
  if (first.beat > 0) {
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
  if (last.beat < durationBeats) {
    const db = durationBeats - last.beat;
    runs.push({
      b0: last.beat,
      b1: durationBeats,
      ph0: last.pos,
      ph1: last.pos + (last.moving ? last.ratePerBeat * db : 0),
      held: !last.moving,
    });
  }
  return runs;
}
