import { describe, expect, it } from 'vitest';
import { hitLane, LANE_GRAB_PX, LANE_LINE_PX, laneValueY, laneYValue } from './laneHit';
import type { LanePoint } from './mixModel';

const miss = { nearestIndex: -1, insertion: null, insertionIndex: -1 };

describe('lane value axis', () => {
  it.each([
    [100, 8, 50, 92],
    [16, 4, 8, 12],
    [1, 0.25, 0.5, 0.75],
  ])('insets both edges at height %s and reverses the mapping', (height, top, mid, bottom) => {
    expect(laneValueY(1, height)).toBe(top);
    expect(laneValueY(0.5, height)).toBe(mid);
    expect(laneValueY(0, height)).toBe(bottom);
    expect(laneYValue(top, height)).toBe(1);
    expect(laneYValue(mid, height)).toBe(0.5);
    expect(laneYValue(bottom, height)).toBe(0);
    expect(laneYValue(-10, height)).toBeGreaterThan(1);
    expect(laneYValue(height + 10, height)).toBeLessThan(0);
    expect(laneValueY(laneYValue(-10, height), height)).toBeCloseTo(-10);
  });

  it.each([0, -10, Infinity, NaN])('returns a safe zero for invalid height %s', (height) => {
    expect(laneValueY(0.5, height)).toBe(0);
    expect(laneYValue(10, height)).toBe(0);
  });
});

