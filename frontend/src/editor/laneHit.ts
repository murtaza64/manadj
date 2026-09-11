import type { LanePoint } from './mixModel';

export const LANE_GRAB_PX = 13;
export const LANE_LINE_PX = 6;
export const LANE_SNAP_PX = 6;

export function laneValueY(value: number, height: number): number {
  if (!(height > 0) || !Number.isFinite(height)) return 0;
  const inset = Math.min(8, height / 4);
  return inset + (1 - value) * (height - 2 * inset);
}

/** Unclamped pointer coordinate; callers clamp final node values, not rectangles. */
export function laneYValue(y: number, height: number): number {
  if (!(height > 0) || !Number.isFinite(height)) return 0;
  const inset = Math.min(8, height / 4);
  return 1 - (y - inset) / (height - 2 * inset);
}

/** The drawn path, including endpoint holds and translated off-window points. */
export function lanePolyline(points: LanePoint[], defaultValue: number): LanePoint[] {
  return [
    { x: 0, y: points[0]?.y ?? defaultValue },
    ...points,
    { x: 1, y: points[points.length - 1]?.y ?? defaultValue },
  ];
}

/** Coordinates are CSS pixels: x excludes the canvas pad, y includes the inset.
 * Absent node/insertion indices are -1. Points retain their drawn order. */
export function hitLane(
  points: LanePoint[],
  x: number,
  y: number,
  width: number,
  height: number,
  defaultValue: number,
  snapXs: readonly number[] = [],
): { nearestIndex: number; insertion: LanePoint | null; insertionIndex: number } {
  const miss = { nearestIndex: -1, insertion: null, insertionIndex: -1 };
  if (!(width > 0 && height > 0) || ![x, y, width, height].every(Number.isFinite)) return miss;

  let nearestIndex = -1;
  let nodeDistance = Infinity;
  points.forEach((point, i) => {
    const distance = Math.hypot(x - point.x * width, y - laneValueY(point.y, height));
    if (distance <= LANE_GRAB_PX && distance < nodeDistance) {
      nearestIndex = i;
      nodeDistance = distance;
    }
  });
  if (nearestIndex !== -1) return { ...miss, nearestIndex };

  const ext = lanePolyline(points, defaultValue);
  let insertion: LanePoint | null = null;
  let insertionIndex = -1;
  let lineDistance = Infinity;
  for (let i = 0; i < ext.length - 1; i++) {
    const a = ext[i];
    const b = ext[i + 1];
    const ax = a.x * width;
    const ay = laneValueY(a.y, height);
    const dx = (b.x - a.x) * width;
    const dy = laneValueY(b.y, height) - ay;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / lengthSq));
    const distance = Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
    if (distance <= LANE_LINE_PX && distance < lineDistance) {
      insertion = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
      insertionIndex = i;
      lineDistance = distance;
    }
  }
  if (!insertion) return miss;
  const a = ext[insertionIndex];
  const b = ext[insertionIndex + 1];
  if (a.x !== b.x) {
    let snapX: number | null = null;
    let snapDistance = Infinity;
    for (const guide of snapXs) {
      if (guide < Math.min(a.x, b.x) || guide > Math.max(a.x, b.x)) continue;
      const distance = Math.abs(guide * width - insertion.x * width);
      // Keep the six-pixel boundary inclusive after normalized-to-pixel rounding.
      if (distance <= LANE_SNAP_PX + 1e-9 && distance < snapDistance) {
        snapX = guide;
        snapDistance = distance;
      }
    }
    if (snapX !== null) {
      const t = (snapX - a.x) / (b.x - a.x);
      insertion = { x: snapX, y: t === 0 ? a.y : t === 1 ? b.y : a.y + t * (b.y - a.y) };
    }
  }
  const candidate = insertion;
  nearestIndex = points.findIndex((point) => point.x === candidate.x && point.y === candidate.y);
  return nearestIndex === -1
    ? { nearestIndex, insertion, insertionIndex }
    : { ...miss, nearestIndex };
}
