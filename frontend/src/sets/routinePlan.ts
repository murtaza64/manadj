/**
 * Routine replay planning (routines 159, ADR 0035).
 *
 * A promoted Routine is a mechanical recording in slot/beat coordinates:
 * events address entry-ordered cast slots (never physical decks) on a
 * relative clock measured in beats. Replay is the inverse mapping —
 * mechanical, not idealizing:
 *
 * - SLOT → DECK: the Conductor ADOPTS the sounding deck as slot 0 at the
 *   window start (the first cast track is already playing — no reload)
 *   and allocates each remaining slot the first free deck in A→B→C→D
 *   order at its entry offset. No mid-Routine deck release (v1): a slot
 *   holds its deck to the Routine's end, so cast size beyond the free
 *   decks is a plan-time validation error, not a runtime improvisation.
 * - BEATS → SECONDS: the Routine clock scales to the Set's tempo policy
 *   (Fixed: the Set tempo; Riding: slot 0's native BPM — the entry track
 *   solos at native rate when the window opens). One second-per-beat
 *   figure maps every event and trace point onto the mix axis.
 * - PITCH RE-ANCHORING: each slot's playhead trace (tick samples +
 *   transport playheads, promotion's own lens) is a track-position-per-
 *   Routine-beat function — tempo-invariant by construction. The deck
 *   rate that reproduces a trace segment at the target tempo IS the
 *   recorded ride re-anchored: rate = (track-sec/beat) / (mix-sec/beat).
 *   Recorded pitch events are not replayed literally — their audible
 *   effect lives in the trace (grid-derived, so the recording's own
 *   anchor rate divides out). Traces are noise-simplified per moving run
 *   (#161 finding 4) and pitch is EXACTLY the segment slope, so pitch
 *   and position never disagree: beatmatched passages replay as one
 *   steady rate ≈ base; deliberate rides follow the recording; the
 *   Conductor corrects residue with rate nudges, seeking only at
 *   recorded jumps.
 * - The exit slot's deck keeps sounding past the Routine end (the
 *   boundary contract: exits with its last cast track playing); the
 *   downstream adjacency window sits on its timeline.
 *
 * Pure functions under vitest, in the planner's mold: `planSet` builds a
 * PlannedRoutine per pinned Routine; `planStateAt` defers to the
 * evaluators here inside the Routine's mix span. The RoutinePlanInput is
 * THE seam: #160's pin plumbing feeds it from the routines API at the
 * e2e merge; tests feed it directly.
 */
import { MAX_PITCH_RANGE_PERCENT } from '../playback/tempo';

// ── Input (the seam) ─────────────────────────────────────────────────────

/** A promoted Routine, as served (RoutineDetail wire shape, camel-cased
 * by the caller). Events are the slot-addressed beat-domain recording —
 * opaque dicts, tolerantly parsed here. */
export interface RoutinePlanInput {
  cast: number[];
  entryOffsetsBeats: number[];
  /** Track-seconds at each slot's entry (promotion's playhead lens; may
   * extrapolate slightly below 0 for a pre-roll entry mark). */
  entryPositions: number[];
  durationBeats: number;
  events: RoutineEventInput[];
}

export type RoutineEventInput = Record<string, unknown>;

export type RoutineDeck = 'A' | 'B' | 'C' | 'D';
export const ROUTINE_DECK_ORDER: readonly RoutineDeck[] = ['A', 'B', 'C', 'D'];

// ── Planned artifact ─────────────────────────────────────────────────────

/** One point of a slot's playhead trace: track position as a function of
 * the Routine beat clock — THE replay authority for position, motion and
 * (re-anchored) rate. */
export interface RoutineTracePoint {
  beat: number;
  /** Track seconds at `beat`. */
  pos: number;
  /** Discontinuous arrival (seek/jump/loop wrap): position snaps here at
   * `beat`; the preceding stretch extrapolates the prior motion. */
  jump: boolean;
  /** The segment LEAVING this point advances the track (deck playing). */
  moving: boolean;
  /** Track-seconds per Routine beat over the segment leaving this point
   * (0 while paused; the prior rate under a jump segment). */
  ratePerBeat: number;
}

