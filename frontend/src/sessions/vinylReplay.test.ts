import { describe, expect, it } from 'vitest';
import type { CaptureEvent } from '../capture/events';
import { createStateIndex, deriveTimeline, stateAt, trackTimeAt } from './timelineModel';
import { planReplay } from './replayPlanner';

const log: CaptureEvent[] = [
  { t: 0, kind: 'load', channel: 'A', trackId: 1, bpm: 120 },
  { t: 0, kind: 'control', channel: 'A', control: 'slipMode', value: 1 },
  { t: 1, kind: 'transport', channel: 'A', action: 'scratchBegin', playhead: 20 },
  { t: 1, kind: 'transport', channel: 'A', action: 'scratchMove', playhead: 20, filter: { drive: -8, rate: -2 } },
  { t: 4, kind: 'transport', channel: 'A', action: 'scratchEnd', playhead: 20 },
  { t: 5, kind: 'tick', playheads: {} },
];

describe('vinyl capture reconstruction', () => {
  it('does not replace an authoritative filter with a coarse tick sampled in an earlier quantum', () => {
    const events: CaptureEvent[] = [...log.slice(0, 4),
      { t: 1.01, kind: 'tick', playheads: { A: 20 } }, ...log.slice(4)];
    expect(stateAt(events, 1.012).decks.A.playhead).toBeCloseTo(stateAt(log, 1.012).decks.A.playhead, 12);
    const result = planReplay(events, 1.012);
    expect(result.ok && result.plan.seed.decks.A.playhead).toBeCloseTo(stateAt(log, 1.012).decks.A.playhead, 12);
  });
  it.each([0, 100])('keeps outward scratch at edge %s silent but detects motion away', position => {
    const outward = position === 0 ? -8 : 8;
    const events: CaptureEvent[] = [
      { t: 0, kind: 'load', channel: 'A', trackId: 1, bpm: 120 },
      { t: 1, kind: 'transport', channel: 'A', action: 'scratchBegin', playhead: position, trackDuration: 100 },
      { t: 1, kind: 'transport', channel: 'A', action: 'scratchMove', playhead: position,
        filter: { drive: outward, rate: 0 }, trackDuration: 100 },
      { t: 1.02, kind: 'transport', channel: 'A', action: 'scratchMove', playhead: position,
        filter: { drive: -outward, rate: 0 }, trackDuration: 100 },
      { t: 2, kind: 'tick', playheads: {} },
    ];
    expect(stateAt(events, 1).decks.A.audible).toBe(false);
    expect(stateAt(events, 1.01).decks.A.audible).toBe(false);
    expect(stateAt(events, 1.02).decks.A.audible).toBe(true);
    expect(deriveTimeline(events).decks.A.audibleSpans[0].start).toBe(1.02);
  });

  it('consumes a slow reverse crossing at loop start without repeated nanosecond wraps', () => {
    for (const duration of [0.0000002, 0.2]) {
      const events: CaptureEvent[] = [
        { t: 0, kind: 'load', channel: 'A', trackId: 1, bpm: 120 },
        { t: 0, kind: 'loop', channel: 'A', region: { start: 10, end: 12 }, playhead: 10 },
        { t: 1, kind: 'transport', channel: 'A', action: 'scratchBegin', playhead: 10 },
        { t: 1, kind: 'transport', channel: 'A', action: 'scratchMove', playhead: 10,
          filter: { drive: 0, rate: -0.05 } },
        { t: 1 + duration, kind: 'tick', playheads: {} },
      ];
      const deck = deriveTimeline(events).decks.A;
      expect(deck.traces.flat().length).toBeLessThan(30);
      expect(trackTimeAt(deck, 1 + duration)).toBeGreaterThan(11.999);
    }
  });

  it('wraps reverse loop motion in state, trace and late-entry replay seed', () => {
    const events: CaptureEvent[] = [
      { t: 0, kind: 'load', channel: 'A', trackId: 1, bpm: 120 },
      { t: 0, kind: 'loop', channel: 'A', region: { start: 10, end: 12 }, playhead: 10.1 },
      { t: 1, kind: 'transport', channel: 'A', action: 'scratchBegin', playhead: 10.1 },
      { t: 1, kind: 'transport', channel: 'A', action: 'scratchMove', playhead: 10.1, filter: { drive: -16, rate: -4 } },
      { t: 2, kind: 'transport', channel: 'A', action: 'scratchEnd', playhead: 10.5 },
      { t: 3, kind: 'tick', playheads: {} },
    ];
    expect(stateAt(events, 1.1).decks.A.playhead).toBeCloseTo(11.94);
    const model = deriveTimeline(events);
    expect(trackTimeAt(model.decks.A, 1.05)).toBeCloseTo(stateAt(events, 1.05).decks.A.playhead, 3);
    const result = planReplay(events, 1.05);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.seed.decks.A.loop).toEqual({ start: 10, end: 12 });
    expect(result.plan.seed.decks.A.playhead).toBeCloseTo(11.94);
    expect(result.plan.seed.decks.A.scratch?.rate).toBeLessThan(0);
    const index = createStateIndex(events, 2);
    for (const t of [1.1, 1.05, 2.5, 1.05]) expect(index.at(t)).toEqual(stateAt(events, t));
  });

  it('reconstructs paused reverse motion, then a silent hold without motion expiry', () => {
    expect(stateAt(log, 1.008).decks.A).toMatchObject({
      playing: false, scratching: true, audible: true, slipMode: true, vinylMode: true,
    });
    expect(stateAt(log, 1.008).decks.A.playhead).toBeCloseTo(19.972975, 5);
    expect(stateAt(log, 1.2).decks.A).toMatchObject({ scratching: true, audible: false });
    expect(stateAt(log, 1.2).decks.A.playhead).toBeCloseTo(19.92);
    expect(stateAt(log, 4.5).decks.A).toMatchObject({ scratching: false, playhead: 20 });
  });

  it('adopts the recorded post-input filter, never re-adds a finite displacement', () => {
    const events: CaptureEvent[] = [
      ...log.slice(0, 4),
      { t: 1.01, kind: 'transport', channel: 'A', action: 'scratchMove', playhead: 19.9,
        deltaSeconds: -100, durationSeconds: 0.001, filter: { drive: -16, rate: -4 } },
      { t: 4, kind: 'tick', playheads: {} },
    ];
    expect(stateAt(events, 2).decks.A.playhead).toBeCloseTo(19.74);
    const index = createStateIndex(events, 2);
    for (const t of [1.02, 1.005, 2.5, 2, 3.5]) expect(index.at(t)).toEqual(stateAt(events, t));
  });

  it('closes audible spans at filter rest and samples curved reverse traces', () => {
    const timeline = deriveTimeline(log);
    const spans = timeline.decks.A.audibleSpans;
    expect(spans).toHaveLength(1);
    expect(spans[0].start).toBe(1);
    expect(spans[0].end).toBeGreaterThan(1.06);
    expect(spans[0].end).toBeLessThan(1.1);
    expect(timeline.audibleTrackIds).toEqual([1]);
    expect(trackTimeAt(timeline.decks.A, 1.008)).toBeCloseTo(19.972975, 4);
    expect(timeline.decks.A.gestures).toEqual([]);
  });

  it('checkpoint reads do not mutate retained filter or stem settings', () => {
    const events: CaptureEvent[] = [
      ...log.slice(0, 4),
      { t: 1.005, kind: 'control', channel: 'A', control: 'stemVocals', value: 0 },
      ...log.slice(4),
    ];
    const index = createStateIndex(events, 2);
    for (const t of [4, 1.002, 1.015, 1.002]) expect(index.at(t)).toEqual(stateAt(events, t));
  });

  it('seeds both filter poles during paused scratch and preserves recorded landing', () => {
    const result = planReplay(log, 1.008);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.seed.decks.A.playing).toBe(false);
    expect(result.plan.seed.decks.A.playhead).toBeCloseTo(19.972975, 5);
    expect(result.plan.seed.decks.A.scratch!.drive).toBeCloseTo(-2.943036, 5);
    expect(result.plan.seed.decks.A.scratch!.rate).toBeCloseTo(-3.678794, 5);
    expect(result.plan.cues[0]).toMatchObject({ kind: 'scratchEnd', offsetS: 2.992, playhead: 20 });
    const whole = planReplay(log, 0);
    expect(whole.ok && whole.plan.cues.map(c => c.kind)).toEqual(['scratchBegin', 'scratchMove', 'scratchEnd', 'sync']);
  });
});
