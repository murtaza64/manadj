/**
 * Routine draft model (gh#170 pass 2, directive 2): authored EDITS over a
 * promoted Routine's mechanical recording — slot-addressed lanes on the
 * relative beat axis and Jump events on ANY slot. THE SEAM the pair
 * editor eventually migrates onto: a pair is the 2-slot special case.
 *
 * Doctrine:
 * - The recording (events_json) is EVIDENCE and never changes; edits are
 *   a separate, re-openable layer (`Routine.edits_json`) applied at
 *   build time (buildPlannedRoutine) — so the editor's audition and the
 *   set Conductor's replay hear the same result by construction.
 * - Slot addressing is by STABLE SLOT ID (ADR 0039, #198): a client-
 *   minted string identity, never the positional index. The entry-
 *   ordered index is a derived view recomputed from entry offsets, so
 *   reordering a cast never re-keys its edits. Migration is lossless:
 *   legacy index-keyed edits parse to slotId = String(index) — promoted
 *   routines never reordered, so index ≡ a stable id there.
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

/** Mint a stable slot id (the transition_templates client-uuid pattern —
 * no server round-trip; ADR 0039). Promoted routines' existing slots
 * keep their index-string ids from migration; minted ids only appear on
 * newly authored slots (drag-to-add, later #198 slices). */
export function mintSlotId(): string {
  return crypto.randomUUID().slice(0, 8);
}

export interface AuthoredJump {
  /** Stable identity for editing gestures. */
  id: string;
  /** Stable slot id (ADR 0039) — never the positional index. */
  slotId: string;
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
  slotId: string;
  /** The recorded landing's beat (matched within a small tolerance —
   * trace beats are floats from promotion). */
  beat: number;
}

/** An authored PAUSE (gh#190 iteration: play/pause events are first-class
 * like jumps): the slot's deck HOLDS its position from `beat` for
 * `durBeats`, then resumes from where it paused — the tail displaces
 * rigidly backward by the track-time the recording covered under the
 * hold (the jump doctrine's mirror; displacement is rigid). */
export interface AuthoredPause {
  id: string;
  slotId: string;
  /** Routine beat the hold starts. */
  beat: number;
  /** Hold length in routine beats. */
  durBeats: number;
}

export interface RemovedRecordedPause {
  slotId: string;
  /** The recorded hold's START beat (matched within a small tolerance).
   * Removal plays THROUGH the hold: motion continues at the surrounding
   * rate and the tail displaces forward by the held span. */
  beat: number;
}

export interface RoutineEdits {
  /** Authored lane envelopes, keyed `${slotId}:${control}` — absent key =
   * the recorded step lane plays. Points in routine beats, sorted. */
  lanes: Record<string, RoutineLanePoint[]>;
  jumps: AuthoredJump[];
  removedRecordedJumps: RemovedRecordedJump[];
  pauses: AuthoredPause[];
  removedRecordedPauses: RemovedRecordedPause[];
  /** Per-slot alignment NUDGE (gh#190 item 6): a rigid track-seconds
   * offset sliding the whole track under the routine clock — the slot
   * plays material shifted by deltaSec at the same routine beats. Keyed
   * by slotId; absent/0 = no slide. */
  nudges: Record<string, number>;
  /** Per-slot channel TRIM (gh#190 iteration): 0..1, 0.5 nominal —
   * replayed through the automation overlay's own trim (real gain
   * curves). Keyed by slotId; absent = nominal. */
  trims: Record<string, number>;
  /** Per-slot ENTRY-OFFSET OVERRIDE (ADR 0039, #207 slice 2): the slot's
   * entry beat on the routine clock, overriding the baked promotion
   * output — reorder IS editing entry offsets (slot index = entry order,
   * ADR 0035; the cast re-sorts as a consequence). The slot's recorded
   * timeline (trace + recorded lanes) shifts rigidly to the new entry (a
   * phrase shift). Keyed by slotId; absent = the recorded entry plays.
   * Undoable, revert-to-recorded, badged '✎' — the authored-lane idiom. */
  entryOffsets: Record<string, number>;
}