/** Per-control step points (beat-stamped recorded values, mixer domain:
 * fader/EQ 0..1, filter −1..1). Value before the first point = the
 * slot's default (see buildSlotLanes). */
export interface RoutineLanePoint {
  beat: number;
  value: number;
}

export interface RoutineSlotLanes {
  fader: RoutineLanePoint[];
  eqLow: RoutineLanePoint[];
  eqMid: RoutineLanePoint[];
  eqHigh: RoutineLanePoint[];
  filter: RoutineLanePoint[];
  /** Defaults before each control's first point. A slot with recorded
   * fader moves defaults CLOSED (its raise is the entry gesture — the
   * pre-window level predates the slice); a slot without any defaults
   * open from its entry (it was audible the whole recorded span). */
  defaults: { fader: number; eq: number; filter: number };
}

export interface PlannedRoutineSlot {
  slot: number;
  trackId: number;
  /** Allocated deck; null = overflow (unallocatable — flagged at plan
   * time, silent at replay). */
  deck: RoutineDeck | null;
  entryMixSec: number;
  entryTrackSec: number;
  /** (targetBpm / trackBpm − 1)·100, clamped to the varispeed range —
   * the slot's beatmatched deck pitch at the Set tempo. */
  basePitchPercent: number;
  trace: RoutineTracePoint[];
  lanes: RoutineSlotLanes;
  /** THIS slot's trace discontinuity instants on the mix axis (#161):
   * the Conductor hard-syncs ONLY the jumping slot's deck — a recorded
   * seek on one deck must never snap the others (they may be mid-blend
   * or nudging; an all-deck seek reads as an audible hiccup). */
  jumpMixSecs: number[];
}

export interface PlannedRoutine {
  /** Entry index of slot 0 (the adopted, already-sounding track). */
  startEntryIndex: number;
  mixStartSec: number;
  mixEndSec: number;
  targetBpm: number;
  /** Mix seconds per Routine beat (60 / targetBpm). */
  secPerBeat: number;
  slots: PlannedRoutineSlot[];
  exit: {
    slot: number;
    deck: RoutineDeck;
    trackId: number;
    /** Exit track position at the Routine end — the downstream
     * adjacency's timeline anchor. */
    trackSecAtEnd: number;
    /** Deck pitch at the handoff (the exit slot's base pitch). */
    pitchPercent: number;
  };
  /** Trace discontinuity instants on the mix axis (jumpCrossed feeds the
   * Conductor's hard-sync). */
  jumpMixSecs: number[];
}

export interface RoutineBuildWarning {
  severity: 'warning' | 'error';
  kind: 'routine-deck-overflow' | 'routine-global-controls-dropped';
  message: string;
}

export interface BuildRoutineContext {
  startEntryIndex: number;
  mixStartSec: number;
  targetBpm: number;
  /** Slot 0's deck — the sounding deck at the window start (adopted). */
  adoptedDeck: RoutineDeck;
  /** Externally occupied decks and when each frees (mix seconds). */
  busy: { deck: RoutineDeck; untilMixSec: number }[];
  /** Per-slot track BPM (planner facts — cast tracks must carry one). */
  trackBpms: number[];
}

// ── Trace building ───────────────────────────────────────────────────────

/** Motion classification bands, relative to the slot's sync rate (the
 * promotion's RATE_MIN/MAX doctrine, re-expressed in beat domain). */
const MOVING_MIN = 0.5;
const MOVING_MAX = 2.0;
/** |Δpos| at or under this over a flat segment = paused, not a jump. */
const PAUSE_EPS_SEC = 0.35;
/** Trace simplification epsilon (#161 finding 4): within a moving run
 * (jump-to-jump), samples deviating less than this from the straight
 * line between the kept neighbors are tick-sampling jitter, not motion —
 * they are dropped, so segment slopes (= replay pitch) come out steady
 * and the position trajectory is noise-free. Real rides survive: a
 * genuine rate change displaces samples beyond the epsilon and keeps its
 * inflection points. */
const TRACE_SIMPLIFY_EPS_SEC = 0.03;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Per-slot (beat, pos) samples from the slot-addressed events — ticks'
 * slot-keyed playheads plus every transport/loop playhead. */
