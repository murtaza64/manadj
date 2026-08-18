/**
 * Waveform-lane mixer modulation (sessions 19): the recorded channel strip
 * → per-column modulation, through the REAL gain curves (mixerMath /
 * graph) — render-only, audibility untouched.
 */
import { describe, expect, it } from 'vitest';
import { channelFaderToGain, trimToGain } from '../playback/mixerMath';
import { eqValueToGain } from '../playback/graph';
import type { DeckControlSteps } from './timelineModel';
import { columnModulation } from './waveformLanes';

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

  it('trim scales with the dB curve, capped at 1 above nominal', () => {
    const c = controls({
      trim: [
        { t: 0, gain: 0.5 },
        { t: 5, gain: 0.25 },
        { t: 9, gain: 1 },
      ],
    });
    // -12 dB relative to the -6 dB center: exact curve ratio.
    expect(columnModulation(c, 6).scale).toBeCloseTo(trimToGain(0.25) / trimToGain(0.5), 10);
    // Boosted above nominal: capped — the waveform must not overflow.
    expect(columnModulation(c, 10).scale).toBe(1);
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
