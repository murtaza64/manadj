/**
 * Deck audibility — the shared definition (sessions 04). These lock the
 * extracted seam so the detector and the Session timeline can never drift.
 * The detector's own scenarios still live in detector.test.ts; here we
 * pin the primitive directly.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_DETECTOR_PARAMS } from './events';
import { deckMasterGain, isDeckAudible } from './audibility';
import type { AudibleDeckInputs, AudibleMixerInputs } from './audibility';

const FLAT_MIXER: AudibleMixerInputs = { crossfader: 0, crossfaderEnabled: false };

function deck(over: Partial<AudibleDeckInputs> = {}): AudibleDeckInputs {
  return {
    playing: true,
    fader: 1,
    trim: 0.5,
    eq: { low: 0.5, mid: 0.5, high: 0.5 },
    filter: 0,
    assignment: 'left',
    ...over,
  };
}

const P = DEFAULT_DETECTOR_PARAMS;

describe('isDeckAudible', () => {
  it('a playing, fader-up, flat deck is audible', () => {
    expect(isDeckAudible(deck(), FLAT_MIXER, P)).toBe(true);
  });

  it('a stopped deck is never audible', () => {
    expect(isDeckAudible(deck({ playing: false }), FLAT_MIXER, P)).toBe(false);
  });

  it('fader at zero silences (gain below audibleGain)', () => {
    expect(isDeckAudible(deck({ fader: 0 }), FLAT_MIXER, P)).toBe(false);
  });

  it('an EQ full-kill silences even with fader up', () => {
    expect(isDeckAudible(deck({ eq: { low: 0, mid: 0, high: 0 } }), FLAT_MIXER, P)).toBe(false);
  });

  it('a single band up is NOT a full-kill', () => {
    expect(isDeckAudible(deck({ eq: { low: 0, mid: 0, high: 0.5 } }), FLAT_MIXER, P)).toBe(true);
  });

  it('a filter ridden to the extreme silences', () => {
    expect(isDeckAudible(deck({ filter: 1 }), FLAT_MIXER, P)).toBe(false);
    expect(isDeckAudible(deck({ filter: -1 }), FLAT_MIXER, P)).toBe(false);
  });

  it('the crossfader can silence a deck on the far side', () => {
    // Deck on the left; crossfader hard right, enabled → left is silent.
    const mixer: AudibleMixerInputs = { crossfader: 1, crossfaderEnabled: true };
    expect(isDeckAudible(deck({ assignment: 'left' }), mixer, P)).toBe(false);
    expect(isDeckAudible(deck({ assignment: 'right' }), mixer, P)).toBe(true);
    // A thru-routed deck ignores the crossfader.
    expect(isDeckAudible(deck({ assignment: 'thru' }), mixer, P)).toBe(true);
  });
});

describe('deckMasterGain', () => {
  it('at fader up / trim center reflects the trim-center gain staging', () => {
    // Trim center is TRIM_CENTER_DB (−6 dB) of headroom, so a nominally
    // "up" deck sits at ~0.5 linear, not 1 — the detector's own staging.
    const g = deckMasterGain(deck(), FLAT_MIXER);
    expect(g).toBeGreaterThan(0.4);
    expect(g).toBeLessThan(0.6);
    expect(g).toBeGreaterThanOrEqual(DEFAULT_DETECTOR_PARAMS.audibleGain);
  });

  it('falls to zero as the fader closes', () => {
    expect(deckMasterGain(deck({ fader: 0 }), FLAT_MIXER)).toBeCloseTo(0, 5);
  });

  it('a higher trim raises the gain above center', () => {
    expect(deckMasterGain(deck({ trim: 1 }), FLAT_MIXER)).toBeGreaterThan(
      deckMasterGain(deck({ trim: 0.5 }), FLAT_MIXER)
    );
  });
});
