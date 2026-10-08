import { describe, expect, it } from 'vitest';
import { DEFAULT_BEAT_FX_SETTINGS } from '../playback/beatFxSettings';
import { BEAT_SECONDS_DEFAULT } from '../playback/beatFx';
import { deckBeatSeconds, fxTailSeconds } from './fxTail';
import type { CaptureEvent } from './events';
import { deriveTimeline } from '../sessions/timelineModel';

const G = 0.05;

describe('fxTailSeconds (#355)', () => {
  it('echo: last repeat above audibleGain at the beat-synced delay', () => {
    // wet 1, feedback 0.5: repeats 1, .5, .25, .125, .0625 → 5 audible.
    expect(fxTailSeconds('echo', 1, 0, DEFAULT_BEAT_FX_SETTINGS, 0.5, G)).toBeCloseTo(2.5, 9);
    // Feedback 0: one repeat.
    expect(fxTailSeconds('echo', 1, 0, { ...DEFAULT_BEAT_FX_SETTINGS, echoFeedback: 0 }, 0.5, G)).toBeCloseTo(0.5, 9);
  });

  it('reverb: wet envelope crossing audibleGain, capped at reverbDecay', () => {
    const tau = 2.5 / Math.log(1000);
    expect(fxTailSeconds('reverb', 1, 0, DEFAULT_BEAT_FX_SETTINGS, 0.5, G)).toBeCloseTo(tau * Math.log(20), 9);
    expect(fxTailSeconds('reverb', 1, 0, DEFAULT_BEAT_FX_SETTINGS, 0.5, 1e-6)).toBe(2.5);
  });

  it('no tail at full dry; a quieter wet shortens it', () => {
    expect(fxTailSeconds('echo', 1, -1, DEFAULT_BEAT_FX_SETTINGS, 0.5, G)).toBe(0);
    expect(fxTailSeconds('echo', 1, -0.5, DEFAULT_BEAT_FX_SETTINGS, 0.5, G))
      .toBeLessThan(fxTailSeconds('echo', 1, 0, DEFAULT_BEAT_FX_SETTINGS, 0.5, G));
  });

  it('deckBeatSeconds: BPM at varispeed; 120 BPM stand-in when unknown', () => {
    expect(deckBeatSeconds(120, 0)).toBeCloseTo(0.5, 9);
    expect(deckBeatSeconds(120, 100)).toBeCloseTo(0.25, 9);
    expect(deckBeatSeconds(null, 0)).toBe(BEAT_SECONDS_DEFAULT);
  });
});

describe('Session audibility of tails (#355; mirrors tests/test_session_audibility.py)', () => {
  it('a pre-crossfader echo fed while crossfaded out rings audibly once the crossfader returns', () => {
    const events: CaptureEvent[] = [
      { t: 0, kind: 'load', channel: 'A', trackId: 1, bpm: 174 },
      { t: 0, kind: 'control', control: 'crossfader', channel: null, value: 1 },
      { t: 0.5, kind: 'beatFx', selected: 'echo', target: 'A', on: true, depth: 0, beats: 1 },
      { t: 1, kind: 'transport', channel: 'A', action: 'play', playhead: 0 },
      { t: 2, kind: 'control', control: 'fader', channel: 'A', value: 0 },
      { t: 2.5, kind: 'control', control: 'crossfader', channel: null, value: 0 },
      { t: 10, kind: 'tick', playheads: {} },
    ];
    const spans = deriveTimeline(events).decks.A.audibleSpans;
    expect(spans).toHaveLength(1);
    expect(spans[0].start).toBe(2.5);
    expect(spans[0].end).toBeCloseTo(2 + 5 * (60 / 174), 9);
  });
});