function slotSamples(events: RoutineEventInput[], slot: number): { beat: number; pos: number }[] {
  const out: { beat: number; pos: number }[] = [];
  for (const e of events) {
    const beat = num(e.beat);
    if (beat === null) continue;
    if (e.kind === 'tick') {
      const playheads = e.playheads as Record<string, unknown> | undefined;
      const pos = num(playheads?.[String(slot)]);
      if (pos !== null) out.push({ beat, pos });
    } else if ((e.kind === 'transport' || e.kind === 'loop') && e.slot === slot) {
      const pos = num(e.playhead);
      if (pos !== null) out.push({ beat, pos });
    }
  }
  out.sort((a, b) => a.beat - b.beat);
  // Dedupe near-coincident samples (a transport event inside a tick's
  // instant): the LATER sample wins (post-action position).
  const dedup: { beat: number; pos: number }[] = [];
  for (const s of out) {
    const prev = dedup[dedup.length - 1];
    if (prev && s.beat - prev.beat < 1e-6) dedup[dedup.length - 1] = s;
    else dedup.push(s);
  }
  return dedup;
}

/** Classify a slot's samples into the replay trace. `syncRate` is the
 * slot's beatmatched track-sec/beat (60 / trackBpm). */
export function buildSlotTrace(
  samples: { beat: number; pos: number }[],
  syncRate: number,
  entryBeat: number,
  entryPos: number
): RoutineTracePoint[] {
  const pts = [...samples];
  // Anchor the official entry mark unless a sample already sits there.
  if (!pts.some((p) => Math.abs(p.beat - entryBeat) < 0.5)) {
    pts.push({ beat: entryBeat, pos: entryPos });
    pts.sort((a, b) => a.beat - b.beat);
  }
  const trace: RoutineTracePoint[] = pts.map((p) => ({
    beat: p.beat,
    pos: p.pos,
    jump: false,
    moving: false,
    ratePerBeat: 0,
  }));
  let lastMovingRate = syncRate;
  for (let i = 0; i < trace.length - 1; i++) {
    const a = trace[i];
    const b = trace[i + 1];
    const db = b.beat - a.beat;
    const dp = b.pos - a.pos;
    if (db <= 0) continue;
    const rate = dp / db;
    if (rate >= MOVING_MIN * syncRate && rate <= MOVING_MAX * syncRate) {
      a.moving = true;
      a.ratePerBeat = rate;
      lastMovingRate = rate;
    } else if (Math.abs(dp) <= PAUSE_EPS_SEC) {
      a.moving = false;
      a.ratePerBeat = 0;
    } else {
      // Discontinuity (seek, beat jump, loop wrap, hot cue): keep the
      // prior motion up to the jump instant, then snap.
      b.jump = true;
      const prev = trace[i - 1];
      a.moving = prev?.moving ?? false;
      a.ratePerBeat = a.moving ? lastMovingRate : 0;
    }
  }
  // Simplify moving runs (#161 finding 4): raw per-segment slopes carry
  // tick-sampling jitter (±1-2% rate noise over ~1s segments) — replayed
  // literally they warble the deck pitch AND wiggle the position target,
  // which the Conductor's servo then chases. Douglas-Peucker inside each
  // jump-free moving run keeps endpoints and real ride inflections,
  // drops the jitter; slopes recompute endpoint-exact.
  const simplified = simplifyMovingRuns(trace);
  // The final point inherits the last segment's motion for extrapolation
  // past the end.
  if (simplified.length >= 2) {
    const last = simplified[simplified.length - 1];
    const prev = simplified[simplified.length - 2];
    last.moving = prev.moving;
    last.ratePerBeat = prev.moving ? prev.ratePerBeat : 0;
  }
  return simplified;
}

/** Douglas-Peucker over each maximal jump-free MOVING run: intermediate
 * samples within TRACE_SIMPLIFY_EPS_SEC of the kept line are jitter and
 * drop out; kept segments get endpoint-exact rates. Non-moving points,
 * jump landings, and run boundaries always survive. */
