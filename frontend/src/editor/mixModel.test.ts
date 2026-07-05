/**
 * Transition-editor model — chop-stamp math (issue 04), slide math (issue 11).
 */
import { describe, expect, it } from 'vitest';
import {
  EDITOR_PITCH_RANGE_PERCENT,
  arrangementAt,
  bContentSegments,
  bEndMixTime,
  bTrackTimeAt,
  cropRemapJumps,
  cropRemapJumpsLeft,
  evalLane,
  insertChop,
  jumpRepeatCount,
  laneValuesAt,
  slideB,
  slideBToCue,
  tempoMatchPitch,
  type JumpEvent,
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

// ── Jump events (transition-takes 01) ──────────────────────────────────
// A Jump event is a playback discontinuity of the INCOMING track at a mix
// instant (glossary; ADR 0020) — beat jump / hot-cue press mid-mix, e.g.
// doubling a buildup. Incoming-only: A's time ≡ mix time stays inviolate.

describe('bTrackTimeAt with jump events', () => {
  // Window 30..50; B enters at track-time 10. A jump halfway (mix 40)
  // back 8 B-seconds doubles the 32..40 stretch of B.
  const jump = (over: Partial<JumpEvent> = {}): JumpEvent => ({ x: 0.5, deltaSec: -8, ...over });

  it('is linear before the jump instant and offset after it', () => {
    const t = tr({ jumps: [jump()] });
    expect(bTrackTimeAt(t, 39.9, 1)).toBeCloseTo(19.9);
    expect(bTrackTimeAt(t, 40, 1)).toBeCloseTo(12); // 20 − 8, at the instant
    expect(bTrackTimeAt(t, 45, 1)).toBeCloseTo(17);
  });

  it('jump instants sit on the MIX axis: x maps through the window, deltas are B-seconds', () => {
    const t = tr({ jumps: [jump()] });
    // rateB 2: same mix instant (40), B-time runs twice as fast.
    expect(bTrackTimeAt(t, 39.9, 2)).toBeCloseTo(10 + 9.9 * 2);
    expect(bTrackTimeAt(t, 41, 2)).toBeCloseTo(10 + 11 * 2 - 8);
  });

  it('accumulates multiple jumps regardless of array order', () => {
    const jumps: JumpEvent[] = [jump({ x: 0.75, deltaSec: 4 }), jump({ x: 0.25, deltaSec: -8 })];
    const t = tr({ jumps });
    expect(bTrackTimeAt(t, 34, 1)).toBeCloseTo(14); // before both
    expect(bTrackTimeAt(t, 36, 1)).toBeCloseTo(8); // after the first
    expect(bTrackTimeAt(t, 46, 1)).toBeCloseTo(22); // 10 + 16 − 8 + 4, after both
  });
});

describe('arrangementAt with jump events', () => {
  const durations = { a: 100, b: 60 };
  const mixWith = (jumps: JumpEvent[], over: Partial<Transition> = {}): EditorMix => ({
    trackAId: 1,
    trackBId: 2,
    transition: tr({ startSec: 30, durationSec: 20, bInSec: 10, jumps, ...over }),
  });

  it('a backward jump (doubled buildup) extends the mix duration', () => {
    // Without jumps B ends at mix 80; the −8 replay pushes it to 88.
    expect(arrangementAt(mixWith([]), 0, durations, 1).mixDuration).toBeCloseTo(80);
    const m = mixWith([{ x: 0.5, deltaSec: -8 }]);
    expect(arrangementAt(m, 0, durations, 1).mixDuration).toBeCloseTo(88);
    expect(arrangementAt(m, 85, durations, 1).bActive).toBe(true);
    expect(arrangementAt(m, 85, durations, 1).bTrackTime).toBeCloseTo(57);
  });

  it('a forward jump past B\'s end ends B at the jump instant', () => {
    const m = mixWith([{ x: 0.5, deltaSec: 45 }]); // mix 40: B-time 20 → 65 > 60
    expect(arrangementAt(m, 39, durations, 1).bActive).toBe(true);
    expect(arrangementAt(m, 41, durations, 1).bActive).toBe(false);
    // A still runs to the window end (aEnd 50), which now bounds the mix.
    expect(arrangementAt(m, 0, durations, 1).mixDuration).toBeCloseTo(50);
  });

  it('a backward jump firing exactly as B ends rescues it (instant belongs to the jump)', () => {
    // bInSec 50 runs B's tape out at mix 40 — the same instant a −8 jump
    // fires (x 0.5). bTrackTimeAt applies deltas AT their instant, so the
    // jump wins: B replays its last stretch instead of ending, and now
    // runs out at mix 48. A's window end (50) bounds the mix.
    const m = mixWith([{ x: 0.5, deltaSec: -8 }], { bInSec: 50 });
    expect(arrangementAt(m, 39.9, durations, 1).bActive).toBe(true);
    expect(arrangementAt(m, 40, durations, 1).bActive).toBe(true); // rescued, not ended
    expect(arrangementAt(m, 40, durations, 1).bTrackTime).toBeCloseTo(52);
    expect(arrangementAt(m, 47.9, durations, 1).bActive).toBe(true);
    expect(arrangementAt(m, 48.1, durations, 1).bActive).toBe(false);
    expect(arrangementAt(m, 0, durations, 1).mixDuration).toBeCloseTo(50);
  });

  it('a jump below B\'s start deactivates B until its audio recovers', () => {
    // Mix 32: B-time 12 − 20 = −8 → silent, back at 0 by mix 40.
    const m = mixWith([{ x: 0.1, deltaSec: -20 }]);
    expect(arrangementAt(m, 31, durations, 1).bActive).toBe(true);
    expect(arrangementAt(m, 35, durations, 1).bActive).toBe(false);
    expect(arrangementAt(m, 41, durations, 1).bActive).toBe(true);
    expect(arrangementAt(m, 41, durations, 1).bTrackTime).toBeCloseTo(1);
  });
});

describe('bContentSegments (transition-takes 06: the one piecewise walk)', () => {
  const durB = 60;

  it('no jumps: one segment, linear, ending where B runs out', () => {
    const t = tr({ startSec: 30, durationSec: 20, bInSec: 10 });
    expect(bContentSegments(t, durB, 1)).toEqual([
      { mixStartSec: 30, mixEndSec: 80, bStartSec: 10 },
    ]);
    // rateB scales the footprint: 50 B-seconds in 25 mix-seconds.
    expect(bContentSegments(t, durB, 2)).toEqual([
      { mixStartSec: 30, mixEndSec: 55, bStartSec: 10 },
    ]);
  });

  it('a negative entry anchor defers the segment to B\'s audio start', () => {
    const t = tr({ startSec: 30, durationSec: 20, bInSec: -10 });
    expect(bContentSegments(t, durB, 1)).toEqual([
      { mixStartSec: 40, mixEndSec: 100, bStartSec: 0 },
    ]);
  });

  it('a backward jump splits into two segments with overlapping B ranges', () => {
    const t = tr({ startSec: 30, durationSec: 20, bInSec: 10, jumps: [{ x: 0.5, deltaSec: -8 }] });
    expect(bContentSegments(t, durB, 1)).toEqual([
      { mixStartSec: 30, mixEndSec: 40, bStartSec: 10 }, // plays 10..20
      { mixStartSec: 40, mixEndSec: 88, bStartSec: 12 }, // replays from 12
    ]);
  });

  it('a forward jump past B\'s end truncates: first end is the end', () => {
    const t = tr({ startSec: 30, durationSec: 20, bInSec: 10, jumps: [{ x: 0.5, deltaSec: 45 }] });
    expect(bContentSegments(t, durB, 1)).toEqual([
      { mixStartSec: 30, mixEndSec: 40, bStartSec: 10 },
    ]);
  });

  it('a jump below zero opens a gap; the next segment re-enters at B\'s start', () => {
    const t = tr({ startSec: 30, durationSec: 20, bInSec: 10, jumps: [{ x: 0.1, deltaSec: -20 }] });
    expect(bContentSegments(t, durB, 1)).toEqual([
      { mixStartSec: 30, mixEndSec: 32, bStartSec: 10 }, // 10..12
      { mixStartSec: 40, mixEndSec: 100, bStartSec: 0 }, // silent 32..40, then 0..60
    ]);
  });

  it('bEndMixTime is the last segment\'s end (single walk, two views)', () => {
    for (const jumps of [
      undefined,
      [{ x: 0.5, deltaSec: -8 }],
      [{ x: 0.1, deltaSec: -20 }],
      [{ x: 0.25, deltaSec: -8 }, { x: 0.75, deltaSec: 4 }],
    ]) {
      const t = tr({ startSec: 30, durationSec: 20, bInSec: 10, jumps });
      const segs = bContentSegments(t, durB, 1);
      expect(bEndMixTime(t, durB, 1)).toBeCloseTo(segs[segs.length - 1].mixEndSec);
    }
  });

  it('a zero-duration window puts every jump at the cut instant', () => {
    const t = tr({ startSec: 30, durationSec: 0, bInSec: 10, jumps: [{ x: 0.5, deltaSec: -8 }] });
    expect(bContentSegments(t, durB, 1)).toEqual([
      { mixStartSec: 30, mixEndSec: 88, bStartSec: 2 },
    ]);
  });
});

describe('repeatable jump events (looping 06)', () => {
  const durB = 60;

  it('jumpRepeatCount: backward jumps repeat, forward jumps never do', () => {
    expect(jumpRepeatCount({ x: 0.5, deltaSec: -2, count: 4 })).toBe(4);
    expect(jumpRepeatCount({ x: 0.5, deltaSec: -2 })).toBe(1);
    expect(jumpRepeatCount({ x: 0.5, deltaSec: 2, count: 4 })).toBe(1);
    expect(jumpRepeatCount({ x: 0.5, deltaSec: 0, count: 4 })).toBe(1);
    expect(jumpRepeatCount({ x: 0.5, deltaSec: -2, count: 0 })).toBe(1);
  });

  it('bTrackTimeAt replays the jumped-back stretch count times', () => {
    // Window 30..50, b 10 at start; at mix 40 a 4-beat loop: back 2s, ×3.
    const t = tr({ startSec: 30, durationSec: 20, bInSec: 10, jumps: [{ x: 0.5, deltaSec: -2, count: 3 }] });
    // Repeats fire at mix 40, 42, 44 (period = |delta| / rateB).
    expect(bTrackTimeAt(t, 39.9, 1)).toBeCloseTo(19.9);
    expect(bTrackTimeAt(t, 41, 1)).toBeCloseTo(19); // after 1st wrap
    expect(bTrackTimeAt(t, 43, 1)).toBeCloseTo(19); // after 2nd
    expect(bTrackTimeAt(t, 45, 1)).toBeCloseTo(19); // after 3rd
    expect(bTrackTimeAt(t, 47, 1)).toBeCloseTo(21); // released — flows past
  });

  it('the repetition period scales with rateB (B-seconds, not mix-seconds)', () => {
    const t = tr({ startSec: 30, durationSec: 20, bInSec: 10, jumps: [{ x: 0.5, deltaSec: -2, count: 2 }] });
    // rateB 2: period 1 mix-second — wraps at 40 and 41.
    expect(bTrackTimeAt(t, 40.5, 2)).toBeCloseTo(10 + 10.5 * 2 - 2);
    expect(bTrackTimeAt(t, 41.5, 2)).toBeCloseTo(10 + 11.5 * 2 - 4);
  });

  it('bContentSegments splices one segment per repeat', () => {
    const t = tr({ startSec: 30, durationSec: 20, bInSec: 10, jumps: [{ x: 0.5, deltaSec: -2, count: 3 }] });
    expect(bContentSegments(t, durB, 1)).toEqual([
      { mixStartSec: 30, mixEndSec: 40, bStartSec: 10 }, // 10..20
      { mixStartSec: 40, mixEndSec: 42, bStartSec: 18 }, // replay 18..20
      { mixStartSec: 42, mixEndSec: 44, bStartSec: 18 }, // replay 18..20
      { mixStartSec: 44, mixEndSec: 86, bStartSec: 18 }, // released: 18..60
    ]);
  });

  it('bEndMixTime extends by count × |delta| (each replay plays again)', () => {
    const plain = tr({ startSec: 30, durationSec: 20, bInSec: 10 });
    const looped = tr({ startSec: 30, durationSec: 20, bInSec: 10, jumps: [{ x: 0.5, deltaSec: -2, count: 3 }] });
    expect(bEndMixTime(looped, durB, 1)).toBeCloseTo(bEndMixTime(plain, durB, 1) + 6);
  });

  it('a forward jump with a count applies its delta exactly once', () => {
    const t = tr({ startSec: 30, durationSec: 20, bInSec: 10, jumps: [{ x: 0.5, deltaSec: 5, count: 3 }] });
    expect(bTrackTimeAt(t, 49, 1)).toBeCloseTo(29 + 5);
    expect(bContentSegments(t, durB, 1)).toHaveLength(2);
  });

  it('count-1 jumps behave exactly like plain jumps', () => {
    const plain = tr({ startSec: 30, durationSec: 20, bInSec: 10, jumps: [{ x: 0.5, deltaSec: -8 }] });
    const counted = tr({ startSec: 30, durationSec: 20, bInSec: 10, jumps: [{ x: 0.5, deltaSec: -8, count: 1 }] });
    expect(bContentSegments(counted, durB, 1)).toEqual(bContentSegments(plain, durB, 1));
    expect(bTrackTimeAt(counted, 45, 1)).toBe(bTrackTimeAt(plain, 45, 1));
  });
});

describe('crop remaps for jump events (duration changes keep absolute time)', () => {
  const jumps: JumpEvent[] = [
    { x: 0.25, deltaSec: -8 },
    { x: 0.75, deltaSec: 4 },
  ];

  it('right-edge crop: instants keep absolute time, cut-off jumps drop', () => {
    expect(cropRemapJumps(jumps, 20, 10)).toEqual([{ x: 0.5, deltaSec: -8 }]);
    // Growing compresses leftward, nothing drops.
    expect(cropRemapJumps(jumps, 20, 40)).toEqual([
      { x: 0.125, deltaSec: -8 },
      { x: 0.375, deltaSec: 4 },
    ]);
  });

  it('left-edge crop: instants keep absolute time, cut-off jumps drop', () => {
    // Window shrinks 20 → 15 from the left (start moves +5s): 5s abs → 0,
    // 15s abs → 10/15.
    expect(cropRemapJumpsLeft(jumps, 20, 15)).toEqual([
      { x: 0, deltaSec: -8 },
      { x: expect.closeTo(10 / 15), deltaSec: 4 },
    ]);
    expect(cropRemapJumpsLeft(jumps, 20, 10)).toEqual([{ x: 0.5, deltaSec: 4 }]);
  });
});

describe('tempoMatchPitch (editor varispeed)', () => {
  it('matches B to A within the editor range', () => {
    expect(tempoMatchPitch(128, 126)).toBeCloseTo((128 / 126 - 1) * 100);
  });

  it('allows gaps beyond the shared decks\' ±8% (templates 2026-07-04)', () => {
    // 140 vs 120 needs ~+16.7% — legal in the editor's private player.
    expect(tempoMatchPitch(140, 120)).toBeCloseTo((140 / 120 - 1) * 100);
  });

  it('clamps at the editor range', () => {
    expect(tempoMatchPitch(200, 100)).toBe(EDITOR_PITCH_RANGE_PERCENT);
    expect(tempoMatchPitch(100, 200)).toBe(-EDITOR_PITCH_RANGE_PERCENT);
  });

  it('is 0 without both BPMs', () => {
    expect(tempoMatchPitch(null, 120)).toBe(0);
    expect(tempoMatchPitch(120, null)).toBe(0);
  });
});
