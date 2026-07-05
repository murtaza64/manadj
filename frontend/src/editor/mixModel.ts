/**
 * Transition-editor domain model (pure — under vitest).
 *
 * Seconds-based, two tracks, one Transition (ADR 0010). Lanes are
 * piecewise-linear breakpoints on a normalized 0..1 x-axis over the
 * transition's duration. Includes the chop stamp, crop remaps, and the
 * deck-slide math (PRD quadrant table).
 */

export interface LanePoint {
  /** 0..1 position within the transition. */
  x: number;
  /** 0..1 control value (faders: gain; EQ: 0=kill 0.5=flat 1=+6dB; filter: 0.5=off). */
  y: number;
}

export const LANE_IDS = [
  'faderA',
  'faderB',
  'eqLowA',
  'eqLowB',
  'eqMidA',
  'eqMidB',
  'eqHighA',
  'eqHighB',
  'filterA',
  'filterB',
] as const;
export type LaneId = (typeof LANE_IDS)[number];

export const DEFAULT_LANE_IDS: LaneId[] = [
  'faderA',
  'faderB',
  'eqLowA',
  'eqLowB',
  'filterA',
  'filterB',
];

export type Lanes = Partial<Record<LaneId, LanePoint[]>>;

/** A Jump event (glossary; ADR 0020, transition-takes 01): a playback
 * discontinuity of the INCOMING track — at a mix instant, B's playhead
 * jumps by `deltaSec` of its own track time (negative = back, e.g.
 * doubling a buildup). Incoming-only: the Sketch origin invariant (A's
 * track time ≡ mix time) is untouched. The instant lives on the mix axis
 * as a normalized window position, like LanePoint.x; the array is
 * order-insensitive (indices stay stable across x drags). */
export interface JumpEvent {
  /** 0..1 position within the transition window. */
  x: number;
  /** Jump distance in B's OWN seconds (+ = forward, − = back/replay). */
  deltaSec: number;
}

export interface Transition {
  /** Mix-time (s) when the transition window begins. The only clamp in the
   * model: startSec ≥ 0 (a transition can't begin before A exists). */
  startSec: number;
  durationSec: number;
  /** B's track-time at the window start (s). Pair knowledge — lives on the
   * Transition so it switches with the named artifact (issue 11). Negative
   * = silent lead gap (B's audio begins partway into the window); large
   * positive = virtual content-origin before mix 0. No clamps either way. */
  bInSec: number;
  /** BPM-match the incoming track to the outgoing for the whole mix. */
  tempoMatch: boolean;
  lanes: Lanes;
  /** Jump events on the incoming track (absent/empty = none). */
  jumps?: JumpEvent[];
  /** Lanes removed from the editor (any lane is removable, defaults too).
   * Hidden lanes keep their drawn envelope in `lanes` — re-adding restores
   * it — but read as their DEFAULT value during playback (an invisible
   * bass-kill still ducking the mix would be a lie). */
  hiddenLanes?: LaneId[];
}

export interface EditorMix {
  trackAId: number | null;
  trackBId: number | null;
  transition: Transition;
}

export function defaultMix(): EditorMix {
  return {
    trackAId: null,
    trackBId: null,
    transition: {
      startSec: 30,
      durationSec: 20,
      bInSec: 0,
      tempoMatch: true,
      lanes: {},
    },
  };
}

/** Default lane shapes when the user hasn't drawn one: flat single-point
 * envelopes (faderA full, EQs/filters neutral 0.5 — evalLane holds a lone
 * point's value everywhere), except faderB which ramps 0→full over the
 * first 2 SECONDS of the window (hence `durationSec` for the normalized
 * x). A stays audible throughout; B fades in quickly and rides at full. */
export function defaultLanePoints(id: LaneId, durationSec: number): LanePoint[] {
  switch (id) {
    case 'faderA':
      return [{ x: 0, y: 1 }];
    case 'faderB':
      return [
        { x: 0, y: 0 },
        { x: durationSec > 2 ? 2 / durationSec : 1, y: 1 },
      ];
    default:
      // EQ flat / filter centered.
      return [{ x: 0, y: 0.5 }];
  }
}