function simplifyMovingRuns(trace: RoutineTracePoint[]): RoutineTracePoint[] {
  if (trace.length < 3) return trace;
  const keep = new Array<boolean>(trace.length).fill(false);
  keep[0] = true;
  keep[trace.length - 1] = true;
  const dp = (lo: number, hi: number): void => {
    // Keep the farthest-from-the-chord point if it exceeds epsilon.
    if (hi - lo < 2) return;
    const a = trace[lo];
    const b = trace[hi];
    const db = b.beat - a.beat || 1e-9;
    let worst = -1;
    let worstDev = TRACE_SIMPLIFY_EPS_SEC;
    for (let k = lo + 1; k < hi; k++) {
      const f = (trace[k].beat - a.beat) / db;
      const dev = Math.abs(trace[k].pos - (a.pos + (b.pos - a.pos) * f));
      if (dev > worstDev) {
        worstDev = dev;
        worst = k;
      }
    }
    if (worst >= 0) {
      keep[worst] = true;
      dp(lo, worst);
      dp(worst, hi);
    }
  };
  // Walk maximal runs of consecutive MOVING segments with no jump inside.
  let runStart: number | null = null;
  for (let i = 0; i < trace.length; i++) {
    const inRun =
      i < trace.length - 1 && trace[i].moving && !trace[i + 1].jump && trace[i].ratePerBeat > 0;
    if (inRun && runStart === null) runStart = i;
    if (!inRun) {
      if (runStart !== null && i > runStart) {
        keep[runStart] = true;
        keep[i] = true;
        dp(runStart, i);
      } else {
        keep[i] = true;
      }
      runStart = null;
      keep[i] = true;
    }
  }
  const out: RoutineTracePoint[] = [];
  for (let i = 0; i < trace.length; i++) if (keep[i]) out.push({ ...trace[i] });
  // Endpoint-exact slopes on the kept segments (moving ones only).
  for (let i = 0; i < out.length - 1; i++) {
    const a = out[i];
    const b = out[i + 1];
    if (a.moving && !b.jump && b.beat > a.beat) {
      a.ratePerBeat = (b.pos - a.pos) / (b.beat - a.beat);
    }
  }
  return out;
}

export interface TraceState {
  pos: number;
  moving: boolean;
  ratePerBeat: number;
}

/** The trace's verdict at a Routine beat: position (track seconds),
 * whether the deck advances, and at what rate. */
export function traceStateAt(trace: RoutineTracePoint[], beat: number): TraceState {
  if (trace.length === 0) return { pos: 0, moving: false, ratePerBeat: 0 };
  if (beat <= trace[0].beat) return { pos: trace[0].pos, moving: false, ratePerBeat: 0 };
  // Binary search: the last point at or before `beat`.
  let lo = 0;
  let hi = trace.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (trace[mid].beat <= beat) lo = mid;
    else hi = mid - 1;
  }
  const p = trace[lo];
  const next = trace[lo + 1];
  if (!next) {
    return {
      pos: p.pos + (p.moving ? p.ratePerBeat * (beat - p.beat) : 0),
      moving: p.moving,
      ratePerBeat: p.ratePerBeat,
    };
  }
  if (next.jump) {
    // Ride the prior motion to the jump instant; the snap lands there.
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

// ── Lane building ────────────────────────────────────────────────────────

const LANE_CONTROLS = ['fader', 'eqLow', 'eqMid', 'eqHigh', 'filter'] as const;
type LaneControl = (typeof LANE_CONTROLS)[number];

export function buildSlotLanes(events: RoutineEventInput[], slot: number, isSlotZero: boolean): RoutineSlotLanes {
  const lanes: Record<LaneControl, RoutineLanePoint[]> = {
    fader: [],
    eqLow: [],
    eqMid: [],
    eqHigh: [],
    filter: [],
  };
  for (const e of events) {
    if (e.kind !== 'control' || e.slot !== slot) continue;
    const control = e.control as LaneControl;
    if (!LANE_CONTROLS.includes(control)) continue;
    const beat = num(e.beat);
    const value = num(e.value);
    if (beat === null || value === null) continue;
    lanes[control].push({ beat, value });
  }
  for (const c of LANE_CONTROLS) lanes[c].sort((a, b) => a.beat - b.beat);
  return {
    ...lanes,
    defaults: {
      // Slot 0 sounds at adoption. A later slot with recorded fader moves
      // starts closed (the raise is its entry); one with none was audible
      // through the whole slice — open from its entry.
      fader: isSlotZero || lanes.fader.length === 0 ? 1 : 0,
      eq: 0.5,
      filter: 0,
    },
  };
}

function laneValueAt(points: RoutineLanePoint[], beat: number, fallback: number): number {
  if (points.length === 0 || beat < points[0].beat) return fallback;
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (points[mid].beat <= beat) lo = mid;
    else hi = mid - 1;
  }
  return points[lo].value;
}

