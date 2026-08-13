/**
 * Session timeline read model tests (sessions 04). Synthetic streams use
 * the real capture vocabulary, as the detector suite does. Covers the
 * derivation the view draws and the session-time↔track-time map the
 * waveform lanes ride on.
 */
import { describe, expect, it } from 'vitest';
import type { CaptureEvent } from '../capture/events';
import {
  COLLAPSED_MARKER_PX,
  buildTimeAxis,
  deriveTimeline,
  gainAt,
  stateAt,
  trackTimeAt,
} from './timelineModel';

function seed(t: number): CaptureEvent[] {
  const evs: CaptureEvent[] = [];
  for (const ch of ['A', 'B', 'C', 'D'] as const) {
    evs.push({ t, kind: 'control', control: 'fader', channel: ch, value: 1 });
    evs.push({ t, kind: 'control', control: 'trim', channel: ch, value: 0.5 });
    evs.push({
      t,
      kind: 'control',
      control: 'crossfaderAssignment',
      channel: ch,
      value: ch === 'A' || ch === 'C' ? -1 : 1,
    });
  }
  evs.push({ t, kind: 'control', control: 'crossfaderEnabled', channel: null, value: 0 });
  return evs;
}

describe('deriveTimeline', () => {
  it('audibility follows the fader, not just transport', () => {
    const events: CaptureEvent[] = [
      ...seed(0),
      { t: 1, kind: 'load', channel: 'A', trackId: 7, bpm: 174 },
      { t: 2, kind: 'transport', channel: 'A', action: 'play', playhead: 0 },
      { t: 10, kind: 'control', control: 'fader', channel: 'A', value: 0 },
      { t: 20, kind: 'transport', channel: 'A', action: 'pause', playhead: 18 },
    ];
    const m = deriveTimeline(events);
    expect(m.decks.A.audibleSpans).toEqual([{ start: 2, end: 10 }]);
    expect(m.decks.A.playingSpans).toEqual([{ start: 2, end: 20 }]);
    expect(m.decks.A.trackSpans).toEqual([{ start: 1, end: 20, trackId: 7 }]);
  });

  it('tenure masks audibility and produces a labeled hold', () => {
    const events: CaptureEvent[] = [
      ...seed(0),
      { t: 1, kind: 'load', channel: 'A', trackId: 7, bpm: 174 },
      { t: 2, kind: 'transport', channel: 'A', action: 'play', playhead: 0 },
      { t: 5, kind: 'tenure', edge: 'start', holder: 'editor' },
      { t: 15, kind: 'tenure', edge: 'end', holder: 'shared' },
      { t: 30, kind: 'transport', channel: 'A', action: 'pause', playhead: 28 },
    ];
    const m = deriveTimeline(events);
    expect(m.tenures).toEqual([{ start: 5, end: 15, holder: 'editor', open: false }]);
    expect(m.decks.A.audibleSpans).toEqual([
      { start: 2, end: 5 },
      { start: 15, end: 30 },
    ]);
    expect(m.idle).toEqual([{ start: 0, end: 2 }]);
  });

  it('an unclosed tenure at log end is marked open', () => {
    const events: CaptureEvent[] = [
      ...seed(0),
      { t: 5, kind: 'tenure', edge: 'start', holder: 'conductor' },
      { t: 20, kind: 'tick', playheads: {} },
    ];
    const m = deriveTimeline(events);
    expect(m.tenures).toEqual([{ start: 5, end: 20, holder: 'conductor', open: true }]);
  });

  it('idle spans open when nothing is audible and close on resume', () => {
    const events: CaptureEvent[] = [
      ...seed(0),
      { t: 1, kind: 'load', channel: 'A', trackId: 7, bpm: 174 },
      { t: 2, kind: 'transport', channel: 'A', action: 'play', playhead: 0 },
      { t: 10, kind: 'transport', channel: 'A', action: 'pause', playhead: 8 },
      { t: 500, kind: 'transport', channel: 'A', action: 'play', playhead: 8 },
      { t: 510, kind: 'transport', channel: 'A', action: 'pause', playhead: 18 },
    ];
    const m = deriveTimeline(events);
    expect(m.idle).toEqual([
      { start: 0, end: 2 },
      { start: 10, end: 500 },
    ]);
  });

  it('>2 audible decks open a suspended span', () => {
    const events: CaptureEvent[] = [
      ...seed(0),
      { t: 1, kind: 'load', channel: 'A', trackId: 1, bpm: 174 },
      { t: 1, kind: 'load', channel: 'B', trackId: 2, bpm: 174 },
      { t: 1, kind: 'load', channel: 'C', trackId: 3, bpm: 174 },
      { t: 2, kind: 'transport', channel: 'A', action: 'play', playhead: 0 },
      { t: 3, kind: 'transport', channel: 'B', action: 'play', playhead: 0 },
      { t: 4, kind: 'transport', channel: 'C', action: 'play', playhead: 0 },
      { t: 9, kind: 'transport', channel: 'C', action: 'pause', playhead: 5 },
      { t: 20, kind: 'transport', channel: 'A', action: 'pause', playhead: 18 },
    ];
    const m = deriveTimeline(events);
    expect(m.suspended).toEqual([{ start: 4, end: 9 }]);
    expect(m.overlaps.length).toBeGreaterThan(0);
    expect(m.trackIds.sort()).toEqual([1, 2, 3]);
  });

  it('an empty log derives an empty, zero-span model', () => {
    const m = deriveTimeline([]);
    expect(m.start).toBe(0);
    expect(m.end).toBe(0);
    expect(m.eventCount).toBe(0);
    expect(m.decks.A.audibleSpans).toEqual([]);
  });
});

