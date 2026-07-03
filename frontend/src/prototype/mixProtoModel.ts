/**
 * PROTOTYPE (mix-editor) — throwaway. Delete or absorb after the verdict.
 *
 * Question under test: does drawing transitions (breakpoint lanes over an
 * overlap region) feel right, and does deterministic playback of the drawn
 * mix sound convincing? (.scratch/mix-editor/PRD.md, ADR 0010)
 *
 * Model: seconds-based, two tracks, one Transition. Lanes are piecewise-linear
 * breakpoints on a normalized 0..1 x-axis over the transition's duration.
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

export const DEFAULT_LANE_IDS: LaneId[] = ['faderA', 'faderB', 'eqLowA', 'eqLowB'];

export type Lanes = Partial<Record<LaneId, LanePoint[]>>;

export interface ProtoTransition {
  /** Mix-time (s) when the incoming track enters and the transition begins. */
  startSec: number;
  durationSec: number;
  /** BPM-match the incoming track to the outgoing for the whole mix. */
  tempoMatch: boolean;
  lanes: Lanes;
}

export interface ProtoMix {
  trackAId: number | null;
  trackBId: number | null;
  /** Where B enters within B (s). A always plays from its start in this prototype. */
  bInSec: number;
  transition: ProtoTransition;
}

export function defaultMix(): ProtoMix {
  return {
    trackAId: null,
    trackBId: null,
    bInSec: 0,
    transition: {
      startSec: 30,
      durationSec: 20,
      tempoMatch: true,
      lanes: {},
    },
  };
}

/** Default lane shapes when the user hasn't drawn one. */
export function defaultLanePoints(id: LaneId): LanePoint[] {
  switch (id) {
    case 'faderA':
      return [
        { x: 0, y: 1 },
        { x: 1, y: 0 },
      ];
    case 'faderB':
      return [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ];
    default:
      // EQ flat / filter centered.
      return [
        { x: 0, y: 0.5 },
        { x: 1, y: 0.5 },
      ];
  }
}

export function lanePoints(lanes: Lanes, id: LaneId): LanePoint[] {
  const pts = lanes[id];
  return pts && pts.length > 0 ? pts : defaultLanePoints(id);
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
export function laneValuesAt(transition: ProtoTransition, mixTime: number): Record<LaneId, number> {
  const x =
    transition.durationSec <= 0
      ? mixTime < transition.startSec
        ? 0
        : 1
      : (mixTime - transition.startSec) / transition.durationSec;
  const out = {} as Record<LaneId, number>;
  for (const id of LANE_IDS) {
    out[id] = evalLane(lanePoints(transition.lanes, id), x);
  }
  return out;
}

/**
 * Deck activity/positions at mix-time t. `rateB` is B's playback rate
 * (varispeed from tempo match): B's track-time advances at rateB per mix
 * second, so its mix-time footprint is durationInB / rateB.
 */
export function arrangementAt(
  mix: ProtoMix,
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
  const bTrackTime = mix.bInSec + (mixTime - tr.startSec) * rateB;
  const bEndMixTime = tr.startSec + (durations.b - mix.bInSec) / rateB;
  return {
    aActive: mixTime >= 0 && mixTime < aEnd,
    aTrackTime: mixTime,
    bActive: mixTime >= tr.startSec && bTrackTime < durations.b,
    bTrackTime,
    mixDuration: Math.max(aEnd, bEndMixTime),
  };
}

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
 * Stamp a rectangular full-cut into a lane between normalized x1 and x2:
 * the value drops to 0 with near-vertical walls and recovers to the pre-cut
 * curve at the far edge. Pure LanePoint insertion — the 4 stamped points are
 * ordinary breakpoints (draggable/deletable); interior points are removed.
 * Argument order is normalized; spans too narrow for both walls are a no-op.
 */
export function insertChop(
  points: LanePoint[],
  x1: number,
  x2: number,
  wall = 0.004
): LanePoint[] {
  const lo = Math.max(0, Math.min(x1, x2));
  const hi = Math.min(1, Math.max(x1, x2));
  if (hi - lo <= wall * 2) return points;
  const entryY = evalLane(points, lo);
  const exitY = evalLane(points, hi);
  const out = points.filter((p) => p.x < lo || p.x > hi);
  out.push(
    { x: lo, y: entryY },
    { x: lo + wall, y: 0 },
    { x: hi - wall, y: 0 },
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

/** Pitch percent to BPM-match B to A, clamped to the deck's ±8% range. */
export function tempoMatchPitch(bpmA: number | null, bpmB: number | null): number {
  if (!bpmA || !bpmB) return 0;
  const percent = (bpmA / bpmB - 1) * 100;
  return Math.max(-8, Math.min(8, percent));
}