/** The slot's recorded mixer lanes at a Routine beat (mixer domain —
 * planner PlanAutomation shape, structurally). */
export function slotLanesAt(
  slot: PlannedRoutineSlot,
  beat: number
): { fader: number; eq: { low: number; mid: number; high: number }; filter: number } {
  const l = slot.lanes;
  return {
    fader: laneValueAt(l.fader, beat, l.defaults.fader),
    eq: {
      low: laneValueAt(l.eqLow, beat, l.defaults.eq),
      mid: laneValueAt(l.eqMid, beat, l.defaults.eq),
      high: laneValueAt(l.eqHigh, beat, l.defaults.eq),
    },
    filter: laneValueAt(l.filter, beat, l.defaults.filter),
  };
}

// ── Deck allocation ──────────────────────────────────────────────────────

/** Slot 0 adopts; each later slot takes the first deck in A→B→C→D order
 * that no earlier slot holds and no external occupant still needs at the
 * slot's entry instant. No mid-Routine release (v1). */
export function allocateRoutineDecks(
  entryMixSecs: number[],
  adoptedDeck: RoutineDeck,
  busy: { deck: RoutineDeck; untilMixSec: number }[]
): (RoutineDeck | null)[] {
  const held = new Set<RoutineDeck>([adoptedDeck]);
  const out: (RoutineDeck | null)[] = [adoptedDeck];
  for (let slot = 1; slot < entryMixSecs.length; slot++) {
    const entry = entryMixSecs[slot];
    const deck =
      ROUTINE_DECK_ORDER.find(
        (d) => !held.has(d) && !busy.some((b) => b.deck === d && b.untilMixSec > entry)
      ) ?? null;
    if (deck) held.add(deck);
    out.push(deck);
  }
  return out;
}

// ── The whole build ──────────────────────────────────────────────────────

const clampPitch = (p: number): number =>
  Math.max(-MAX_PITCH_RANGE_PERCENT, Math.min(MAX_PITCH_RANGE_PERCENT, p));

