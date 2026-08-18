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
  collapseCandidates,
  createStateIndex,
  deriveTimeline,
  gainAt,
  stateAt,
  traceWindow,
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
    // The launch is a CUE press: it gets the ▲ marker (sessions 11).
    expect(m.decks.B.gestures).toContainEqual(
      expect.objectContaining({ t: 5, action: 'cue', playhead: 60 })
    );
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
describe('audibleTrackIds (distinct Master-audible Track count)', () => {
  it('counts a Track that became audible; not one only loaded/silent', () => {
    const events: CaptureEvent[] = [
      ...seed(0),
      { t: 1, kind: 'load', channel: 'A', trackId: 7, bpm: 174 },
      { t: 2, kind: 'transport', channel: 'A', action: 'play', playhead: 0 },
      { t: 10, kind: 'transport', channel: 'A', action: 'pause', playhead: 8 },
      // B loaded and even played, but fader down the whole time → silent.
      { t: 3, kind: 'load', channel: 'B', trackId: 9, bpm: 172 },
      { t: 4, kind: 'control', control: 'fader', channel: 'B', value: 0 },
      { t: 5, kind: 'transport', channel: 'B', action: 'play', playhead: 0 },
      { t: 11, kind: 'transport', channel: 'B', action: 'pause', playhead: 6 },
    ];
    const m = deriveTimeline(events);
    expect(m.audibleTrackIds).toEqual([7]);
  });

  it('repeated audible plays of the same Track count once', () => {
    const events: CaptureEvent[] = [
      ...seed(0),
      { t: 1, kind: 'load', channel: 'A', trackId: 7, bpm: 174 },
      { t: 2, kind: 'transport', channel: 'A', action: 'play', playhead: 0 },
      { t: 6, kind: 'transport', channel: 'A', action: 'pause', playhead: 4 },
      // Same track brought back on deck C later.
      { t: 8, kind: 'load', channel: 'C', trackId: 7, bpm: 174 },
      { t: 9, kind: 'transport', channel: 'C', action: 'play', playhead: 0 },
      { t: 14, kind: 'transport', channel: 'C', action: 'pause', playhead: 5 },
    ];
    const m = deriveTimeline(events);
    expect(m.audibleTrackIds).toEqual([7]);
  });

  it('a Track only audible under a machine tenure does NOT count', () => {
    const events: CaptureEvent[] = [
      ...seed(0),
      { t: 1, kind: 'tenure', edge: 'start', holder: 'editor' },
      { t: 2, kind: 'load', channel: 'A', trackId: 7, bpm: 174 },
      { t: 3, kind: 'transport', channel: 'A', action: 'play', playhead: 0 },
      { t: 9, kind: 'transport', channel: 'A', action: 'pause', playhead: 6 },
      { t: 10, kind: 'tenure', edge: 'end', holder: 'shared' },
    ];
    const m = deriveTimeline(events);
    // Tenure masks audibility, so nothing counts.
    expect(m.audibleTrackIds).toEqual([]);
  });

  it('counts every distinct audible Track across four decks', () => {
    const evs: CaptureEvent[] = [...seed(0)];
    (['A', 'B', 'C', 'D'] as const).forEach((ch, i) => {
      const id = 10 + i;
      evs.push({ t: 1 + i, kind: 'load', channel: ch, trackId: id, bpm: 174 });
      evs.push({ t: 2 + i, kind: 'transport', channel: ch, action: 'play', playhead: 0 });
      evs.push({ t: 20 + i, kind: 'transport', channel: ch, action: 'pause', playhead: 5 });
    });
    const m = deriveTimeline(evs);
    expect(m.audibleTrackIds.sort((a, b) => a - b)).toEqual([10, 11, 12, 13]);
  });
});