describe('buildTimeAxis (idle collapse)', () => {
  const events: CaptureEvent[] = [
    ...seed(0),
    { t: 1, kind: 'load', channel: 'A', trackId: 7, bpm: 174 },
    { t: 2, kind: 'transport', channel: 'A', action: 'play', playhead: 0 },
    { t: 100, kind: 'transport', channel: 'A', action: 'pause', playhead: 98 },
    { t: 1000, kind: 'transport', channel: 'A', action: 'play', playhead: 98 },
    { t: 1100, kind: 'transport', channel: 'A', action: 'pause', playhead: 198 },
  ];
  const m = deriveTimeline(events);

  it('collapses long idle into a FIXED-px segment; px is monotonic', () => {
    const axis = buildTimeAxis(m, { collapseIdle: true, thresholdS: 45, pxPerSec: 2 });
    const collapsed = axis.segments.filter((s) => s.collapsed);
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0].start).toBe(100);
    expect(collapsed[0].end).toBe(1000);
    expect(collapsed[0].px1 - collapsed[0].px0).toBe(COLLAPSED_MARKER_PX);
    // 200s visible at 2 px/s + one marker.
    expect(axis.totalPx).toBeCloseTo(200 * 2 + COLLAPSED_MARKER_PX, 5);
    for (const t of [2, 50, 99, 1001, 1099]) {
      expect(axis.pxToT(axis.tToPx(t))).toBeCloseTo(t, 3);
    }
    let prev = -1;
    for (let t = 0; t <= 1100; t += 10) {
      const x = axis.tToPx(t);
      expect(x).toBeGreaterThanOrEqual(prev);
      prev = x;
    }
  });

  it('the collapsed marker keeps its px size across zoom (no cursor drift)', () => {
    const z1 = buildTimeAxis(m, { collapseIdle: true, thresholdS: 45, pxPerSec: 1 });
    const z8 = buildTimeAxis(m, { collapseIdle: true, thresholdS: 45, pxPerSec: 8 });
    const c1 = z1.segments.find((s) => s.collapsed)!;
    const c8 = z8.segments.find((s) => s.collapsed)!;
    expect(c1.px1 - c1.px0).toBe(COLLAPSED_MARKER_PX);
    expect(c8.px1 - c8.px0).toBe(COLLAPSED_MARKER_PX);
    // Distances between times strictly OUTSIDE the marker scale exactly
    // with pxPerSec: cursor anchoring on time holds through zoom. (1000
    // itself is the marker's end and maps to its fixed midpoint.)
    expect(z8.tToPx(1050) - z8.tToPx(1001)).toBeCloseTo((z1.tToPx(1050) - z1.tToPx(1001)) * 8, 5);
  });

  it('respects the expanded set and the collapse toggle', () => {
    const off = buildTimeAxis(m, { collapseIdle: false, thresholdS: 45, pxPerSec: 2 });
    expect(off.segments.every((s) => !s.collapsed)).toBe(true);
    const idx = m.idle.findIndex((sp) => sp.start === 100);
    const expanded = buildTimeAxis(m, {
      collapseIdle: true,
      thresholdS: 45,
      expanded: new Set([idx]),
      pxPerSec: 2,
    });
    expect(expanded.segments.every((s) => !s.collapsed)).toBe(true);
  });
});