export function buildPlannedRoutine(
  input: RoutinePlanInput,
  ctx: BuildRoutineContext
): { routine: PlannedRoutine; warnings: RoutineBuildWarning[] } {
  const warnings: RoutineBuildWarning[] = [];
  const n = input.cast.length;
  const secPerBeat = 60 / ctx.targetBpm;
  const entryMixSecs = input.entryOffsetsBeats.map((b) => ctx.mixStartSec + b * secPerBeat);
  const mixEndSec = ctx.mixStartSec + input.durationBeats * secPerBeat;

  const decks = allocateRoutineDecks(entryMixSecs, ctx.adoptedDeck, ctx.busy);
  const overflow = decks
    .map((d, slot) => (d === null ? slot : null))
    .filter((s): s is number => s !== null);
  if (overflow.length > 0) {
    warnings.push({
      severity: 'error',
      kind: 'routine-deck-overflow',
      message: `routine needs ${n} concurrent decks but only ${n - overflow.length} are free — slot${overflow.length > 1 ? 's' : ''} ${overflow.join(', ')} cannot sound`,
    });
  }

  const slots: PlannedRoutineSlot[] = input.cast.map((trackId, slot) => {
    const bpm = ctx.trackBpms[slot];
    const syncRate = 60 / bpm;
    const basePitchPercent = clampPitch((ctx.targetBpm / bpm - 1) * 100);
    const trace = buildSlotTrace(
      slotSamples(input.events, slot),
      syncRate,
      input.entryOffsetsBeats[slot],
      input.entryPositions[slot]
    );
    return {
      slot,
      trackId,
      deck: decks[slot],
      entryMixSec: entryMixSecs[slot],
      entryTrackSec: input.entryPositions[slot],
      basePitchPercent,
      trace,
      lanes: buildSlotLanes(input.events, slot, slot === 0),
      jumpMixSecs: trace
        .filter((p) => p.jump)
        .map((p) => ctx.mixStartSec + p.beat * secPerBeat)
        .sort((a, b) => a - b),
    };
  });

  // Global (slot-null) controls — crossfader, master — cannot be
  // re-addressed onto remapped decks (promotion drops the deck→side
  // assignment); mechanical v1 drops them. Flag when the recording
  // leaned on any.
  const dropped = input.events.filter(
    (e) => e.kind === 'control' && (e.slot === null || e.slot === undefined)
  ).length;
  if (dropped > 0) {
    warnings.push({
      severity: 'warning',
      kind: 'routine-global-controls-dropped',
      message: `${dropped} global mixer event${dropped > 1 ? 's' : ''} (crossfader/master) in the recording are not replayed — per-slot faders carry the mix`,
    });
  }

  // Exit: the last cast slot keeps sounding past the Routine end (the
  // boundary contract) — force its trailing motion so the handoff never
  // parks on a flat final tick.
  const exitSlot = slots[n - 1];
  const exitTrace = exitSlot.trace;
  if (exitTrace.length > 0) {
    const last = exitTrace[exitTrace.length - 1];
    if (!last.moving) {
      last.moving = true;
      // Beatmatched advance is tempo-invariant in beat domain: one track
      // beat per Routine beat = 60/trackBpm track-seconds per beat.
      last.ratePerBeat = 60 / ctx.trackBpms[n - 1];
    }
  }
  const trackSecAtEnd = Math.max(0, traceStateAt(exitTrace, input.durationBeats).pos);

  // Routine-wide list kept for whole-plan queries (per-deck hard-sync
  // scoping reads the slots' own lists — #161).
  const jumpMixSecs: number[] = slots.flatMap((s) => s.jumpMixSecs).sort((a, b) => a - b);

  return {
    routine: {
      startEntryIndex: ctx.startEntryIndex,
      mixStartSec: ctx.mixStartSec,
      mixEndSec,
      targetBpm: ctx.targetBpm,
      secPerBeat,
      slots,
      exit: {
        slot: n - 1,
        deck: exitSlot.deck ?? ctx.adoptedDeck,
        trackId: exitSlot.trackId,
        trackSecAtEnd,
        pitchPercent: exitSlot.basePitchPercent,
      },
      jumpMixSecs,
    },
    warnings,
  };
}

// ── Replay evaluation ────────────────────────────────────────────────────

export interface RoutineSlotState {
  trackTime: number;
  playing: boolean;
  pitchPercent: number;
}

/** One slot's deck verdict at a mix instant inside the Routine span. */
export function routineSlotStateAt(
  routine: PlannedRoutine,
  slot: PlannedRoutineSlot,
  mixTime: number
): RoutineSlotState {
  const beat = (mixTime - routine.mixStartSec) / routine.secPerBeat;
  const t = traceStateAt(slot.trace, beat);
  if (!t.moving) {
    return {
      trackTime: Math.max(0, t.pos),
      playing: false,
      pitchPercent: slot.basePitchPercent,
    };
  }
  // A negative trace position is the recording's silent lead (the deck
  // rolled before the track's time 0 — entry lead gaps allowed, ADR
  // 0035): replay parks the deck at 0 and starts it when the recorded
  // position crosses 0 — clamping while "playing" would make the servo
  // fight a pinned target (#161 finding 4, the s49 Like A G6 entry).
  if (t.pos < 0) {
    return { trackTime: 0, playing: false, pitchPercent: slot.basePitchPercent };
  }
  // Re-anchored pitch: EXACTLY the deck rate reproducing this trace
  // segment at the target tempo — pitch and position derivative agree by
  // construction (#161 finding 4: the old base-pitch snap made the deck
  // play a rate its own position target didn't, so drift accrued and the
  // Conductor seeked it back every few seconds — the audible desync).
  // Segment slopes are already noise-free (simplifyMovingRuns), so a
  // beatmatched passage reads as one steady rate ≈ base; genuine rides
  // follow the recording. Varispeed clamp is the only discretion.
  const deckRate = t.ratePerBeat / routine.secPerBeat;
  return {
    trackTime: t.pos,
    playing: true,
    pitchPercent: clampPitch((deckRate - 1) * 100),
  };
}