describe('hot-cue stab traces (sessions 11)', () => {
  it("the launch hotCue gesture does not sever the stab's trace (no leading gap)", () => {
    // Real launch order: previewStart (snapshot flip), then the hotCue
    // gesture (handler tap), then ticks. The trace must run from launch.
    const events: CaptureEvent[] = [
      ...seed(0),
      { t: 1, kind: 'load', channel: 'C', trackId: 11, bpm: 128 },
      { t: 5, kind: 'transport', channel: 'C', action: 'previewStart', playhead: 64, detail: 3 },
      { t: 5, kind: 'transport', channel: 'C', action: 'hotCue', playhead: 64, detail: 3 },
      { t: 6, kind: 'tick', playheads: { C: 65 } },
      { t: 7, kind: 'tick', playheads: { C: 66 } },
      // Release snaps back to the slot time (hot-cue-up), like a cue return.
      { t: 8, kind: 'transport', channel: 'C', action: 'previewEnd', playhead: 64 },
    ];
    const m = deriveTimeline(events);
    expect(m.decks.C.traces).toHaveLength(1);
    const trace = m.decks.C.traces[0];
    expect(trace[0]).toMatchObject({ t: 5, playhead: 64 });
    // The snap-back is a discontinuity: the trace ends at the last real sample.
    expect(trace.at(-1)!).toMatchObject({ t: 7, playhead: 66 });
    // The waveform map covers the whole stab, launch included.
    expect(trackTimeAt(m.decks.C, 5.5)).toBeCloseTo(64.5, 5);
    // The gesture mark renders with its slot — and ONLY the hotCue mark
    // (no extra cue-press marker: the slot mark IS the press marker here).
    expect(m.decks.C.gestures).toContainEqual(
      expect.objectContaining({ t: 5, action: 'hotCue', detail: 3 })
    );
    expect(m.decks.C.gestures.filter((g) => g.action === 'cue')).toEqual([]);
    // Still not a playing span.
    expect(m.decks.C.playingSpans).toEqual([]);
  });
});

describe('jog scrub does not explode markers/traces (perf)', () => {
  it('a stream of tiny seeks is one continuous trace, no markers', () => {
    const events: CaptureEvent[] = [
      ...seed(0),
      { t: 1, kind: 'load', channel: 'A', trackId: 7, bpm: 174 },
      { t: 2, kind: 'transport', channel: 'A', action: 'play', playhead: 100 },
    ];
    // 200 rim-tick seeks nudging ±0.3s over 2s (a jog scrub).
    let ph = 100;
    for (let i = 0; i < 200; i++) {
      ph += (i % 3 === 0 ? -0.2 : 0.25);
      events.push({ t: 2 + (i + 1) * 0.01, kind: 'transport', channel: 'A', action: 'seek', playhead: ph });
    }
    events.push({ t: 5, kind: 'transport', channel: 'A', action: 'pause', playhead: ph });
    const m = deriveTimeline(events);
    // No jump markers for the scrub; the whole thing is ~one trace.
    expect(m.decks.A.gestures.filter((g) => g.action === 'seek')).toEqual([]);
    expect(m.decks.A.traces.length).toBeLessThanOrEqual(2);
    // Decimated: far fewer points than seeks.
    expect(m.decks.A.traces.flat().length).toBeLessThan(60);
  });

  it('a genuine leap-seek still marks and breaks', () => {
    const events: CaptureEvent[] = [
      ...seed(0),
      { t: 1, kind: 'load', channel: 'A', trackId: 7, bpm: 174 },
      { t: 2, kind: 'transport', channel: 'A', action: 'play', playhead: 10 },
      { t: 3, kind: 'tick', playheads: { A: 11 } },
      { t: 4, kind: 'transport', channel: 'A', action: 'seek', playhead: 120 }, // leap
      { t: 5, kind: 'tick', playheads: { A: 121 } },
      { t: 6, kind: 'transport', channel: 'A', action: 'pause', playhead: 122 },
    ];
    const m = deriveTimeline(events);
    expect(m.decks.A.gestures.filter((g) => g.action === 'seek')).toHaveLength(1);
    expect(m.decks.A.traces.length).toBe(2);
  });
});