describe('stateAt', () => {
  it('reconstructs deck state and extrapolates the playhead', () => {
    const events: CaptureEvent[] = [
      ...seed(0),
      { t: 1, kind: 'load', channel: 'A', trackId: 7, bpm: 174 },
      { t: 2, kind: 'transport', channel: 'A', action: 'play', playhead: 10 },
      { t: 5, kind: 'tick', playheads: { A: 13 } },
      { t: 30, kind: 'transport', channel: 'A', action: 'pause', playhead: 38 },
    ];
    const at12 = stateAt(events, 12);
    expect(at12.decks.A.trackId).toBe(7);
    expect(at12.decks.A.playing).toBe(true);
    expect(at12.decks.A.audible).toBe(true);
    expect(at12.decks.A.playhead).toBeCloseTo(20, 5);
    expect(at12.eventsAfter).toBe(1);

    const at40 = stateAt(events, 40);
    expect(at40.decks.A.playing).toBe(false);
    expect(at40.decks.A.playhead).toBeCloseTo(38, 5);
  });

  it('carries the mixer + tenure state replay will seed from', () => {
    const events: CaptureEvent[] = [
      ...seed(0),
      { t: 1, kind: 'control', control: 'crossfader', channel: null, value: 0.5 },
      { t: 2, kind: 'tenure', edge: 'start', holder: 'editor' },
    ];
    const at3 = stateAt(events, 3);
    expect(at3.crossfader).toBe(0.5);
    expect(at3.tenureHolder).toBe('editor');
    // Nothing is audible under a tenure hold.
    expect(Object.values(at3.decks).every((d) => !d.audible)).toBe(true);
  });
});

describe('trackTimeAt (session time → track time for waveforms)', () => {
  it('interpolates linearly within a playing trace, null outside', () => {
    // ~1 Hz ticks, as the real recorder emits — so the trace stays whole.
    const events: CaptureEvent[] = [
      ...seed(0),
      { t: 1, kind: 'load', channel: 'A', trackId: 7, bpm: 174 },
      { t: 2, kind: 'transport', channel: 'A', action: 'play', playhead: 100 },
      { t: 3, kind: 'tick', playheads: { A: 101 } },
      { t: 4, kind: 'tick', playheads: { A: 102 } },
      { t: 5, kind: 'tick', playheads: { A: 103 } },
      { t: 6, kind: 'tick', playheads: { A: 104 } },
      { t: 7, kind: 'tick', playheads: { A: 105 } },
      { t: 8, kind: 'transport', channel: 'A', action: 'pause', playhead: 106 },
    ];
    const m = deriveTimeline(events);
    // Midway between t=5 (103) and t=6 (104): t=5.5 → 103.5.
    expect(trackTimeAt(m.decks.A, 5.5)).toBeCloseTo(103.5, 5);
    // Exactly on a sample.
    expect(trackTimeAt(m.decks.A, 5)).toBeCloseTo(103, 5);
    // Before the trace / on a deck that never played → null.
    expect(trackTimeAt(m.decks.A, 0.5)).toBeNull();
    expect(trackTimeAt(m.decks.B, 5)).toBeNull();
  });

  it('breaks the trace across a >4s sample gap (missing ticks)', () => {
    // A gap with no ticks is a genuine discontinuity — no interpolation
    // across it (the deck may have been seeked/displaced meanwhile).
    const events: CaptureEvent[] = [
      ...seed(0),
      { t: 2, kind: 'transport', channel: 'A', action: 'play', playhead: 0 },
      { t: 3, kind: 'tick', playheads: { A: 1 } },
      { t: 20, kind: 'tick', playheads: { A: 18 } },
      { t: 21, kind: 'transport', channel: 'A', action: 'pause', playhead: 19 },
    ];
    const m = deriveTimeline(events);
    expect(trackTimeAt(m.decks.A, 11)).toBeNull();
  });
});