export function lanePoints(lanes: Lanes, id: LaneId, durationSec: number): LanePoint[] {
  const pts = lanes[id];
  return pts && pts.length > 0 ? pts : defaultLanePoints(id, durationSec);
}

/** Lanes shown in the editor: defaults + drawn-on, minus hidden (issue 05). */
export function visibleLaneIds(tr: Transition): LaneId[] {
  const drawn = Object.keys(tr.lanes) as LaneId[];
  const hidden = new Set(tr.hiddenLanes ?? []);
  return [...new Set([...DEFAULT_LANE_IDS, ...drawn])].filter((id) => !hidden.has(id));
}

/** Piecewise-linear evaluation at normalized x. Points must be x-sorted. */
export function evalLane(points: LanePoint[], x: number): number {
  if (points.length === 0) return 0.5;
  if (x <= points[0].x) return points[0].y;
  const last = points[points.length - 1];
  if (x >= last.x) return last.y;
  for (let i = 1; i < points.length; i++) {
    if (x <= points[i].x) {
      const a = points[i - 1];
      const b = points[i];
      const span = b.x - a.x;
      const t = span <= 0 ? 1 : (x - a.x) / span;
      return a.y + (b.y - a.y) * t;
    }
  }
  return last.y;
}

/** All lane values at mix-time t, given the transition. x is clamped, so
 * before the transition every lane reads its first value and after it its
 * last — "keep last drawn value" semantics. */
export function laneValuesAt(transition: Transition, mixTime: number): Record<LaneId, number> {
  const x =
    transition.durationSec <= 0
      ? mixTime < transition.startSec
        ? 0
        : 1
      : (mixTime - transition.startSec) / transition.durationSec;
  const out = {} as Record<LaneId, number>;
  for (const id of LANE_IDS) {
    const points = transition.hiddenLanes?.includes(id)
      ? defaultLanePoints(id, transition.durationSec)
      : lanePoints(transition.lanes, id, transition.durationSec);
    out[id] = evalLane(points, x);
  }
  return out;
}

/**
 * Deck activity/positions at mix-time t. `rateB` is B's playback rate
 * (varispeed from tempo match): B's track-time advances at rateB per mix
 * second, so its mix-time footprint is durationInB / rateB.
 */
export function arrangementAt(
  mix: EditorMix,
  mixTime: number,
  durations: { a: number; b: number },
  rateB: number = 1
): {
  aActive: boolean;
  aTrackTime: number;
  bActive: boolean;
  bTrackTime: number;
  mixDuration: number;
} {
  const tr = mix.transition;
  const aEnd = Math.min(tr.startSec + tr.durationSec, durations.a);
  const bTrackTime = bTrackTimeAt(tr, mixTime, rateB);
  const bEnd = bEndMixTime(tr, durations.b, rateB);
  return {
    aActive: mixTime >= 0 && mixTime < aEnd,
    aTrackTime: mixTime,
    // bTrackTime ≥ 0 defers B past a negative entry anchor's silent lead
    // gap (and past a mid-window jump below B's start): the deck stays
    // inactive until B's audio (re)starts. B's FIRST end is its end —
    // mixTime < bEnd, which without jumps is exactly bTrackTime < durB.
    bActive: mixTime >= tr.startSec && bTrackTime >= 0 && mixTime < bEnd,
    bTrackTime,
    mixDuration: Math.max(aEnd, bEnd),
  };
}

// ── Deck slides (issue 11) ─────────────────────────────────────────────
// A Slide realigns the pair: it re-cues exactly one deck and never moves
// the playhead's mix position. The lock chooses which track the window
// sticks to. PRD § Deck slides — the quadrant table is the spec.