describe('createStateIndex (checkpointed scrub, issue 13)', () => {
  /** A synthetic multi-deck log big enough to cross several checkpoints:
   * plays, fader moves, ticks, seeks, tenures, pitch — the audibility and
   * extrapolation inputs stateAt reads. */
  function bigLog(n: number): CaptureEvent[] {
    const evs: CaptureEvent[] = [...seed(0)];
    evs.push({ t: 1, kind: 'load', channel: 'A', trackId: 7, bpm: 174 });
    evs.push({ t: 1.5, kind: 'load', channel: 'B', trackId: 9, bpm: 172 });
    evs.push({ t: 2, kind: 'transport', channel: 'A', action: 'play', playhead: 0 });
    for (let i = 0; i < n; i++) {
      const t = 3 + i;
      switch (i % 7) {
        case 0:
          evs.push({ t, kind: 'tick', playheads: { A: t - 2 } });
          break;
        case 1:
          evs.push({ t, kind: 'control', control: 'fader', channel: 'B', value: (i % 10) / 10 });
          break;
        case 2:
          evs.push({ t, kind: 'control', control: 'crossfader', channel: null, value: ((i % 20) - 10) / 10 });
          break;
        case 3:
          evs.push({ t, kind: 'pitch', channel: 'A', value: ((i % 8) - 4) / 2 });
          break;
        case 4:
          evs.push({ t, kind: 'transport', channel: 'B', action: i % 14 === 4 ? 'play' : 'pause', playhead: i });
          break;
        case 5:
          if (i % 21 === 5) evs.push({ t, kind: 'tenure', edge: 'start', holder: 'conductor' });
          else if (i % 21 === 12) evs.push({ t, kind: 'tenure', edge: 'end', holder: 'shared' });
          else evs.push({ t, kind: 'tick', playheads: { A: t - 2, B: i } });
          break;
        default:
          evs.push({ t, kind: 'transport', channel: 'A', action: 'seek', playhead: t } as CaptureEvent);
          break;
      }
    }
    return evs;
  }

  it('matches the naive stateAt exactly across checkpoint boundaries', () => {
    const events = bigLog(3000);
    const index = createStateIndex(events, 256); // several checkpoints
    // Probe T values: before the log, on event instants, between events,
    // straddling checkpoint boundaries, and past the end.
    const probes = [-1, 0, 1.7, 2, 3, 100.5, 258, 259.2, 512, 513.5, 1000, 2047.3, 2500, 9999];
    for (const t of probes) {
      expect(index.at(t)).toEqual(stateAt(events, t));
    }
  });

  it('a probe at every 37th event instant agrees (dense sweep)', () => {
    const events = bigLog(1500);
    const index = createStateIndex(events, 128);
    for (let i = 0; i < events.length; i += 37) {
      const t = events[i].t;
      expect(index.at(t)).toEqual(stateAt(events, t));
    }
  });
});

describe('traceWindow (viewport culling, issue 13)', () => {
  const trace = Array.from({ length: 100 }, (_, i) => ({ t: i * 2, playhead: i }));

  it('returns the original array (no copy) when fully inside', () => {
    expect(traceWindow(trace, -10, 500)).toBe(trace);
  });

  it('returns null when fully outside', () => {
    expect(traceWindow(trace, 300, 400)).toBeNull();
    expect(traceWindow(trace, -50, -1)).toBeNull();
  });

  it('slices to the window with one pad sample either side', () => {
    const win = traceWindow(trace, 50, 60)!;
    // Points at t=50..60 are indices 25..30; padded: 24..31.
    expect(win[0].t).toBeLessThan(50);
    expect(win[win.length - 1].t).toBeGreaterThan(60);
    expect(win.map((p) => p.t)).toEqual([48, 50, 52, 54, 56, 58, 60, 62]);
  });

  it('clamps the pad at the trace edges', () => {
    const head = traceWindow(trace, -5, 4)!;
    expect(head[0].t).toBe(0);
    expect(head[head.length - 1].t).toBe(6);
    const tail = traceWindow(trace, 195, 500)!;
    expect(tail[0].t).toBe(194);
    expect(tail[tail.length - 1].t).toBe(198);
  });

  it('an empty trace is null', () => {
    expect(traceWindow([], 0, 10)).toBeNull();
  });
});

describe('maxPlayhead precompute (issue 13)', () => {
  it('carries the largest trace playhead per deck; floor 1', () => {
    const events: CaptureEvent[] = [
      ...seed(0),
      { t: 1, kind: 'load', channel: 'A', trackId: 7, bpm: 174 },
      { t: 2, kind: 'transport', channel: 'A', action: 'play', playhead: 10 },
      { t: 3, kind: 'tick', playheads: { A: 11 } },
      { t: 4, kind: 'tick', playheads: { A: 12.5 } },
      { t: 5, kind: 'transport', channel: 'A', action: 'pause', playhead: 13 },
    ];
    const m = deriveTimeline(events);
    expect(m.decks.A.maxPlayhead).toBe(13);
    expect(m.decks.B.maxPlayhead).toBe(1); // no traces: the floor
  });
});