describe('hitLane', () => {
  it('exports the CSS-pixel hit radii', () => {
    expect(LANE_GRAB_PX).toBe(13);
    expect(LANE_LINE_PX).toBe(6);
  });

  it.each([
    [0, 1, 0, 0],
    [1, 1, 100, 0],
    [0, 0, 0, 116],
    [1, 0, 100, 116],
    [0.5, 1, 50, 0],
    [0.5, 0, 50, 116],
  ])('grabs edge/corner node (%s, %s) from (%s, %s)', (px, py, x, y) => {
    expect(hitLane([{ x: px, y: py }], x, y, 100, 116, 0.5)).toEqual({
      nearestIndex: 0, insertion: null, insertionIndex: -1,
    });
  });

  it('uses an inclusive Euclidean node radius, not a square', () => {
    const points = [{ x: 0.5, y: 0.5 }];
    expect(hitLane(points, 55, 70, 100, 116, 0.5).nearestIndex).toBe(0);
    expect(hitLane(points, 60, 68, 100, 116, 0.5)).toEqual(miss);
    expect(hitLane(points, 50, 71.01, 100, 116, 0.5)).toEqual(miss);
  });

  it('picks the closest node before line projection or guide snapping', () => {
    const points = [{ x: 0.4, y: 0.5 }, { x: 0.6, y: 0.5 }];
    expect(hitLane(points, 51, 58, 100, 116, 0.5, [0.45])).toEqual({
      nearestIndex: 1, insertion: null, insertionIndex: -1,
    });
  });

  it.each([
    [[{ x: 0, y: 0 }, { x: 1, y: 1 }], 52, 60],
    [[{ x: 0, y: 1 }, { x: 1, y: 0 }], 52, 56],
  ] as [LanePoint[], number, number][])('projects onto ascending/descending segments %o', (points, x, y) => {
    expect(hitLane(points, x, y, 100, 116, 0.5)).toEqual({
      nearestIndex: -1, insertion: { x: 0.5, y: 0.5 }, insertionIndex: 1,
    });
  });

  it('projects in pixel space rather than normalized space', () => {
    const points = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    expect(hitLane(points, 103, 62, 200, 116, 0.5).insertion).toEqual({
      x: expect.closeTo(0.504), y: expect.closeTo(0.504),
    });
  });

  it('accepts only clicks within six pixels of the polyline', () => {
    const points = [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }];
    expect(hitLane(points, 50, 64, 100, 116, 0.5)).toEqual({
      nearestIndex: -1, insertion: { x: 0.5, y: 0.5 }, insertionIndex: 1,
    });
    expect(hitLane(points, 50, 64.01, 100, 116, 0.5)).toEqual(miss);
    expect(hitLane(points, 50, 100, 100, 116, 0.5)).toEqual(miss);
  });

  it.each([[0, 1], [1, 0]])('inserts between vertical-step endpoints %s -> %s', (a, b) => {
    const points = [{ x: 0.5, y: a }, { x: 0.5, y: b }];
    const hit = hitLane(points, 54, 58, 100, 116, 0.5);
    expect(hit).toEqual({
      nearestIndex: -1, insertion: { x: 0.5, y: 0.5 }, insertionIndex: 1,
    });
    points.splice(hit.insertionIndex, 0, hit.insertion!);
    expect(points).toEqual([{ x: 0.5, y: a }, { x: 0.5, y: 0.5 }, { x: 0.5, y: b }]);
  });

  it.each([[10, 88, 0.1, 0.2, 0], [90, 28, 0.9, 0.8, 2]])(
    'projects onto flat end extensions at x=%s', (x, y, px, py, index) => {
      const points = [{ x: 0.3, y: 0.2 }, { x: 0.7, y: 0.8 }];
      expect(hitLane(points, x, y, 100, 116, 0.5)).toEqual({
        nearestIndex: -1, insertion: { x: expect.closeTo(px), y: py }, insertionIndex: index,
      });
    },
  );

  it.each([0.5, 1])('uses the caller default %s for an empty lane', (value) => {
    expect(hitLane([], 40, laneValueY(value, 116) + 4, 100, 116, value)).toEqual({
      nearestIndex: -1, insertion: { x: 0.4, y: value }, insertionIndex: 0,
    });
    expect(hitLane([], 40, 90, 100, 116, value)).toEqual(miss);
  });

  it.each([
    [[{ x: 1.2, y: 0.2 }, { x: 1.4, y: 0.8 }], 88, 0.2, 0],
    [[{ x: -0.4, y: 0.2 }, { x: -0.2, y: 0.8 }], 28, 0.8, 2],
  ] as [LanePoint[], number, number, number][])(
    'matches drawn extensions for translated points %o', (points, y, value, index) => {
      expect(hitLane(points, 50, y, 100, 116, 0.5)).toEqual({
        nearestIndex: -1, insertion: { x: expect.closeTo(0.5), y: value }, insertionIndex: index,
      });
    },
  );

  it.each([[0, 116], [-1, 116], [100, 0], [100, -1], [Infinity, 116], [100, NaN]])(
    'fails safe for invalid geometry %s x %s', (width, height) => {
      expect(hitLane([{ x: 0, y: 1 }], 0, 8, width, height, 0.5)).toEqual(miss);
    },
  );

  it('handles a tiny positive hit rectangle', () => {
    expect(hitLane([], 0.5, 0.5, 1, 1, 0.5)).toEqual({
      nearestIndex: -1, insertion: { x: 0.5, y: 0.5 }, insertionIndex: 0,
    });
  });

  it('snaps the projected candidate to the nearest guide and recomputes its value', () => {
    const points = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    // The click is x=.52, but its perpendicular projection is x=.50.
    expect(hitLane(points, 52, 60, 100, 116, 0.5, [0.54, 0.47])).toEqual({
      nearestIndex: -1, insertion: { x: 0.47, y: 0.47 }, insertionIndex: 1,
    });
  });

  it('uses a six-pixel guide radius and does not snap far-away clicks onto the line', () => {
    expect(hitLane([], 44, 58, 100, 116, 0.5, [0.5]).insertion).toEqual({ x: 0.5, y: 0.5 });
    expect(hitLane([], 50, 58, 100, 116, 0.5, [0.56]).insertion).toEqual({ x: 0.56, y: 0.5 });
    expect(hitLane([], 43.99, 58, 100, 116, 0.5, [0.5]).insertion?.x).toBeCloseTo(0.4399);
    expect(hitLane([], 44, 80, 100, 116, 0.5, [0.5])).toEqual(miss);
  });

  it('ignores closer guides outside the winning segment interval', () => {
    const points = [{ x: 0.4, y: 0 }, { x: 0.6, y: 1 }];
    expect(hitLane(points, 59.5, 33, 100, 1016, 0.5, [0.61, 0.57])).toEqual({
      nearestIndex: -1,
      insertion: { x: 0.57, y: expect.closeTo(0.85) },
      insertionIndex: 1,
    });
    expect(hitLane(points, 59.5, 33, 100, 1016, 0.5, [0.61]).insertion).toEqual({
      x: expect.closeTo(0.595), y: expect.closeTo(0.975),
    });
  });

  it('does not shift vertical segments or mistake matching x for a coincident node', () => {
    const points = [{ x: 0.5, y: 0 }, { x: 0.5, y: 1 }];
    expect(hitLane(points, 54, 58, 100, 116, 0.5, [0.5, 0.53])).toEqual({
      nearestIndex: -1, insertion: { x: 0.5, y: 0.5 }, insertionIndex: 1,
    });
  });

  it('returns a node when snapping lands exactly on an existing endpoint', () => {
    const points = [{ x: 0.4, y: 0 }, { x: 0.6, y: 1 }];
    expect(hitLane(points, 59.5, 33, 100, 1016, 0.5, [0.6])).toEqual({
      nearestIndex: 1, insertion: null, insertionIndex: -1,
    });
  });

  it('does not turn a snapped candidate near a noncoincident node into a node hit', () => {
    const points = [{ x: 0.4, y: 0 }, { x: 0.6, y: 1 }];
    expect(hitLane(points, 59.5, 33, 100, 1016, 0.5, [0.598])).toEqual({
      nearestIndex: -1,
      insertion: { x: 0.598, y: expect.closeTo(0.99) },
      insertionIndex: 1,
    });
  });

  it('snaps on a reversed off-window extension without changing the splice index', () => {
    const points = [{ x: 1.2, y: 0.2 }, { x: 1.4, y: 0.8 }];
    expect(hitLane(points, 50, 28, 100, 116, 0.5, [0.54])).toEqual(miss);
    expect(hitLane(points, 110, 28, 100, 116, 0.5, [1.06])).toEqual({
      nearestIndex: -1, insertion: { x: 1.06, y: 0.8 }, insertionIndex: 2,
    });
  });

  it('chooses the closest segment rather than the first segment within range', () => {
    const points = [{ x: 0.5, y: 0 }, { x: 0.5, y: 1 }, { x: 0.5, y: 0 }, { x: 0.6, y: 1 }];
    expect(hitLane(points, 55, 58, 100, 116, 0.5)).toEqual({
      nearestIndex: -1, insertion: { x: 0.55, y: 0.5 }, insertionIndex: 3,
    });
  });

  it('recomputes snapped values on a descending segment', () => {
    const points = [{ x: 0, y: 1 }, { x: 1, y: 0 }];
    expect(hitLane(points, 50, 58, 100, 116, 0.5, [0.54]).insertion).toEqual({
      x: 0.54, y: expect.closeTo(0.46),
    });
  });
});