export const EMPTY_EDITS: RoutineEdits = {
  lanes: {},
  jumps: [],
  removedRecordedJumps: [],
  pauses: [],
  removedRecordedPauses: [],
  nudges: {},
  trims: {},
  entryOffsets: {},
};

export function emptyEdits(): RoutineEdits {
  return {
    lanes: {},
    jumps: [],
    removedRecordedJumps: [],
    pauses: [],
    removedRecordedPauses: [],
    nudges: {},
    trims: {},
    entryOffsets: {},
  };
}

export function laneKey(slotId: string, control: string): string {
  return `${slotId}:${control}`;
}

export function editsAreEmpty(e: RoutineEdits): boolean {
  return (
    Object.keys(e.lanes).length === 0 &&
    e.jumps.length === 0 &&
    e.removedRecordedJumps.length === 0 &&
    e.pauses.length === 0 &&
    e.removedRecordedPauses.length === 0 &&
    Object.keys(e.nudges).length === 0 &&
    Object.keys(e.trims).length === 0 &&
    Object.keys(e.entryOffsets).length === 0
  );
}

/** The slot identity of a persisted slot-addressed edit: `slotId`
 * (string) preferred; legacy `slot` (number, the pre-ADR-0039 index key)
 * migrates to String(index) — lossless, promoted routines never
 * reordered. Null = unaddressable (dropped). */
function readSlotId(o: Record<string, unknown>): string | null {
  if (typeof o.slotId === 'string' && o.slotId.length > 0) return o.slotId;
  if (typeof o.slot === 'number' && Number.isFinite(o.slot)) return String(o.slot);
  return null;
}

/** Tolerantly parse persisted edits (the events_json posture: stored
 * opaque, validated on read). Legacy index-keyed edits re-key on slotId
 * here (persisted edits_json re-keys on the first save after parse). */
