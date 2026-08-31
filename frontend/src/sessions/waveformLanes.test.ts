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
  createColumnModulator,
  createMonotonicPxToT,
  createMonotonicTToPx,
  decimatePlayheadTrace,
  tracePolylinePoints,
  traceRuns,
} from './waveformLanes';
import type { DeckTimeline } from './timelineModel';

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

  it('tToPx answers px0 at the first segment start when px0 ≠ 0 (gh#220)', () => {
    // The routine editor's drawSlotWave axis starts wherever the earliest
    // run sits on screen — including NEGATIVE px when scrolled. The old
    // hardcoded `return 0` pinned that run's left edge to the viewport,
    // stretching its content against a fixed right edge, re-proportioned
    // every scroll step.
    const axis: TimeAxis = {
      segments: [{ start: -16, end: 1280, px0: -300, px1: 900, collapsed: false }],
      tToPx: (t) => -300 + ((t + 16) / 1296) * 1200,
      pxToT: (x) => -16 + ((x + 300) / 1200) * 1296,
      totalPx: 900,
      visibleDurationS: 1296,
      pxPerSec: 1200 / 1296,
    };
    const cursor = createMonotonicTToPx(axis);
    expect(cursor(-16)).toBeCloseTo(-300, 9); // was 0 — the shear
    expect(cursor(-20)).toBeCloseTo(-300, 9); // before-start clamps to px0
    for (let t = -16; t <= 1280; t += 37) {
      expect(cursor(t)).toBeCloseTo(axis.tToPx(t), 9);
    }
  });
});

// ── Zoom-adaptive run decimation (low-zoom repaint stalls) ───────────────

const deckWithTrace = (trace: { t: number; playhead: number }[]): DeckTimeline =>
  ({ traces: [trace] }) as unknown as DeckTimeline;

describe('traceRuns decimation', () => {
  /** 1 Hz samples whose rate wiggles ±0.1 every second — a jog-heavy
   * trace that cuts into one run PER SAMPLE at the default tolerance. */
  const jitteryTrace = () => {
    const trace: { t: number; playhead: number }[] = [{ t: 0, playhead: 0 }];
    for (let i = 1; i <= 100; i++) {
      trace.push({ t: i, playhead: trace[i - 1].playhead + (i % 2 === 0 ? 1.1 : 0.9) });
    }
    return trace;
  };

  it('minDtS collapses sub-sample rate wiggles into few runs', () => {
    const deck = deckWithTrace(jitteryTrace());
    const fine = traceRuns(deck);
    const coarse = traceRuns(deck, undefined, 8);
    expect(fine.length).toBeGreaterThan(50);
    expect(coarse.length).toBeLessThan(fine.length / 5);
    // Endpoints survive decimation exactly.
    expect(coarse[0].t0).toBe(0);
    expect(coarse[coarse.length - 1].t1).toBe(100);
    expect(coarse[coarse.length - 1].ph1).toBeCloseTo(100, 9);
  });

  it('minDtS = 0 is the identity (default behavior unchanged)', () => {
    const deck = deckWithTrace(jitteryTrace());
    expect(traceRuns(deck, undefined, 0)).toEqual(traceRuns(deck));
  });

  it('short traces pass through untouched', () => {
    const deck = deckWithTrace([
      { t: 0, playhead: 0 },
      { t: 1, playhead: 1 },
    ]);
    expect(traceRuns(deck, undefined, 30)).toEqual([{ t0: 0, t1: 1, ph0: 0, ph1: 1 }]);
  });

  it('a seek inside the decimation window survives (minPh)', () => {
    // Steady playback, then a big seek at t=10, then steady again.
    const trace: { t: number; playhead: number }[] = [];
    for (let i = 0; i <= 20; i++) {
      trace.push({ t: i, playhead: i < 10 ? i : i + 120 });
    }
    const thin = decimatePlayheadTrace(trace, 30, 60);
    // Endpoints + the seek landing point survive.
    expect(thin[0]).toEqual({ t: 0, playhead: 0 });
    expect(thin.some((p) => p.playhead >= 130 && p.t <= 11)).toBe(true);
    // Without minPh the seek would vanish into one straight run.
    expect(decimatePlayheadTrace(trace, 30)).toHaveLength(2);
  });
});

describe('createColumnModulator', () => {
  it('agrees with columnModulation over a monotonic sweep and after rewind', () => {
    const c = controls({
      fader: [
        { t: 0, gain: 1 },
        { t: 5, gain: 0.5 },
        { t: 9, gain: 0 },
      ],
      eqLow: [
        { t: 0, gain: 0.5 },
        { t: 6, gain: 0 },
      ],
      trim: [
        { t: 0, gain: 0.5 },
        { t: 7, gain: 1 },
      ],
    });
    const mod = createColumnModulator(c);
    for (let t = -1; t <= 12; t += 0.25) {
      expect(mod(t)).toEqual(columnModulation(c, t));
    }
    // Defensive rewind: a backward step still matches.
    expect(mod(2)).toEqual(columnModulation(c, 2));
  });

  it('empty series fall back to strip defaults', () => {
    const empty = { fader: [], trim: [], eqLow: [], eqMid: [], eqHigh: [] };
    const mod = createColumnModulator(empty);
    expect(mod(5)).toEqual(columnModulation(empty, 5));
    expect(mod(5).eq).toEqual([1, 1, 1]);
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
