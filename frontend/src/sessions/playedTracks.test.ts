/**
 * Played Tracks projection (sessions 09, gh#106). Synthetic streams in the
 * real capture vocabulary, mirroring the timeline model's suite.
 */
import { describe, expect, it } from 'vitest';
import type { CaptureEvent } from '../capture/events';
import {
  AudibleSecondsFold,
  PLAYED_THRESHOLD_S,
  audibleSecondsByTrack,
  playedTrackIds,
} from './playedTracks';

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

const load = (t: number, ch: 'A' | 'B' | 'C' | 'D', trackId: number | null): CaptureEvent => ({
  t,
  kind: 'load',
  channel: ch,
  trackId,
  bpm: 174,
});
const play = (t: number, ch: 'A' | 'B' | 'C' | 'D', playhead = 0): CaptureEvent => ({
  t,
  kind: 'transport',
  channel: ch,
  action: 'play',
  playhead,
});
const pause = (t: number, ch: 'A' | 'B' | 'C' | 'D', playhead = 0): CaptureEvent => ({
  t,
  kind: 'transport',
  channel: ch,
  action: 'pause',
  playhead,
});
const fader = (t: number, ch: 'A' | 'B' | 'C' | 'D', value: number): CaptureEvent => ({
  t,
  kind: 'control',
  control: 'fader',
  channel: ch,
  value,
});
const tick = (t: number): CaptureEvent => ({ t, kind: 'tick', playheads: {} });

function played(events: CaptureEvent[]): number[] {
  return [...playedTrackIds(audibleSecondsByTrack(events))].sort((a, b) => a - b);
}

describe('audibleSecondsByTrack', () => {
  it('tallies Master-audible seconds; a load-only or paused Track earns nothing', () => {
    const events = [
      ...seed(0),
      load(1, 'A', 7),
      load(1, 'B', 9),
      play(2, 'A'),
      pause(12, 'A', 10),
      tick(30),
    ];
    const s = audibleSecondsByTrack(events);
    expect(s.get(7)).toBe(10);
    expect(s.has(9)).toBe(false);
  });

  it('fader down / EQ kill / filter kill stop the tally (audibility, not transport)', () => {
    const events = [
      ...seed(0),
      load(1, 'A', 7),
      play(2, 'A'),
      fader(6, 'A', 0),
      tick(20),
      fader(20, 'A', 1),
      { t: 25, kind: 'control', control: 'filter', channel: 'A', value: 1 } as CaptureEvent,
      tick(40),
      { t: 40, kind: 'control', control: 'filter', channel: 'A', value: 0 } as CaptureEvent,
      pause(43, 'A'),
    ];
    // 2→6 (4s) + 20→25 (5s) + 40→43 (3s) = 12s.
    expect(audibleSecondsByTrack(events).get(7)).toBe(12);
  });

  it('a CUE stab (previewStart/previewEnd) is invisible', () => {
    const events: CaptureEvent[] = [
      ...seed(0),
      load(1, 'A', 7),
      { t: 2, kind: 'transport', channel: 'A', action: 'previewStart', playhead: 0 },
      tick(20),
      { t: 40, kind: 'transport', channel: 'A', action: 'previewEnd', playhead: 38 },
    ];
    expect(audibleSecondsByTrack(events).has(7)).toBe(false);
  });

  it('playback under a machine tenure earns nothing', () => {
    const events: CaptureEvent[] = [
      ...seed(0),
      { t: 1, kind: 'tenure', edge: 'start', holder: 'editor' },
      load(2, 'A', 7),
      play(3, 'A'),
      tick(30),
      pause(50, 'A'),
      { t: 51, kind: 'tenure', edge: 'end', holder: 'shared' },
    ];
    expect(audibleSecondsByTrack(events).has(7)).toBe(false);
  });

  it('accumulates across repeated plays and across decks', () => {
    const events = [
      ...seed(0),
      load(1, 'A', 7),
      play(2, 'A'),
      pause(10, 'A'), // 8s
      load(20, 'C', 7),
      play(21, 'C'),
      pause(28, 'C'), // 7s
      load(30, 'A', 7),
      play(31, 'A'),
      pause(37, 'A'), // 6s
    ];
    expect(audibleSecondsByTrack(events).get(7)).toBe(21);
  });

  it('the same Track audible on two decks at once counts once per interval', () => {
    const events = [
      ...seed(0),
      load(1, 'A', 7),
      load(1, 'B', 7),
      play(2, 'A'),
      play(2, 'B'),
      pause(12, 'A'),
      pause(12, 'B'),
    ];
    expect(audibleSecondsByTrack(events).get(7)).toBe(10);
  });

  it('a load swap mid-play attributes time to the right Track', () => {
    const events = [
      ...seed(0),
      load(1, 'A', 7),
      play(2, 'A'),
      // The recorder emits an explicit pause beside every real load.
      pause(10, 'A'),
      load(10, 'A', 8),
      play(11, 'A'),
      pause(20, 'A'),
    ];
    const s = audibleSecondsByTrack(events);
    expect(s.get(7)).toBe(8);
    expect(s.get(8)).toBe(9);
  });

  it('four decks, four distinct Tracks', () => {
    const evs: CaptureEvent[] = [...seed(0)];
    (['A', 'B', 'C', 'D'] as const).forEach((ch, i) => {
      evs.push(load(1, ch, 10 + i));
      evs.push(play(2, ch));
      evs.push(pause(2 + 5 * (i + 1), ch));
    });
    const s = audibleSecondsByTrack(evs);
    expect([...s.entries()].sort((a, b) => a[0] - b[0])).toEqual([
      [10, 5],
      [11, 10],
      [12, 15],
      [13, 20],
    ]);
  });
});

