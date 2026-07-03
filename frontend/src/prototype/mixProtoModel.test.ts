/**
 * PROTOTYPE (mix-editor) — chop-stamp math (issue 04).
 */
import { describe, expect, it } from 'vitest';
import { evalLane, insertChop, type LanePoint } from './mixProtoModel';

/** faderA default: full → silent ramp. */
const ramp: LanePoint[] = [
  { x: 0, y: 1 },
  { x: 1, y: 0 },
];

describe('insertChop', () => {
  it('stamps 4 points with near-vertical walls to 0', () => {
    const out = insertChop(ramp, 0.25, 0.5);
    expect(out).toEqual([
      { x: 0, y: 1 },
      { x: 0.25, y: 0.75 },
      { x: 0.25 + 0.004, y: 0 },
      { x: 0.5 - 0.004, y: 0 },
      { x: 0.5, y: 0.5 },
      { x: 1, y: 0 },
    ]);
  });

  it('is silent inside the cut and untouched outside', () => {
    const out = insertChop(ramp, 0.25, 0.5);
    expect(evalLane(out, 0.3)).toBe(0);
    expect(evalLane(out, 0.49)).toBe(0);
    expect(evalLane(out, 0.1)).toBeCloseTo(0.9);
    expect(evalLane(out, 0.75)).toBeCloseTo(0.25);
  });

  it('removes existing breakpoints inside the span (including on its edges)', () => {
    const pts: LanePoint[] = [
      { x: 0, y: 1 },
      { x: 0.3, y: 0.2 },
      { x: 0.4, y: 0.9 },
      { x: 1, y: 0 },
    ];
    const out = insertChop(pts, 0.3, 0.5);
    expect(out.filter((p) => p.x > 0.3 + 0.004 && p.x < 0.5 - 0.004)).toEqual([]);
    // Entry value comes from the pre-cut curve at the edge.
    expect(out.find((p) => p.x === 0.3)?.y).toBeCloseTo(0.2);
  });

  it('normalizes argument order and clamps to 0..1', () => {
    expect(insertChop(ramp, 0.5, 0.25)).toEqual(insertChop(ramp, 0.25, 0.5));
    const out = insertChop(ramp, -0.5, 0.25);
    expect(out[0]).toEqual({ x: 0, y: 1 });
    expect(evalLane(out, 0.1)).toBe(0);
  });

  it('no-ops on spans too narrow for both walls', () => {
    expect(insertChop(ramp, 0.5, 0.5)).toBe(ramp);
    expect(insertChop(ramp, 0.5, 0.507)).toBe(ramp);
  });

  it('stamped points remain plain editable breakpoints (sorted, in range)', () => {
    const out = insertChop(ramp, 0.25, 0.5);
    const sorted = [...out].sort((a, b) => a.x - b.x);
    expect(out).toEqual(sorted);
    for (const p of out) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1);
    }
  });
});