/** A jump's instant on the mix axis. */
export function jumpInstantSec(
  tr: Pick<Transition, 'startSec' | 'durationSec'>,
  j: JumpEvent
): number {
  return tr.startSec + j.x * tr.durationSec;
}

/** B's track-time under the playhead at mix-time t: linear in rateB, plus
 * the deltas of every Jump event whose instant has passed (piecewise —
 * transition-takes 01). */
export function bTrackTimeAt(
  tr: Pick<Transition, 'startSec' | 'bInSec' | 'durationSec' | 'jumps'>,
  mixTime: number,
  rateB: number
): number {
  let t = tr.bInSec + (mixTime - tr.startSec) * rateB;
  for (const j of tr.jumps ?? []) {
    if (mixTime >= jumpInstantSec(tr, j)) t += j.deltaSec;
  }
  return t;
}

/** One linear stretch of audible B content on the mix axis (transition-
 * takes 06): between Jump events, B advances at rateB from `bStartSec`.
 * The DAW-splice rendering, overlays, guides, and hit zones all map
 * through these. */
export interface BContentSegment {
  mixStartSec: number;
  mixEndSec: number;
  /** B's track time at mixStartSec. */
  bStartSec: number;
}

/**
 * THE piecewise walk (single source): linear spans between Jump events,
 * clipped to audible content — entry deferred while b < 0 (lead gaps and
 * below-zero jumps), exit at B's FIRST durB crossing (first end is the
 * end; a jump firing exactly at the crossing wins — bTrackTimeAt applies
 * deltas AT their instants). Returns the active segments and B's end on
 * the mix axis; `bContentSegments`/`bEndMixTime` are its two views.
 */
function walkB(
  tr: Pick<Transition, 'startSec' | 'bInSec' | 'durationSec' | 'jumps'>,
  durB: number,
  rateB: number
): { segments: BContentSegment[]; endMixSec: number } {
  const jumps = [...(tr.jumps ?? [])].sort((a, b) => a.x - b.x);
  const segments: BContentSegment[] = [];
  let t0 = tr.startSec;
  let b0 = tr.bInSec;

  /** Emit the active sub-span of the linear span [t0, spanEnd) and report
   * where it ends ({done} when durB was crossed strictly inside it). */
  const linear = (spanEnd: number): { end: number; done: boolean } => {
    if (b0 >= durB) return { end: spanEnd, done: false }; // dead span (bInSec past the end)
    const entry = b0 < 0 ? t0 + -b0 / rateB : t0;
    const tHit = t0 + (durB - b0) / rateB;
    const done = tHit < spanEnd;
    const end = done ? tHit : spanEnd;
    if (end > entry) {
      segments.push({ mixStartSec: entry, mixEndSec: end, bStartSec: Math.max(0, b0) });
    }
    return { end, done };
  };

  for (const j of jumps) {
    const tj = jumpInstantSec(tr, j);
    if (tj > t0) {
      const r = linear(tj);
      if (r.done) return { segments, endMixSec: r.end };
      b0 += (tj - t0) * rateB;
      t0 = tj;
    }
    b0 += j.deltaSec;
    if (b0 >= durB) return { segments, endMixSec: t0 };
  }
  if (b0 >= durB) return { segments, endMixSec: t0 + (durB - b0) / rateB };
  return { segments, endMixSec: linear(Infinity).end };
}

/** B's audible content as mix-axis segments (transition-takes 06). */
export function bContentSegments(
  tr: Pick<Transition, 'startSec' | 'bInSec' | 'durationSec' | 'jumps'>,
  durB: number,
  rateB: number
): BContentSegment[] {
  return walkB(tr, durB, rateB).segments;
}

/**
 * Mix-time when B's audio ends: the FIRST instant its track time reaches
 * durB. A forward jump past the end ends B at that instant; a backward
 * jump can extend B's mix-time footprint (a replayed stretch plays
 * twice). Without jumps this is the plain `startSec + (durB − bInSec)/rateB`.
 */