describe('tenure collapse (sessions 14)', () => {
  // Play → a 900s editor hold → play again, with a separate 500s idle
  // stretch after: BOTH kinds are collapse candidates.
  const events: CaptureEvent[] = [
    ...seed(0),
    { t: 1, kind: 'load', channel: 'A', trackId: 7, bpm: 174 },
    { t: 2, kind: 'transport', channel: 'A', action: 'play', playhead: 0 },
    { t: 100, kind: 'tenure', edge: 'start', holder: 'replay' },
    { t: 1000, kind: 'tenure', edge: 'end', holder: 'shared' },
    { t: 1100, kind: 'transport', channel: 'A', action: 'pause', playhead: 200 },
    { t: 1600, kind: 'transport', channel: 'A', action: 'play', playhead: 200 },
    { t: 1700, kind: 'transport', channel: 'A', action: 'pause', playhead: 300 },
  ];
  const m = deriveTimeline(events);

  it('candidates carry both kinds, sorted, with holders on tenures', () => {
    const c = collapseCandidates(m);
    const tenure = c.find((sp) => sp.kind === 'tenure');
    const idles = c.filter((sp) => sp.kind === 'idle');
    expect(tenure).toMatchObject({ start: 100, end: 1000, holder: 'replay' });
    expect(idles.some((sp) => sp.start === 1100 && sp.end === 1600)).toBe(true);
    for (let i = 1; i < c.length; i++) expect(c[i].start).toBeGreaterThanOrEqual(c[i - 1].start);
  });

  it('a long tenure collapses to a fixed marker carrying kind/holder/candidateIdx', () => {
    const axis = buildTimeAxis(m, { collapseIdle: true, thresholdS: 45, pxPerSec: 2 });
    const tenureSeg = axis.segments.find((s) => s.collapsed && s.kind === 'tenure');
    expect(tenureSeg).toBeDefined();
    expect(tenureSeg!.start).toBe(100);
    expect(tenureSeg!.end).toBe(1000);
    expect(tenureSeg!.holder).toBe('replay');
    expect(tenureSeg!.px1 - tenureSeg!.px0).toBe(COLLAPSED_MARKER_PX);
    expect(tenureSeg!.candidateIdx).toBe(
      collapseCandidates(m).findIndex((sp) => sp.kind === 'tenure')
    );
    // The idle stretch collapses too — same threshold, one control.
    expect(axis.segments.filter((s) => s.collapsed)).toHaveLength(2);
  });

  it('expanding the tenure leaves the idle collapsed (stable mixed indexing)', () => {
    const c = collapseCandidates(m);
    const tenureIdx = c.findIndex((sp) => sp.kind === 'tenure');
    const axis = buildTimeAxis(m, {
      collapseIdle: true,
      thresholdS: 45,
      expanded: new Set([tenureIdx]),
      pxPerSec: 2,
    });
    const collapsed = axis.segments.filter((s) => s.collapsed);
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0].kind).toBe('idle');
    expect(collapsed[0].start).toBe(1100);
  });

  it('an open tenure at log end collapses too', () => {
    const evs: CaptureEvent[] = [
      ...seed(0),
      { t: 1, kind: 'load', channel: 'A', trackId: 7, bpm: 174 },
      { t: 2, kind: 'transport', channel: 'A', action: 'play', playhead: 0 },
      { t: 10, kind: 'tenure', edge: 'start', holder: 'conductor' },
      { t: 500, kind: 'tick', playheads: {} },
    ];
    const axis = buildTimeAxis(deriveTimeline(evs), {
      collapseIdle: true,
      thresholdS: 45,
      pxPerSec: 2,
    });
    const seg = axis.segments.find((s) => s.collapsed && s.kind === 'tenure');
    expect(seg).toMatchObject({ start: 10, end: 500, holder: 'conductor' });
  });
});
