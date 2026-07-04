/**
 * Transition-editor model — chop-stamp math (issue 04), slide math (issue 11).
 */
import { describe, expect, it } from 'vitest';
import {
  arrangementAt,
  bTrackTimeAt,
  evalLane,
  insertChop,
  laneValuesAt,
  slideB,
  slideBToCue,
  type LanePoint,
  type EditorMix,
  type Transition,
} from './mixModel';

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

const tr = (over: Partial<Transition> = {}): Transition => ({
  startSec: 30,
  durationSec: 20,
  bInSec: 10,
  tempoMatch: true,
  lanes: {},
  ...over,
});

describe('slideB (PRD quadrant table, B side)', () => {
  it('unlocked: window stays with A — bInSec absorbs the slide', () => {
    expect(slideB(tr(), 4, false, 1)).toEqual({ startSec: 30, bInSec: 14 });
    expect(slideB(tr(), -4, false, 1)).toEqual({ startSec: 30, bInSec: 6 });
  });

  it('locked: window rides B — startSec moves by the mix-time equivalent', () => {
    expect(slideB(tr(), 4, true, 1)).toEqual({ startSec: 26, bInSec: 10 });
    // rateB scaling: 4 B-seconds = 2 mix-seconds at rateB 2.
    expect(slideB(tr(), 4, true, 2)).toEqual({ startSec: 28, bInSec: 10 });
  });

  it('locked: startSec ≥ 0 is the only clamp', () => {
    expect(slideB(tr(), 100, true, 1)).toEqual({ startSec: 0, bInSec: 10 });
  });

  it('unlocked: negative entry anchor is first-class (no clamp)', () => {
    expect(slideB(tr(), -25, false, 1)).toEqual({ startSec: 30, bInSec: -15 });
  });
});

describe('slideBToCue', () => {
  it('lands the cue under the playhead (unlocked and locked, any rate)', () => {
    for (const locked of [false, true]) {
      for (const rateB of [1, 1.04]) {
        for (const cue of [15, 21.5]) {
          const t = tr();
          const playhead = 38; // mid-window, 8s in
          const out = slideBToCue(t, cue, playhead, locked, rateB);
          expect(bTrackTimeAt({ ...t, ...out }, playhead, rateB)).toBeCloseTo(cue, 9);
        }
      }
    }
  });

  it('locked landing breaks exactness only at the startSec ≥ 0 clamp', () => {
    const out = slideBToCue(tr(), 55.5, 38, true, 1); // would need startSec −7.5
    expect(out.startSec).toBe(0);
  });

  it('cue-slide near B start overshoots into bInSec < 0 cleanly', () => {
    const t = tr({ bInSec: 0 });
    // Standing at the window start, pull a cue 5s into B... backwards: aim
    // a cue BEFORE the current position → negative anchor.
    const out = slideBToCue(t, 2, 40, false, 1); // playhead 10s into window
    expect(out.bInSec).toBe(-8);
  });
});

describe('laneValuesAt with hidden lanes', () => {
  it('hidden lanes keep their envelope in the model but read as default', () => {
    const kill: LanePoint[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ];
    const t = tr({ lanes: { eqLowA: kill } });
    expect(evalLane(kill, 0.5)).toBe(0);
    // Visible: the drawn kill applies.
    expect(laneValuesAt(t, 40).eqLowA).toBe(0);
    // Hidden: default (flat 0.5) applies; the envelope stays in `lanes`.
    const hidden = { ...t, hiddenLanes: ['eqLowA' as const] };
    expect(laneValuesAt(hidden, 40).eqLowA).toBe(0.5);
    expect(hidden.lanes.eqLowA).toBe(kill);
  });
});

describe('arrangementAt with negative entry anchor', () => {
  const mix: EditorMix = {
    trackAId: 1,
    trackBId: 2,
    transition: tr({ startSec: 30, durationSec: 20, bInSec: -10 }),
  };
  const durations = { a: 100, b: 60 };

  it('defers B through the silent lead gap to its true audio start', () => {
    expect(arrangementAt(mix, 35, durations, 1).bActive).toBe(false); // gap
    expect(arrangementAt(mix, 41, durations, 1).bActive).toBe(true);
    expect(arrangementAt(mix, 41, durations, 1).bTrackTime).toBeCloseTo(1);
  });

  it('true audio start scales with rateB', () => {
    // Gap is 10 B-seconds = 5 mix-seconds at rateB 2.
    expect(arrangementAt(mix, 34, durations, 2).bActive).toBe(false);
    expect(arrangementAt(mix, 36, durations, 2).bActive).toBe(true);
  });

  it('mix duration extends by the gap', () => {
    expect(arrangementAt(mix, 0, durations, 1).mixDuration).toBe(100);
    const long = { ...mix, transition: tr({ startSec: 60, durationSec: 20, bInSec: -10 }) };
    expect(arrangementAt(long, 0, durations, 1).mixDuration).toBe(130);
  });
});