describe('gesture marks, loops, gain steps (04 iteration)', () => {
  it('collects seek/jump/hotCue gesture marks with physical identity', () => {
    const events: CaptureEvent[] = [
      ...seed(0),
      { t: 1, kind: 'load', channel: 'C', trackId: 7, bpm: 174 },
      { t: 2, kind: 'transport', channel: 'C', action: 'play', playhead: 0 },
      { t: 5, kind: 'transport', channel: 'C', action: 'seek', playhead: 32 },
      { t: 7, kind: 'transport', channel: 'C', action: 'jumpBeats', playhead: 48.5, detail: 16 },
      { t: 9, kind: 'transport', channel: 'C', action: 'hotCue', playhead: 64, detail: 2 },
      { t: 11, kind: 'transport', channel: 'C', action: 'pause', playhead: 66 },
    ];
    const m = deriveTimeline(events);
    expect(m.decks.C.gestures).toEqual([
      { t: 5, action: 'seek', playhead: 32, detail: undefined },
      { t: 7, action: 'jumpBeats', playhead: 48.5, detail: 16 },
      { t: 9, action: 'hotCue', playhead: 64, detail: 2 },
    ]);
    expect(m.decks.A.gestures).toEqual([]);
  });

  it('builds loop spans from engage/resize/release; load clears; log end leaves open', () => {
    const events: CaptureEvent[] = [
      ...seed(0),
      { t: 1, kind: 'load', channel: 'A', trackId: 7, bpm: 174 },
      { t: 2, kind: 'transport', channel: 'A', action: 'play', playhead: 0 },
      { t: 4, kind: 'loop', channel: 'A', playhead: 2, region: { start: 2, end: 4 } },
      { t: 6, kind: 'loop', channel: 'A', playhead: 3, region: { start: 2, end: 6 } }, // resize
      { t: 8, kind: 'loop', channel: 'A', playhead: 5, region: null }, // release
      { t: 10, kind: 'loop', channel: 'A', playhead: 7, region: { start: 7, end: 9 } },
      { t: 12, kind: 'load', channel: 'A', trackId: 8, bpm: 170 }, // load clears
      { t: 14, kind: 'loop', channel: 'A', playhead: 0, region: { start: 0, end: 2 } },
      { t: 16, kind: 'tick', playheads: { A: 1 } }, // log ends with loop held
    ];
    const m = deriveTimeline(events);
    expect(m.decks.A.loops).toEqual([
      { start: 4, end: 8, region: { start: 2, end: 6 }, open: false },
      { start: 10, end: 12, region: { start: 7, end: 9 }, open: false },
      { start: 14, end: 16, region: { start: 0, end: 2 }, open: true },
    ]);
  });

  it('gain steps track the fader and zero out under tenure', () => {
    const events: CaptureEvent[] = [
      ...seed(0),
      { t: 1, kind: 'load', channel: 'A', trackId: 7, bpm: 174 },
      { t: 2, kind: 'transport', channel: 'A', action: 'play', playhead: 0 },
      { t: 4, kind: 'control', control: 'fader', channel: 'A', value: 0.5 },
      { t: 6, kind: 'tenure', edge: 'start', holder: 'editor' },
      { t: 8, kind: 'tenure', edge: 'end', holder: 'shared' },
      { t: 10, kind: 'transport', channel: 'A', action: 'pause', playhead: 8 },
    ];
    const m = deriveTimeline(events);
    const steps = m.decks.A.gainSteps;
    // play → up; fader half → lower; tenure → 0; end → back; pause → 0.
    expect(steps).toHaveLength(5);
    expect(steps[0].t).toBe(2);
    expect(steps[0].gain).toBeGreaterThan(0);
    expect(steps[1].t).toBe(4);
    expect(steps[1].gain).toBeLessThan(steps[0].gain);
    expect(steps[2]).toEqual({ t: 6, gain: 0 });
    expect(steps[3].t).toBe(8);
    expect(steps[3].gain).toBe(steps[1].gain);
    expect(steps[4]).toEqual({ t: 10, gain: 0 });
    // gainAt lookups.
    expect(gainAt(steps, 1)).toBe(0);
    expect(gainAt(steps, 3)).toBe(steps[0].gain);
    expect(gainAt(steps, 7)).toBe(0);
    expect(gainAt(steps, 9)).toBe(steps[1].gain);
    expect(gainAt(steps, 99)).toBe(0);
  });
});

