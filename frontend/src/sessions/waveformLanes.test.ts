/**
 * Waveform-lane mixer modulation (sessions 19): the recorded channel strip
 * → per-column modulation, through the REAL gain curves (mixerMath /
 * graph) — render-only, audibility untouched.
 */
import { describe, expect, it } from 'vitest';
import { channelFaderToGain, trimToGain } from '../playback/mixerMath';
import { eqValueToGain } from '../playback/graph';
import type { CaptureEvent } from '../capture/events';
import type { DeckControlSteps } from './timelineModel';
import { buildTimeAxis, deriveTimeline } from './timelineModel';
import {
  columnModulation,
  createMonotonicPxToT,
  createMonotonicTToPx,
  tracePolylinePoints,
} from './waveformLanes';

const controls = (patch: Partial<DeckControlSteps> = {}): DeckControlSteps => ({
  fader: [{ t: 0, gain: 1 }],
  trim: [{ t: 0, gain: 0.5 }],
  eqLow: [{ t: 0, gain: 0.5 }],
  eqMid: [{ t: 0, gain: 0.5 }],
  eqHigh: [{ t: 0, gain: 0.5 }],
  ...patch,
});

describe('columnModulation', () => {
  it('nominal strip (fader full, trim + EQ centered) is identity', () => {
    const m = columnModulation(controls(), 10);
    expect(m.eq).toEqual([1, 1, 1]);
    expect(m.scale).toBeCloseTo(1, 10);
  });

  it('an EQ kill zeroes its band; attenuation follows the real curve', () => {
    const c = controls({
      eqLow: [
        { t: 0, gain: 0.5 },
        { t: 5, gain: 0 },
        { t: 9, gain: 0.25 },
      ],
    });
    expect(columnModulation(c, 4).eq[0]).toBe(1);
    expect(columnModulation(c, 6).eq[0]).toBe(0);
    expect(columnModulation(c, 10).eq[0]).toBeCloseTo(eqValueToGain(0.25), 10);
    // Other bands untouched.
    expect(columnModulation(c, 6).eq[1]).toBe(1);
    expect(columnModulation(c, 6).eq[2]).toBe(1);
  });

  it('fader shrinks with the audio taper (value²)', () => {
    const c = controls({
      fader: [
        { t: 0, gain: 1 },
        { t: 5, gain: 0.5 },
        { t: 9, gain: 0 },
      ],
    });
    expect(columnModulation(c, 6).scale).toBeCloseTo(channelFaderToGain(0.5), 10);
    expect(columnModulation(c, 10).scale).toBe(0);
  });

  it('trim scales with the dB curve; boosts saturate at 2× (mod-texture parity)', () => {
    const c = controls({
      trim: [
        { t: 0, gain: 0.5 },
        { t: 5, gain: 0.25 },
        { t: 7, gain: 0.625 },
        { t: 9, gain: 1 },
      ],
    });
    // -12 dB relative to the -6 dB center: exact curve ratio.
    expect(columnModulation(c, 6).scale).toBeCloseTo(trimToGain(0.25) / trimToGain(0.5), 10);
    // +3 dB over center: visible boost, exact curve ratio (> 1).
    expect(columnModulation(c, 8).scale).toBeCloseTo(trimToGain(0.625) / trimToGain(0.5), 10);
    // Full boost (+12 dB over center ≈ 4×): saturates at the 2× ceiling —
    // the live deck waveform's mod-texture encoding limit, kept in lockstep.
    expect(columnModulation(c, 10).scale).toBe(2);
  });

  it('falls back to strip defaults on empty / pre-first-step series', () => {
    const empty: DeckControlSteps = { fader: [], trim: [], eqLow: [], eqMid: [], eqHigh: [] };
    const m = columnModulation(empty, 5);
    expect(m.eq).toEqual([1, 1, 1]);
    expect(m.scale).toBeCloseTo(1, 10);
    const late = controls({ fader: [{ t: 50, gain: 0 }] });
    expect(columnModulation(late, 10).scale).toBeCloseTo(1, 10);
  });
});

// ── Monotonic axis cursors (sessions 22) ─────────────────────────────────

/** An axis with real collapsed segments: play, long idle (collapsed),
 * play again. */
function makeCollapsedAxis() {
  const events: CaptureEvent[] = [
    { t: 0, kind: 'load', channel: 'A', trackId: 7, bpm: 174 },
    { t: 1, kind: 'transport', channel: 'A', action: 'play', playhead: 0 },
    { t: 10, kind: 'transport', channel: 'A', action: 'pause', playhead: 9 },
    { t: 500, kind: 'transport', channel: 'A', action: 'play', playhead: 9 },
    { t: 510, kind: 'transport', channel: 'A', action: 'pause', playhead: 19 },
  ];
  const model = deriveTimeline(events);
  return buildTimeAxis(model, { collapseIdle: true, thresholdS: 45, pxPerSec: 2 });
}

describe('createMonotonicPxToT / createMonotonicTToPx', () => {
  it('pxToT cursor agrees with the axis over a monotonic sweep', () => {
    const axis = makeCollapsedAxis();
    const cursor = createMonotonicPxToT(axis);
    for (let x = -5; x <= axis.totalPx + 5; x += 0.25) {
      expect(cursor(x)).toBeCloseTo(axis.pxToT(x), 9);
    }
  });

  it('tToPx cursor agrees with the axis over a monotonic sweep', () => {
    const axis = makeCollapsedAxis();
    const cursor = createMonotonicTToPx(axis);
    for (let t = -2; t <= 515; t += 0.5) {
      expect(cursor(t)).toBeCloseTo(axis.tToPx(t), 9);
    }
  });

  it('cursors survive a backward step (defensive rewind)', () => {
    const axis = makeCollapsedAxis();
    const cursor = createMonotonicPxToT(axis);
    cursor(axis.totalPx - 1);
    expect(cursor(1)).toBeCloseTo(axis.pxToT(1), 9);
  });
});

describe('tracePolylinePoints', () => {
  const yOf = (ph: number) => 100 - ph;

  it('keeps endpoints and sparse points verbatim (rounded to 0.1px)', () => {
    const win = [
      { t: 0, playhead: 0 },
      { t: 10, playhead: 10 },
      { t: 20, playhead: 20 },
    ];
    const s = tracePolylinePoints(win, (t) => t * 2, yOf);
    expect(s).toBe('0,100 20,90 40,80');
  });

  it('drops sub-pixel runs but keeps >=1px features on either axis', () => {
    const win = [
      { t: 0, playhead: 0 },
      { t: 0.1, playhead: 0.1 },   // sub-px in both -> dropped
      { t: 0.2, playhead: 5 },     // y jumps 5px -> kept despite sub-px x
      { t: 0.3, playhead: 5.1 },   // sub-px again -> dropped
      { t: 9, playhead: 5.2 },     // x moves -> kept
      { t: 9.1, playhead: 5.3 },   // final point -> always kept
    ];
    const s = tracePolylinePoints(win, (t) => t, yOf, 1);
    expect(s.split(' ')).toHaveLength(4);
    expect(s.split(' ')[0]).toBe('0,100');
    expect(s.split(' ')[1]).toBe('0.2,95');
  });

  it('empty window yields empty string', () => {
    expect(tracePolylinePoints([], (t) => t, yOf)).toBe('');
  });
});
