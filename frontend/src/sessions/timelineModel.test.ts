/**
 * Session timeline read model tests (sessions 04). Synthetic streams use
 * the real capture vocabulary, as the detector suite does. Covers the
 * derivation the view draws and the session-time↔track-time map the
 * waveform lanes ride on.
 */
import { describe, expect, it } from 'vitest';
import type { CaptureEvent } from '../capture/events';
import {
  buildTimeAxis,
  deriveTimeline,
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

  it('collapses long idle into a fixed-width segment; x is monotonic', () => {
    const axis = buildTimeAxis(m, { collapseIdle: true, thresholdS: 45 });
    const collapsed = axis.segments.filter((s) => s.collapsed);
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0].start).toBe(100);
    expect(collapsed[0].end).toBe(1000);
    expect(collapsed[0].x1 - collapsed[0].x0).toBeLessThan(0.05);
    for (const t of [2, 50, 99, 1001, 1099]) {
      expect(axis.xToT(axis.tToX(t))).toBeCloseTo(t, 3);
    }
    let prev = -1;
    for (let t = 0; t <= 1100; t += 10) {
      const x = axis.tToX(t);
      expect(x).toBeGreaterThanOrEqual(prev);
      prev = x;
    }
  });

  it('respects the expanded set and the collapse toggle', () => {
    const off = buildTimeAxis(m, { collapseIdle: false, thresholdS: 45 });
    expect(off.segments.every((s) => !s.collapsed)).toBe(true);
    const idx = m.idle.findIndex((sp) => sp.start === 100);
    const expanded = buildTimeAxis(m, {
      collapseIdle: true,
      thresholdS: 45,
      expanded: new Set([idx]),
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
