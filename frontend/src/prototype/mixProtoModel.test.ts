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
  it('stamps 4 points with walls centered on the edges', () => {
    const out = insertChop(ramp, 0.25, 0.5);
    expect(out).toEqual([
      { x: 0, y: 1 },
      { x: 0.25 - 0.002, y: expect.closeTo(0.752) },
      { x: 0.25 + 0.002, y: 0 },
      { x: 0.5 - 0.002, y: 0 },
      { x: 0.5 + 0.002, y: expect.closeTo(0.498) },
      { x: 1, y: 0 },
    ]);
  });

  it('walls straddle the beats: mid-wall ON the line, silent just after', () => {
    const out = insertChop(ramp, 0.25, 0.5);
    expect(evalLane(out, 0.25)).toBeCloseTo(0.752 / 2); // wall centered on the beat
    expect(evalLane(out, 0.25 + 0.002)).toBe(0); // fully cut past the wall
    expect(evalLane(out, 0.3)).toBe(0);
    expect(evalLane(out, 0.5 - 0.002)).toBe(0); // still cut approaching the exit beat
    expect(evalLane(out, 0.1)).toBeCloseTo(0.9); // untouched outside
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
    expect(out.filter((p) => p.x > 0.3 + 0.002 && p.x < 0.5 - 0.002)).toEqual([]);
    // Entry value comes from the pre-cut curve at the wall's outer foot.
    expect(out.find((p) => p.x === 0.3 - 0.002)?.y).toBeCloseTo(0.205, 3);
  });

  it('normalizes argument order and clamps to 0..1', () => {
    expect(insertChop(ramp, 0.5, 0.25)).toEqual(insertChop(ramp, 0.25, 0.5));
    const out = insertChop(ramp, -0.5, 0.25);
    expect(out[0]).toEqual({ x: 0, y: 1 });
    expect(evalLane(out, 0.1)).toBe(0);
  });

  it('no-ops on spans too narrow for a wall', () => {
    expect(insertChop(ramp, 0.5, 0.5)).toBe(ramp);
    expect(insertChop(ramp, 0.5, 0.5039)).toBe(ramp);
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