describe('playedTrackIds', () => {
  it('marks strictly past the threshold, not at it', () => {
    const at = [...seed(0), load(1, 'A', 7), play(2, 'A'), pause(2 + PLAYED_THRESHOLD_S, 'A')];
    expect(played(at)).toEqual([]);
    const past = [...seed(0), load(1, 'A', 7), play(2, 'A'), pause(2.5 + PLAYED_THRESHOLD_S, 'A')];
    expect(played(past)).toEqual([7]);
  });

  it('short stabs accumulate: three 8s plays mark, one does not', () => {
    const one = [...seed(0), load(1, 'A', 7), play(2, 'A'), pause(10, 'A')];
    expect(played(one)).toEqual([]);
    const three = [
      ...one,
      play(20, 'A'),
      pause(28, 'A'),
      play(40, 'A'),
      pause(48, 'A'),
    ];
    expect(played(three)).toEqual([7]);
  });

  it('a running deck is credited by ticks, before any pause lands', () => {
    const events = [...seed(0), load(1, 'A', 7), play(2, 'A'), tick(15), tick(23)];
    expect(played(events)).toEqual([7]);
  });
});

describe('AudibleSecondsFold.note', () => {
  it('reports each Track exactly once, on the event that crosses the threshold', () => {
    const fold = new AudibleSecondsFold();
    const crossings: number[][] = [];
    const events = [
      ...seed(0),
      load(1, 'A', 7),
      play(2, 'A'),
      tick(12),
      tick(22),
      tick(23),
      tick(40),
      pause(41, 'A'),
    ];
    for (const e of events) crossings.push(fold.note(e));
    const flat = crossings.flat();
    expect(flat).toEqual([7]);
    // Crossed on the tick(23) event: 21s > 20s; tick(22) = 20s exactly.
    expect(crossings[events.indexOf(events.find((e) => e.t === 23)!)]).toEqual([7]);
  });

  it('agrees with the batch projection', () => {
    const events = [...seed(0), load(1, 'A', 7), play(2, 'A'), pause(24, 'A')];
    const fold = new AudibleSecondsFold();
    for (const event of events) fold.note(event);
    expect(fold.seconds).toEqual(audibleSecondsByTrack(events));
    expect([...playedTrackIds(fold.seconds)]).toEqual([7]);
  });
});
