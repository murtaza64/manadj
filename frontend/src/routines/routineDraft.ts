/**
 * Routine draft model (gh#170 pass 2, directive 2): authored EDITS over a
 * promoted Routine's mechanical recording — slot-indexed lanes on the
 * relative beat axis and Jump events on ANY slot. THE SEAM the pair
 * editor eventually migrates onto: a pair is the 2-slot special case.
 *
 * Doctrine:
 * - The recording (events_json) is EVIDENCE and never changes; edits are
 *   a separate, re-openable layer (`Routine.edits_json`) applied at
 *   build time (buildPlannedRoutine) — so the editor's audition and the
 *   set Conductor's replay hear the same result by construction.
 * - Authored lanes REPLACE the recorded step lane for their (slot,
 *   control): breakpoint envelopes in routine beats, linearly
 *   interpolated (the pair editor's lane semantic), mixer-domain values.
 * - Authored Jumps displace the slot's playhead trajectory from their
 *   instant on (the pair editor's cumulative-displacement semantic,
 *   generalized to any slot). A BACKWARD jump may carry a repeat count:
 *   it recurs at its own displacement's period — which is exactly a
 *   loop (CONTEXT.md, Jump event). A recorded discontinuity may be
 *   REMOVED: continuity is restored by displacing the tail back.
 */
import type { RoutineLanePoint, RoutineTracePoint } from '../sets/routinePlan';

// ── Model ────────────────────────────────────────────────────────────────

export interface AuthoredJump {
  /** Stable identity for editing gestures. */
  id: string;
  slot: number;
  /** Routine beat of the (first) jump instant. */
  beat: number;
  /** Track-seconds displacement (negative = backward). */
  deltaSec: number;
  /** Loop doctrine: a BACKWARD jump repeated k times recurs at its own
   * displacement's period. Only coherent when deltaSec < 0; ignored
   * otherwise. 1 (or absent) = a single jump. */
  repeat?: number;
}

export interface RemovedRecordedJump {
  slot: number;
  /** The recorded landing's beat (matched within a small tolerance —
   * trace beats are floats from promotion). */
  beat: number;
}

export interface RoutineEdits {
  /** Authored lane envelopes, keyed `${slot}:${control}` — absent key =
   * the recorded step lane plays. Points in routine beats, sorted. */
  lanes: Record<string, RoutineLanePoint[]>;
  jumps: AuthoredJump[];
  removedRecordedJumps: RemovedRecordedJump[];
  /** Per-slot alignment NUDGE (gh#190 item 6): a rigid track-seconds
   * offset sliding the whole track under the routine clock — the slot
   * plays material shifted by deltaSec at the same routine beats. Keyed
   * by slot (JSON string keys); absent/0 = no slide. */
  nudges: Record<string, number>;
}

export const EMPTY_EDITS: RoutineEdits = {
  lanes: {},
  jumps: [],
  removedRecordedJumps: [],
  nudges: {},
};

export function emptyEdits(): RoutineEdits {
  return { lanes: {}, jumps: [], removedRecordedJumps: [], nudges: {} };
}

export function laneKey(slot: number, control: string): string {
  return `${slot}:${control}`;
}

export function editsAreEmpty(e: RoutineEdits): boolean {
  return (
    Object.keys(e.lanes).length === 0 &&
    e.jumps.length === 0 &&
    e.removedRecordedJumps.length === 0 &&
    Object.keys(e.nudges).length === 0
  );
}

/** Tolerantly parse persisted edits (the events_json posture: stored
 * opaque, validated on read). */
export function parseEdits(raw: unknown): RoutineEdits {
  if (raw === null || raw === undefined || typeof raw !== 'object') return emptyEdits();
  const o = raw as Record<string, unknown>;
  const lanes: Record<string, RoutineLanePoint[]> = {};
  if (o.lanes && typeof o.lanes === 'object') {
    for (const [k, v] of Object.entries(o.lanes as Record<string, unknown>)) {
      if (!Array.isArray(v)) continue;
      const pts = v
        .filter(
          (p): p is { beat: number; value: number } =>
            typeof p === 'object' &&
            p !== null &&
            typeof (p as { beat?: unknown }).beat === 'number' &&
            typeof (p as { value?: unknown }).value === 'number'
        )
        .map((p) => ({ beat: p.beat, value: p.value }))
        .sort((a, b) => a.beat - b.beat);
      lanes[k] = pts;
    }
  }
  const jumps: AuthoredJump[] = Array.isArray(o.jumps)
    ? (o.jumps as unknown[])
        .filter(
          (j): j is AuthoredJump =>
            typeof j === 'object' &&
            j !== null &&
            typeof (j as AuthoredJump).slot === 'number' &&
            typeof (j as AuthoredJump).beat === 'number' &&
            typeof (j as AuthoredJump).deltaSec === 'number'
        )
        .map((j) => ({
          id: typeof j.id === 'string' ? j.id : `${j.slot}:${j.beat}`,
          slot: j.slot,
          beat: j.beat,
          deltaSec: j.deltaSec,
          repeat: typeof j.repeat === 'number' && j.repeat > 1 ? Math.floor(j.repeat) : undefined,
        }))
    : [];
  const removedRecordedJumps: RemovedRecordedJump[] = Array.isArray(o.removedRecordedJumps)
    ? (o.removedRecordedJumps as unknown[]).filter(
        (r): r is RemovedRecordedJump =>
          typeof r === 'object' &&
          r !== null &&
          typeof (r as RemovedRecordedJump).slot === 'number' &&
          typeof (r as RemovedRecordedJump).beat === 'number'
      )
    : [];
  const nudges: Record<string, number> = {};
  if (o.nudges && typeof o.nudges === 'object') {
    for (const [k, v] of Object.entries(o.nudges as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v) && v !== 0) nudges[k] = v;
    }
  }
  return { lanes, jumps, removedRecordedJumps, nudges };
}

