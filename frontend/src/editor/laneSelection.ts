/**
 * Lane node group selection (mix-editor 16, pure — under vitest): rubber-band
 * membership, toggle, group move, and group delete for breakpoints within ONE
 * automation lane. Selection is an array of indices into the lane's x-sorted
 * points; per-lane only in v1 (the caller keys selection state by lane id so
 * cross-lane group time-shift stays possible later).
 */
import type { LanePoint } from './mixModel';

/** A rubber-band rect in normalized lane coords; corners may be unordered
 * (drag in any direction). */
export interface SelectRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Indices of the nodes inside the rect (border-inclusive), ascending. */
export function indicesInRect(points: LanePoint[], rect: SelectRect): number[] {
  const xLo = Math.min(rect.x0, rect.x1);
  const xHi = Math.max(rect.x0, rect.x1);
  const yLo = Math.min(rect.y0, rect.y1);
  const yHi = Math.max(rect.y0, rect.y1);
  const out: number[] = [];
  points.forEach((p, i) => {
    if (p.x >= xLo && p.x <= xHi && p.y >= yLo && p.y <= yHi) out.push(i);
  });
  return out;
}

/** Cmd/ctrl+click membership toggle. Result stays sorted. */
export function toggleIndex(selected: number[], index: number): number[] {
  return selected.includes(index)
    ? selected.filter((i) => i !== index)
    : [...selected, index].sort((a, b) => a - b);
}

/**
 * Move the selected nodes by ONE shared delta (shape preserved exactly),
 * clamped so the group stays inside the lane and no selected node passes an
 * unselected neighbor (clamp at collision — order never changes). Points must
 * be x-sorted; the result keeps the same order and indices.
 */
export function moveGroup(
  points: LanePoint[],
  selected: number[],
  dx: number,
  dy: number
): LanePoint[] {
  const sel = [...new Set(selected)].filter((i) => i >= 0 && i < points.length).sort((a, b) => a - b);
  if (sel.length === 0) return points;
  const isSel = new Set(sel);

  // x clamp: per maximal run of consecutive selected indices, the walls are
  // the nearest unselected neighbors (or the lane bounds). Walls sit outside
  // the run, so every run's range contains 0 — the intersection is nonempty.
  let dxLo = -Infinity;
  let dxHi = Infinity;
  for (let s = 0; s < sel.length; ) {
    let e = s;
    while (e + 1 < sel.length && sel[e + 1] === sel[e] + 1) e++;
    const a = sel[s];
    const b = sel[e];
    const leftWall = a > 0 ? points[a - 1].x : 0;
    const rightWall = b < points.length - 1 ? points[b + 1].x : 1;
    dxLo = Math.max(dxLo, leftWall - points[a].x);
    dxHi = Math.min(dxHi, rightWall - points[b].x);
    s = e + 1;
  }
  const cdx = Math.max(dxLo, Math.min(dxHi, dx));

  // y clamp: the whole group stays in [0,1].
  let minY = Infinity;
  let maxY = -Infinity;
  for (const i of sel) {
    minY = Math.min(minY, points[i].y);
    maxY = Math.max(maxY, points[i].y);
  }
  const cdy = Math.max(-minY, Math.min(1 - maxY, dy));

  return points.map((p, i) =>
    isSel.has(i) ? { x: clamp01(p.x + cdx), y: clamp01(p.y + cdy) } : p
  );
}

/**
 * Delete the selected nodes. Endpoints delete like any node; the one rule
 * (same as dblclick-remove) is that a lane never empties — if everything is
 * selected, the first node survives.
 */
export function deleteSelected(points: LanePoint[], selected: number[]): LanePoint[] {
  const isSel = new Set(selected.filter((i) => i >= 0 && i < points.length));
  if (isSel.size === 0) return points;
  const out = points.filter((_, i) => !isSel.has(i));
  return out.length > 0 ? out : [points[0]];
}