export function parseEdits(raw: unknown): RoutineEdits {
  if (raw === null || raw === undefined || typeof raw !== 'object') return emptyEdits();
  const o = raw as Record<string, unknown>;
  const lanes: Record<string, RoutineLanePoint[]> = {};
  if (o.lanes && typeof o.lanes === 'object') {
    // Lane keys are `${slotId}:${control}`; legacy `${index}:${control}`
    // keys ARE the migrated form (slotId = String(index)) — kept as-is.
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
    ? (o.jumps as unknown[]).flatMap((j): AuthoredJump[] => {
        if (typeof j !== 'object' || j === null) return [];
        const r = j as Record<string, unknown>;
        const slotId = readSlotId(r);
        if (slotId === null || typeof r.beat !== 'number' || typeof r.deltaSec !== 'number') {
          return [];
        }
        return [
          {
            id: typeof r.id === 'string' ? r.id : `${slotId}:${r.beat}`,
            slotId,
            beat: r.beat,
            deltaSec: r.deltaSec,
            repeat:
              typeof r.repeat === 'number' && r.repeat > 1 ? Math.floor(r.repeat) : undefined,
          },
        ];
      })
    : [];
  const removedRecordedJumps: RemovedRecordedJump[] = Array.isArray(o.removedRecordedJumps)
    ? (o.removedRecordedJumps as unknown[]).flatMap((r): RemovedRecordedJump[] => {
        if (typeof r !== 'object' || r === null) return [];
        const q = r as Record<string, unknown>;
        const slotId = readSlotId(q);
        if (slotId === null || typeof q.beat !== 'number') return [];
        return [{ slotId, beat: q.beat }];
      })
    : [];
  const pauses: AuthoredPause[] = Array.isArray(o.pauses)
    ? (o.pauses as unknown[]).flatMap((p): AuthoredPause[] => {
        if (typeof p !== 'object' || p === null) return [];
        const r = p as Record<string, unknown>;
        const slotId = readSlotId(r);
        if (
          slotId === null ||
          typeof r.beat !== 'number' ||
          typeof r.durBeats !== 'number' ||
          r.durBeats <= 0
        ) {
          return [];
        }
        return [
          {
            id: typeof r.id === 'string' ? r.id : `p-${slotId}:${r.beat}`,
            slotId,
            beat: r.beat,
            durBeats: r.durBeats,
          },
        ];
      })
    : [];
  const removedRecordedPauses: RemovedRecordedPause[] = Array.isArray(o.removedRecordedPauses)
    ? (o.removedRecordedPauses as unknown[]).flatMap((r): RemovedRecordedPause[] => {
        if (typeof r !== 'object' || r === null) return [];
        const q = r as Record<string, unknown>;
        const slotId = readSlotId(q);
        if (slotId === null || typeof q.beat !== 'number') return [];
        return [{ slotId, beat: q.beat }];
      })
    : [];
  const nudges: Record<string, number> = {};
  if (o.nudges && typeof o.nudges === 'object') {
    for (const [k, v] of Object.entries(o.nudges as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v) && v !== 0) nudges[k] = v;
    }
  }
  const trims: Record<string, number> = {};
  if (o.trims && typeof o.trims === 'object') {
    for (const [k, v] of Object.entries(o.trims as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 && v !== 0.5) {
        trims[k] = v;
      }
    }
  }
  const entryOffsets: Record<string, number> = {};
  if (o.entryOffsets && typeof o.entryOffsets === 'object') {
    for (const [k, v] of Object.entries(o.entryOffsets as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v)) entryOffsets[k] = v;
    }
  }
  return {
    lanes,
    jumps,
    removedRecordedJumps,
    pauses,
    removedRecordedPauses,
    nudges,
    trims,
    entryOffsets,
  };
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
/** Ride-aware position of a trace at `beat` (traceStateAt's rule, local —
 * routineDraft must not import routinePlan back). */
function tracePosAt(trace: RoutineTracePoint[], beat: number): {
  pos: number;
  moving: boolean;
  ratePerBeat: number;
} {
  if (trace.length === 0) return { pos: 0, moving: false, ratePerBeat: 0 };
  if (beat <= trace[0].beat) return { pos: trace[0].pos, moving: false, ratePerBeat: 0 };
  let lo = 0;
  for (let i = 0; i < trace.length; i++) {
    if (trace[i].beat <= beat) lo = i;
    else break;
  }
  const p = trace[lo];
  const next = trace[lo + 1];
  if (!next || next.jump) {
    return {
      pos: p.pos + (p.moving ? p.ratePerBeat * (beat - p.beat) : 0),
      moving: p.moving,
      ratePerBeat: p.ratePerBeat,
    };
  }
  const f = (beat - p.beat) / (next.beat - p.beat);
  return {
    pos: p.pos + (next.pos - p.pos) * f,
    moving: p.moving,
    ratePerBeat: p.ratePerBeat,
  };
}

/**
 * Apply a slot's PAUSE edits to its replay trace (pure — the jump
 * transform's sibling, gh#190):
 *
 * - An AUTHORED pause (beat b, d beats) holds the deck at pos(b) until
 *   b+d, then resumes FROM THE HOLD — the tail displaces rigidly
 *   backward by the track-time the original trace covered in (b, b+d);
 *   original points inside the hold drop (rigid doctrine).
 * - A REMOVED recorded pause plays THROUGH the hold: the hold-start
 *   point turns moving at the pre-pause rate (fallback: the resume
 *   rate), interior hold points drop, and the tail displaces forward by
 *   the span the deck would have covered.
 */