export function bEndMixTime(
  tr: Pick<Transition, 'startSec' | 'bInSec' | 'durationSec' | 'jumps'>,
  durB: number,
  rateB: number
): number {
  return walkB(tr, durB, rateB).endMixSec;
}

/**
 * Slide deck B by `deltaB` seconds of B's OWN track time (+ = B's content
 * later under the playhead, i.e. re-cue forward). Unlocked, the window
 * stays with A and `bInSec` absorbs the slide; locked, the window rides
 * B — `startSec` moves by the mix-time equivalent (÷rateB) and the same B
 * audio stays under the window. `startSec ≥ 0` is the only clamp.
 */
export function slideB(
  tr: Transition,
  deltaB: number,
  locked: boolean,
  rateB: number
): { startSec: number; bInSec: number } {
  if (locked) {
    return { startSec: Math.max(0, tr.startSec - deltaB / rateB), bInSec: tr.bInSec };
  }
  return { startSec: tr.startSec, bInSec: tr.bInSec + deltaB };
}

/** Slide deck B so `cueSec` (B track time) lands under the playhead. */
export function slideBToCue(
  tr: Transition,
  cueSec: number,
  playheadMix: number,
  locked: boolean,
  rateB: number
): { startSec: number; bInSec: number } {
  return slideB(tr, cueSec - bTrackTimeAt(tr, playheadMix, rateB), locked, rateB);
}

// Deck A has no slide math: A is pinned to the sketch origin and its track
// time ≡ mix time, so A-side "slides" would only mirror B's (the PRD
// equivalences). Decided 2026-07-03: deck A's editor controls are plain
// TRANSPORT instead — hot cue / beat jump move the playhead (player.seek).

/**
 * Remap drawn lanes for a duration change with CROP semantics: points keep
 * their absolute time positions. Shrinking drops points past the new end and
 * pins the boundary value at x=1; growing compresses points leftward (the
 * keep-last extension holds the tail). Stretch semantics need no remap —
 * normalized points scale with the region by construction.
 */
export function cropRemapLanes(lanes: Lanes, oldDur: number, newDur: number): Lanes {
  if (oldDur <= 0 || newDur <= 0) return lanes;
  const factor = oldDur / newDur;
  const out: Lanes = {};
  for (const [id, pts] of Object.entries(lanes) as [LaneId, LanePoint[]][]) {
    if (!pts || pts.length === 0) continue;
    const mapped = pts
      .map((p) => ({ x: p.x * factor, y: p.y }))
      .filter((p) => p.x <= 1);
    if (mapped.length < pts.length) {
      // Something was cut off: pin the value at the new end.
      mapped.push({ x: 1, y: evalLane(pts, newDur / oldDur) });
    }
    if (mapped.length === 0) {
      mapped.push({ x: 1, y: evalLane(pts, newDur / oldDur) });
    }
    out[id] = mapped;
  }
  return out;
}

/** CROP remap for Jump events, right-edge resize: instants keep their
 * absolute time; jumps past the new end drop (nothing to pin — a jump is
 * an instant, not an envelope). Stretch semantics need no remap. */
export function cropRemapJumps(
  jumps: JumpEvent[] | undefined,
  oldDur: number,
  newDur: number
): JumpEvent[] | undefined {
  if (!jumps || jumps.length === 0 || oldDur <= 0 || newDur <= 0) return jumps;
  return jumps
    .map((j) => ({ ...j, x: (j.x * oldDur) / newDur }))
    .filter((j) => j.x <= 1);
}

/** CROP remap for Jump events, LEFT-edge resize (start moves, end
 * anchored): absolute time kept, jumps cut off the front drop. */
export function cropRemapJumpsLeft(
  jumps: JumpEvent[] | undefined,
  oldDur: number,
  newDur: number
): JumpEvent[] | undefined {
  if (!jumps || jumps.length === 0 || oldDur <= 0 || newDur <= 0) return jumps;
  const deltaSec = oldDur - newDur; // > 0 when shrinking from the left
  return jumps
    .map((j) => ({ ...j, x: (j.x * oldDur - deltaSec) / newDur }))
    .filter((j) => j.x >= 0 && j.x <= 1);
}