// ── Trace transform ──────────────────────────────────────────────────────

/** Recorded-jump match tolerance (beats): trace landings are float beats
 * from promotion; UI passes the landing's own beat back. */
const RECORDED_MATCH_EPS = 0.01;

/** Expand an authored jump per the loop doctrine: a backward jump with
 * repeat k recurs at its displacement's period — |deltaSec| of track time
 * at the local trace rate, expressed in routine beats. */
export function expandAuthoredJump(
  jump: AuthoredJump,
  rateAtBeat: (beat: number) => number,
  durationBeats: number
): { beat: number; deltaSec: number }[] {
  const k = jump.deltaSec < 0 && jump.repeat && jump.repeat > 1 ? jump.repeat : 1;
  if (k === 1) return [{ beat: jump.beat, deltaSec: jump.deltaSec }];
  const out: { beat: number; deltaSec: number }[] = [];
  let beat = jump.beat;
  for (let i = 0; i < k; i++) {
    if (beat > durationBeats) break;
    out.push({ beat, deltaSec: jump.deltaSec });
    const rate = rateAtBeat(beat); // track-sec per routine beat
    const periodBeats = rate > 1e-6 ? Math.abs(jump.deltaSec) / rate : 0;
    if (periodBeats <= 1e-6) break; // paused: no period to recur at
    beat += periodBeats;
  }
  return out;
}

/**
 * Apply a slot's jump edits to its replay trace (pure): authored jumps
 * insert landing points and displace the tail; removed recorded jumps
 * clear their landing's discontinuity and displace the tail back —
 * continuity restored. Slopes/motion classification are untouched
 * (displacement is rigid); the caller re-derives jumpMixSecs from the
 * result's jump flags.
 */
export function applyJumpEditsToTrace(
  trace: RoutineTracePoint[],
  authored: AuthoredJump[],
  removed: RemovedRecordedJump[],
  durationBeats: number
): RoutineTracePoint[] {
  if (authored.length === 0 && removed.length === 0) return trace;
  const rateAt = (beat: number): number => {
    // Last point at or before `beat` that moves; fallback: first point's
    // rate, else 0.
    let rate = 0;
    for (const p of trace) {
      if (p.beat > beat) break;
      if (p.moving) rate = p.ratePerBeat;
    }
    return rate;
  };

  // 1. The displacement schedule: (beat, delta) ascending. Removals
  //    contribute the NEGATED recorded displacement at their landing.
  const displacements: { beat: number; deltaSec: number; removal?: RoutineTracePoint }[] = [];
  for (const j of authored) {
    for (const e of expandAuthoredJump(j, rateAt, durationBeats)) {
      displacements.push({ beat: e.beat, deltaSec: e.deltaSec });
    }
  }
  const removedPoints = new Set<RoutineTracePoint>();
  for (const r of removed) {
    for (let i = 1; i < trace.length; i++) {
      const q = trace[i];
      if (!q.jump || Math.abs(q.beat - r.beat) > RECORDED_MATCH_EPS) continue;
      const p = trace[i - 1];
      const ride = p.pos + (p.moving ? p.ratePerBeat * (q.beat - p.beat) : 0);
      displacements.push({ beat: q.beat, deltaSec: ride - q.pos, removal: q });
      removedPoints.add(q);
      break;
    }
  }
  displacements.sort((a, b) => a.beat - b.beat);

  // 2. Walk the original points, applying the cumulative displacement and
  //    inserting authored landing points as we pass their instants.
  const out: RoutineTracePoint[] = [];
  let cum = 0;
  let di = 0;
  const pushAuthoredLandingsUpTo = (beat: number) => {
    while (di < displacements.length && displacements[di].beat <= beat) {
      const d = displacements[di];
      if (!d.removal) {
        // Landing point: ride the prior motion to the instant, then snap.
        const prev = out[out.length - 1];
        const ride =
          prev !== undefined
            ? prev.pos + (prev.moving ? prev.ratePerBeat * (d.beat - prev.beat) : 0)
            : 0;
        out.push({
          beat: d.beat,
          pos: ride + d.deltaSec,
          jump: true,
          moving: prev?.moving ?? false,
          ratePerBeat: prev?.ratePerBeat ?? 0,
        });
      }
      cum += d.deltaSec;
      di++;
    }
  };
  for (const p of trace) {
    // Authored instants strictly before this point land first (a removal
    // AT this point applies to it too — its landing beat equals p.beat).
    pushAuthoredLandingsUpTo(p.beat);
    const isRemovedLanding = removedPoints.has(p);
    out.push({
      ...p,
      pos: p.pos + cum,
      jump: isRemovedLanding ? false : p.jump,
    });
  }
  pushAuthoredLandingsUpTo(durationBeats);
  out.sort((a, b) => a.beat - b.beat || Number(a.jump) - Number(b.jump));
  return out;
}