describe('trace closure at jumps (no waveform gap)', () => {
  it('closes the outgoing trace AT the jump instant, extrapolated', () => {
    const events: CaptureEvent[] = [
      ...seed(0),
      { t: 1, kind: 'load', channel: 'A', trackId: 7, bpm: 174 },
      { t: 2, kind: 'transport', channel: 'A', action: 'play', playhead: 100 },
      { t: 3, kind: 'tick', playheads: { A: 101 } },
      { t: 4, kind: 'tick', playheads: { A: 102 } },
      // Jump 0.7s after the last tick: the old trace must reach 102.7.
      { t: 4.7, kind: 'transport', channel: 'A', action: 'jumpBeats', playhead: 200, detail: 32 },
      { t: 5, kind: 'tick', playheads: { A: 200.3 } },
      { t: 6, kind: 'transport', channel: 'A', action: 'pause', playhead: 201.3 },
    ];
    const m = deriveTimeline(events);
    expect(m.decks.A.traces).toHaveLength(2);
    const [before, after] = m.decks.A.traces;
    // Old trace's last sample sits at the jump instant, not the last tick.
    expect(before.at(-1)!.t).toBeCloseTo(4.7, 5);
    expect(before.at(-1)!.playhead).toBeCloseTo(102.7, 5);
    // New trace starts at the jump instant at the landing position.
    expect(after[0].t).toBeCloseTo(4.7, 5);
    expect(after[0].playhead).toBeCloseTo(200, 5);
    // trackTimeAt has no dead zone around the jump.
    expect(trackTimeAt(m.decks.A, 4.5)).toBeCloseTo(102.5, 3);
    expect(trackTimeAt(m.decks.A, 4.9)).toBeCloseTo(200.2, 1);
  });
});

describe('cue-stab traces (sessions 10)', () => {
  it('a stab opens a trace on previewStart, samples its ticks, and closes on previewEnd', () => {
    // A CUE stab: previewing flips, `playing` never does. The stab's moving
    // playhead rides the ticks; the trace renders like any playing stretch.
    const events: CaptureEvent[] = [
      ...seed(0),
      { t: 1, kind: 'load', channel: 'B', trackId: 9, bpm: 140 },
      { t: 5, kind: 'transport', channel: 'B', action: 'previewStart', playhead: 60 },
      { t: 6, kind: 'tick', playheads: { B: 61 } },
      { t: 7, kind: 'tick', playheads: { B: 62 } },
      // Release: cue-up returns the playhead to the cue point (a cue return).
      { t: 8, kind: 'transport', channel: 'B', action: 'previewEnd', playhead: 60 },
    ];
    const m = deriveTimeline(events);
    expect(m.decks.B.traces).toHaveLength(1);
    const trace = m.decks.B.traces[0];
    expect(trace[0]).toMatchObject({ t: 5, playhead: 60 });
    // The snap-back to the cue point at release is a discontinuity — the
    // guard closes the trace at the last real sample; no snap-back line.
    expect(trace.at(-1)!).toMatchObject({ t: 7, playhead: 62 });
    // The waveform map works inside the stab like any playing trace.
    expect(trackTimeAt(m.decks.B, 6.5)).toBeCloseTo(61.5, 5);
    // The stab is NOT a playing span (previewing, not playing).
    expect(m.decks.B.playingSpans).toEqual([]);
  });

  it('tick playheads of a non-previewing, non-playing deck stay ignored', () => {
    const events: CaptureEvent[] = [
      ...seed(0),
      { t: 1, kind: 'load', channel: 'A', trackId: 7, bpm: 174 },
      { t: 2, kind: 'tick', playheads: { A: 10 } },
      { t: 3, kind: 'tick', playheads: { A: 11 } },
    ];
    const m = deriveTimeline(events);
    expect(m.decks.A.traces).toEqual([]);
  });
});