/**
 * CROP remap for a LEFT-edge resize (transition start moves, end anchored):
 * points keep their absolute time. Shrinking from the left drops points
 * before the new start and pins the boundary value at x=0; growing extends
 * with the keep-first value.
 */
export function cropRemapLanesLeft(lanes: Lanes, oldDur: number, newDur: number): Lanes {
  if (oldDur <= 0 || newDur <= 0) return lanes;
  const deltaSec = oldDur - newDur; // > 0 when shrinking from the left
  const out: Lanes = {};
  for (const [id, pts] of Object.entries(lanes) as [LaneId, LanePoint[]][]) {
    if (!pts || pts.length === 0) continue;
    const mapped = pts
      .map((p) => ({ x: (p.x * oldDur - deltaSec) / newDur, y: p.y }))
      .filter((p) => p.x >= 0);
    if (mapped.length < pts.length || mapped.length === 0) {
      // Something was cut off the front: pin the value at the new start.
      mapped.unshift({ x: 0, y: evalLane(pts, deltaSec / oldDur) });
    }
    out[id] = mapped;
  }
  return out;
}

/**
 * Stamp a rectangular full-cut into a lane between normalized x1 and x2
 * (beat positions): the value drops to 0 with near-vertical walls and
 * recovers to the pre-cut curve at the far edge. Each wall is CENTERED on
 * its edge — the cut-out opens wall/2 before x1 (killing the transient of
 * the beat on the line, not the tail of the note before it) and closes
 * wall/2 after x2. Pure LanePoint insertion — the 4 stamped points are
 * ordinary breakpoints (draggable/deletable); interior points are removed.
 * Argument order is normalized; spans narrower than one wall are a no-op.
 */
export function insertChop(
  points: LanePoint[],
  x1: number,
  x2: number,
  wall = 0.004
): LanePoint[] {
  const c1 = Math.min(x1, x2);
  const c2 = Math.max(x1, x2);
  if (c2 - c1 <= wall) return points;
  const half = wall / 2;
  const lo = Math.max(0, c1 - half);
  const hi = Math.min(1, c2 + half);
  const loIn = Math.max(0, c1 + half);
  const hiIn = Math.min(1, c2 - half);
  const entryY = evalLane(points, lo);
  const exitY = evalLane(points, hi);
  const out = points.filter((p) => p.x < lo || p.x > hi);
  out.push(
    { x: lo, y: entryY },
    { x: loIn, y: 0 },
    { x: hiIn, y: 0 },
    { x: hi, y: exitY }
  );
  return out.sort((a, b) => a.x - b.x);
}

/** Nearest value in a sorted array (binary search), or null if empty. */
export function nearestTime(sorted: number[], t: number): number | null {
  if (sorted.length === 0) return null;
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  const after = sorted[lo];
  const before = lo > 0 ? sorted[lo - 1] : after;
  return Math.abs(before - t) <= Math.abs(after - t) ? before : after;
}

/** The editor's private player allows wider varispeed than the shared
 * decks' hardware-like ±8% (templates decision 2026-07-04): a template
 * implies tempo-match, and beat alignment should genuinely hold on
 * extreme pairs — it'll sound rough (the notice says so), but it's real.
 * Performance-view decks keep tempo.PITCH_RANGE_PERCENT. */
export const EDITOR_PITCH_RANGE_PERCENT = 25;

/** Pitch percent to BPM-match B to A, clamped to the editor's widened
 * varispeed range. */
export function tempoMatchPitch(bpmA: number | null, bpmB: number | null): number {
  if (!bpmA || !bpmB) return 0;
  const percent = (bpmA / bpmB - 1) * 100;
  return Math.max(-EDITOR_PITCH_RANGE_PERCENT, Math.min(EDITOR_PITCH_RANGE_PERCENT, percent));
}