export function applyPauseEditsToTrace(
  trace: RoutineTracePoint[],
  authored: AuthoredPause[],
  removed: RemovedRecordedPause[],
  durationBeats: number
): RoutineTracePoint[] {
  let out = trace;
  for (const r of removed) out = removeRecordedPauseFromTrace(out, r.beat);
  const sorted = [...authored].sort((a, b) => a.beat - b.beat);
  for (const p of sorted) {
    out = insertPauseIntoTrace(out, p.beat, p.durBeats, durationBeats);
  }
  return out;
}

const PAUSE_MATCH_EPS = 0.01;

function removeRecordedPauseFromTrace(
  trace: RoutineTracePoint[],
  startBeat: number
): RoutineTracePoint[] {
  const i = trace.findIndex(
    (p) => !p.moving && Math.abs(p.beat - startBeat) <= PAUSE_MATCH_EPS
  );
  if (i < 0) return trace;
  // The hold's end: motion resuming, or a SEEK splitting the hold
  // (recordedPauses' split rule — the seek keeps its own marker).
  let k = i + 1;
  while (k < trace.length && !trace[k].moving && !trace[k].jump) k++;
  if (k >= trace.length) return trace; // trailing stop — nothing to play through
  // The rate the deck would have kept: last moving rate before the hold,
  // else the resume rate.
  let rate = trace[k].ratePerBeat;
  for (let j = i - 1; j >= 0; j--) {
    if (trace[j].moving) {
      rate = trace[j].ratePerBeat;
      break;
    }
  }
  if (rate <= 0) return trace;
  if (trace[k].jump) {
    // The hold ends in a recorded SEEK: play through UP TO the seek —
    // the seek re-anchors position absolutely, so the tail (and the
    // seek's own landing) stays exactly as recorded. The jump marker's
    // displayed Δ re-derives from the new ride-out automatically.
    const out: RoutineTracePoint[] = trace.slice(0, i);
    out.push({ ...trace[i], moving: true, ratePerBeat: rate });
    for (let j = k; j < trace.length; j++) out.push(trace[j]);
    return out;
  }
  const span = trace[k].beat - trace[i].beat;
  // CONTINUITY displacement (gh#190 walkthrough, three passes): the tail
  // lands on the EXTENSION of the pre-pause ride — as if the deck never
  // stopped. delta = extendedPos(resume) − recordedResumePos: this also
  // absorbs any position CREEP the deck picked up while "paused" (jog /
  // tick noise — the real corpus crept 0.106 s over a 2.4-beat hold,
  // which a span-only displacement turned into an audible late phase).
  // No quantization: the fractional span and the fractional resume beat
  // cancel by construction when the pre-pause ride was in time.
  const delta = trace[i].pos + rate * span - trace[k].pos;
  const out: RoutineTracePoint[] = trace.slice(0, i);
  out.push({ ...trace[i], moving: true, ratePerBeat: rate });
  for (let j = k; j < trace.length; j++) {
    out.push({ ...trace[j], pos: trace[j].pos + delta });
  }
  return out;
}

function insertPauseIntoTrace(
  trace: RoutineTracePoint[],
  beat: number,
  durBeats: number,
  durationBeats: number
): RoutineTracePoint[] {
  if (durBeats <= 0 || trace.length === 0) return trace;
  const end = Math.min(beat + durBeats, durationBeats + durBeats);
  const sA = tracePosAt(trace, beat);
  const sB = tracePosAt(trace, end);
  const delta = sB.pos - sA.pos; // track-time the hold swallows
  const out: RoutineTracePoint[] = [];
  for (const p of trace) {
    if (p.beat < beat - 1e-9) out.push(p);
  }
  out.push({ beat, pos: sA.pos, jump: false, moving: false, ratePerBeat: 0 });
  out.push({
    beat: end,
    pos: sA.pos,
    jump: false,
    moving: sB.moving,
    ratePerBeat: sB.ratePerBeat,
  });
  for (const p of trace) {
    if (p.beat > end + 1e-9) out.push({ ...p, pos: p.pos - delta });
  }
  return out;
}

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
