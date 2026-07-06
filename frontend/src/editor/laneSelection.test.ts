/**
 * Lane node group selection (mix-editor 16): pure selection/group-move/
 * delete logic for breakpoints within one automation lane.
 */
import { describe, expect, it } from 'vitest';
import {
  deleteSelected,
  indicesInRect,
  moveGroup,
  toggleIndex,
} from './laneSelection';
import type { LanePoint } from './mixModel';

/** Five x-sorted nodes spanning the lane. */
const pts: LanePoint[] = [
  { x: 0, y: 1 },
  { x: 0.2, y: 0.8 },
  { x: 0.5, y: 0.5 },
  { x: 0.8, y: 0.2 },
  { x: 1, y: 0 },
];

describe('indicesInRect', () => {
  it('selects the nodes inside the rect', () => {
    expect(indicesInRect(pts, { x0: 0.1, y0: 0.4, x1: 0.6, y1: 0.9 })).toEqual([1, 2]);
  });

  it('normalizes unordered corners (drag any direction)', () => {
    expect(indicesInRect(pts, { x0: 0.6, y0: 0.9, x1: 0.1, y1: 0.4 })).toEqual([1, 2]);
  });

  it('is border-inclusive', () => {
    expect(indicesInRect(pts, { x0: 0.2, y0: 0.5, x1: 0.5, y1: 0.8 })).toEqual([1, 2]);
  });

  it('returns empty for a rect over empty space', () => {
    expect(indicesInRect(pts, { x0: 0.3, y0: 0.05, x1: 0.4, y1: 0.1 })).toEqual([]);
  });
});

describe('toggleIndex', () => {
  it('adds an unselected index (kept sorted)', () => {
    expect(toggleIndex([3, 1], 2)).toEqual([1, 2, 3]);
  });

  it('removes a selected index', () => {
    expect(toggleIndex([1, 2, 3], 2)).toEqual([1, 3]);
  });
});

describe('moveGroup', () => {
  it('moves selected nodes by the same delta, others untouched', () => {
    const out = moveGroup(pts, [1, 2], 0.1, -0.2);
    expect(out[1]).toEqual({ x: expect.closeTo(0.3), y: expect.closeTo(0.6) });
    expect(out[2]).toEqual({ x: expect.closeTo(0.6), y: expect.closeTo(0.3) });
    expect(out[0]).toEqual(pts[0]);
    expect(out[3]).toEqual(pts[3]);
    expect(out[4]).toEqual(pts[4]);
  });

  it('preserves relative spacing exactly (one delta, no per-node adjustment)', () => {
    const out = moveGroup(pts, [1, 2], 0.07, 0.03);
    expect(out[2].x - out[1].x).toBeCloseTo(pts[2].x - pts[1].x);
    expect(out[2].y - out[1].y).toBeCloseTo(pts[2].y - pts[1].y);
  });

  it('clamps x at collision with the unselected right neighbor', () => {
    // Selected run [1,2]; right wall = pts[3].x = 0.8; max dx = 0.3.
    const out = moveGroup(pts, [1, 2], 0.5, 0);
    expect(out[2].x).toBeCloseTo(0.8);
    expect(out[1].x).toBeCloseTo(0.5); // spacing preserved under the clamp
  });

  it('clamps x at collision with the unselected left neighbor', () => {
    const out = moveGroup(pts, [2, 3], -0.9, 0);
    expect(out[2].x).toBeCloseTo(0.2);
    expect(out[3].x).toBeCloseTo(0.5);
  });

  it('clamps x at the lane bounds when endpoints are selected', () => {
    const out = moveGroup(pts, [3, 4], 0.5, 0);
    expect(out[4].x).toBeCloseTo(1);
    expect(out[3].x).toBeCloseTo(0.8);
    const back = moveGroup(pts, [0, 1], -0.5, 0);
    expect(back[0].x).toBeCloseTo(0);
    expect(back[1].x).toBeCloseTo(0.2);
  });

  it('clamps y so the whole group stays in [0,1]', () => {
    // maxY of [1,2] is 0.8 → dy caps at +0.2.
    const up = moveGroup(pts, [1, 2], 0, 0.5);
    expect(up[1].y).toBeCloseTo(1);
    expect(up[2].y).toBeCloseTo(0.7);
    const down = moveGroup(pts, [2, 3], 0, -0.5);
    expect(down[3].y).toBeCloseTo(0);
    expect(down[2].y).toBeCloseTo(0.3);
  });

  it('the tightest run clamps the whole group (never reorders)', () => {
    // Two runs: [1] (right wall pts[2].x=0.5, room 0.3) and [3] (right wall
    // pts[4].x=1, room 0.2). The group delta caps at 0.2.
    const out = moveGroup(pts, [1, 3], 0.4, 0);
    expect(out[1].x).toBeCloseTo(0.4);
    expect(out[3].x).toBeCloseTo(1);
    // Order intact.
    for (let i = 1; i < out.length; i++) expect(out[i].x).toBeGreaterThanOrEqual(out[i - 1].x);
  });

  it('empty selection is a no-op', () => {
    expect(moveGroup(pts, [], 0.3, 0.3)).toEqual(pts);
  });
});

describe('deleteSelected', () => {
  it('removes the selected nodes', () => {
    expect(deleteSelected(pts, [1, 3])).toEqual([pts[0], pts[2], pts[4]]);
  });

  it('endpoints are deletable like any node (existing dblclick rule)', () => {
    expect(deleteSelected(pts, [0, 4])).toEqual([pts[1], pts[2], pts[3]]);
  });

  it('keeps at least one node when everything is selected', () => {
    expect(deleteSelected(pts, [0, 1, 2, 3, 4])).toEqual([pts[0]]);
  });

  it('ignores out-of-range indices; empty selection is a no-op', () => {
    expect(deleteSelected(pts, [99])).toEqual(pts);
    expect(deleteSelected(pts, [])).toEqual(pts);
  });
});
