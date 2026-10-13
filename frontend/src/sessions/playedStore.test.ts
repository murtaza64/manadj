import { beforeEach, expect, it, vi } from 'vitest';
import type { CaptureEvent } from '../capture/events';
import { clearPlayed, notePlayedEvent, playedTracks, resetPlayed, subscribePlayed } from './playedStore';

const load = (t: number, trackId: number): CaptureEvent => ({ t, kind: 'load', channel: 'A', trackId, bpm: 174 });
const play = (t: number): CaptureEvent => ({ t, kind: 'transport', channel: 'A', action: 'play', playhead: 0 });
const pause = (t: number): CaptureEvent => ({ t, kind: 'transport', channel: 'A', action: 'pause', playhead: 0 });
const tick = (t: number): CaptureEvent => ({ t, kind: 'tick', playheads: {} });
const feed = (...events: CaptureEvent[]) => events.forEach(notePlayedEvent);

beforeEach(resetPlayed);

it('notifies only when a Track crosses the strict threshold', () => {
  const notified = vi.fn();
  const unsub = subscribePlayed(notified);
  const before = playedTracks();
  feed(load(1, 7), play(2), tick(12), tick(22));
  expect(playedTracks()).toBe(before);
  feed(tick(23));
  expect([...playedTracks()]).toEqual([7]);
  expect(notified).toHaveBeenCalledTimes(1);
  feed(tick(60));
  expect(notified).toHaveBeenCalledTimes(1);
  unsub();
});

it('recorder restart / Session split clears the set and tally', () => {
  feed(load(1, 7), play(2), tick(30));
  expect(playedTracks().size).toBe(1);
  resetPlayed();
  expect(playedTracks().size).toBe(0);
  feed(load(1, 7), play(2), pause(10));
  expect(playedTracks().size).toBe(0);
});

it('manual clear preserves running deck state but starts timing at the click', () => {
  feed(load(1, 7), play(2), tick(30));
  clearPlayed(30.5);
  expect(playedTracks().size).toBe(0);
  feed(tick(50.5));
  expect(playedTracks().size).toBe(0);
  feed(tick(51));
  expect([...playedTracks()]).toEqual([7]);
});

it('manual clear forgets partial tallies and preserves paused/muted state', () => {
  feed(load(0, 7), play(0), pause(12));
  clearPlayed(15);
  feed(tick(100), play(101), tick(112));
  expect(playedTracks().size).toBe(0);
  feed({ t: 112, kind: 'control', control: 'fader', channel: 'A', value: 0 });
  clearPlayed(113);
  feed(tick(200));
  expect(playedTracks().size).toBe(0);
  feed({ t: 200, kind: 'control', control: 'fader', channel: 'A', value: 1 }, tick(221));
  expect([...playedTracks()]).toEqual([7]);
});

it('a fresh app module has no played history', async () => {
  feed(load(0, 7), play(0), tick(21));
  expect(playedTracks().size).toBe(1);
  vi.resetModules();
  const restarted = await import('./playedStore');
  expect(restarted.playedTracks().size).toBe(0);
});

it('only counts time above the audibility threshold, independently of the bar color blend', () => {
  feed(load(0, 7), play(0), tick(10));
  // A 10% fader still colors the playing bars, but its audio gain is below 0.05.
  feed({ t: 10, kind: 'control', control: 'fader', channel: 'A', value: 0.1 }, tick(100));
  expect(playedTracks().size).toBe(0);
  feed({ t: 100, kind: 'control', control: 'fader', channel: 'A', value: 0.5 }, tick(110));
  expect(playedTracks().size).toBe(0); // exactly 20 audible seconds
  feed(tick(111));
  expect([...playedTracks()]).toEqual([7]);
});
