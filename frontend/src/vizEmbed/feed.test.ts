import { describe, expect, it } from 'vitest';
import { createAndroidFeed, mixBands, type HostDeck } from './feed';

const deck = (over: Partial<HostDeck> = {}): HostDeck => ({
  ch: 'A', bands: [0.3, 0.3, 0.2, 0.1, 0.08, 0.05, 0.03, 0.01], gain: 1, playing: true, pos: 10,
  bpm: 120, anchor: 0, rate: 1, eq: [0.5, 0.5, 0.5], fader: 1, trackId: 7, ...over,
});

function run(decks: HostDeck[], seconds = 2) {
  const feed = createAndroidFeed();
  let frame = feed.frameAt({ decks }, 1 / 30, {});
  for (let i = 0; i < seconds * 30; i++) frame = feed.frameAt({ decks }, 1 / 30, {});
  return frame;
}

describe('android visualizer feed', () => {
  it('is silent without playing decks', () => {
    const f = run([deck({ playing: false })]);
    expect(f.bands).toEqual({ low: 0, mid: 0, high: 0 });
    expect(f.beat).toBeNull();
  });

  it('a loud playing deck drives bands and locks the beat to its grid', () => {
    const f = run([deck({ pos: 10.25 })]);
    expect(f.bands.low).toBeGreaterThan(0.3);
    expect(f.dominantChannel).toBe('A');
    // 120 bpm, anchor 0: 10.25 s = beat 20.5 → offbeat of bar 5, beat 1 (0-based).
    expect(f.beat?.phase).toBeCloseTo(0.5);
    expect(f.beat?.beatInBar).toBe(0);
    expect(f.beat?.barIndex).toBe(5);
  });

  it('a faded-out deck contributes nothing', () => {
    expect(mixBands([deck({ gain: 0 })]).every((a) => a === 0)).toBe(true);
    expect(run([deck({ gain: 0 })]).bands.low).toBe(0);
  });
});
