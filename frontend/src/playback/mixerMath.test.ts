import { describe, expect, it } from 'vitest';
import {
  channelFaderToGain,
  crossfaderGains,
  cueLevelToGain,
  cueMixGains,
  trimToGain,
} from './mixerMath';

describe('channelFaderToGain', () => {
  it('is silent at the bottom', () => {
    expect(channelFaderToGain(0)).toBe(0);
  });

  it('is unity at the top', () => {
    expect(channelFaderToGain(1)).toBe(1);
  });

  it('follows an audio taper (quiet half stays quiet)', () => {
    expect(channelFaderToGain(0.5)).toBeCloseTo(0.25, 10);
    expect(channelFaderToGain(0.5)).toBeLessThan(0.5);
  });

  it('is monotonic', () => {
    expect(channelFaderToGain(0.2)).toBeLessThan(channelFaderToGain(0.4));
    expect(channelFaderToGain(0.4)).toBeLessThan(channelFaderToGain(0.9));
  });

  it('clamps out-of-range values', () => {
    expect(channelFaderToGain(-1)).toBe(0);
    expect(channelFaderToGain(2)).toBe(1);
  });
});

describe('trimToGain', () => {
  it('is unity at center', () => {
    expect(trimToGain(0.5)).toBe(1);
  });

  it('boosts +12 dB at the top', () => {
    expect(trimToGain(1)).toBeCloseTo(Math.pow(10, 12 / 20), 10);
  });

  it('cuts -12 dB at the bottom', () => {
    expect(trimToGain(0)).toBeCloseTo(Math.pow(10, -12 / 20), 10);
  });

  it('clamps out-of-range values', () => {
    expect(trimToGain(-0.5)).toBeCloseTo(Math.pow(10, -12 / 20), 10);
    expect(trimToGain(1.5)).toBeCloseTo(Math.pow(10, 12 / 20), 10);
  });
});

describe('cueLevelToGain (headphone-cue 02)', () => {
  it('is silent at the bottom and unity at the top', () => {
    expect(cueLevelToGain(0)).toBe(0);
    expect(cueLevelToGain(1)).toBe(1);
  });

  it('follows the channel-fader audio taper', () => {
    expect(cueLevelToGain(0.5)).toBeCloseTo(0.25, 10);
  });

  it('is monotonic and clamps out-of-range values', () => {
    expect(cueLevelToGain(0.3)).toBeLessThan(cueLevelToGain(0.6));
    expect(cueLevelToGain(-1)).toBe(0);
    expect(cueLevelToGain(2)).toBe(1);
  });
});

describe('cueMixGains (headphone-cue 03)', () => {
  it('is cue-only at 0 and master-only at 1', () => {
    expect(cueMixGains(0)).toEqual({ cue: 1, master: 0 });
    expect(cueMixGains(1).cue).toBeCloseTo(0, 10);
    expect(cueMixGains(1).master).toBe(1);
  });

  it('is equal-power: both audible at center, energy constant across the sweep', () => {
    const center = cueMixGains(0.5);
    expect(center.cue).toBeCloseTo(Math.SQRT1_2, 10);
    expect(center.master).toBeCloseTo(Math.SQRT1_2, 10);
    for (const x of [0, 0.25, 0.5, 0.75, 1]) {
      const { cue, master } = cueMixGains(x);
      expect(cue * cue + master * master).toBeCloseTo(1, 10);
    }
  });

  it('is monotonic per side', () => {
    const positions = [0, 0.25, 0.5, 0.75, 1];
    const gains = positions.map(cueMixGains);
    for (let i = 1; i < gains.length; i++) {
      expect(gains[i].cue).toBeLessThanOrEqual(gains[i - 1].cue);
      expect(gains[i].master).toBeGreaterThanOrEqual(gains[i - 1].master);
    }
  });

  it('clamps out-of-range positions', () => {
    expect(cueMixGains(-1)).toEqual(cueMixGains(0));
    expect(cueMixGains(2)).toEqual(cueMixGains(1));
  });
});

describe('crossfaderGains', () => {
  it('is dipless: both channels at unity at center', () => {
    expect(crossfaderGains(0)).toEqual({ a: 1, b: 1 });
  });

  it('fully kills B at the A end and vice versa', () => {
    expect(crossfaderGains(-1)).toEqual({ a: 1, b: 0 });
    expect(crossfaderGains(1)).toEqual({ a: 0, b: 1 });
  });

  it('keeps a channel at unity throughout its own half', () => {
    expect(crossfaderGains(-0.6).a).toBe(1);
    expect(crossfaderGains(0.6).b).toBe(1);
  });

  it('fades linearly toward the opposite end', () => {
    expect(crossfaderGains(0.5).a).toBeCloseTo(0.5, 10);
    expect(crossfaderGains(-0.5).b).toBeCloseTo(0.5, 10);
  });

  it('is monotonic per side', () => {
    const positions = [-1, -0.5, 0, 0.5, 1];
    const gains = positions.map(crossfaderGains);
    for (let i = 1; i < gains.length; i++) {
      expect(gains[i].a).toBeLessThanOrEqual(gains[i - 1].a);
      expect(gains[i].b).toBeGreaterThanOrEqual(gains[i - 1].b);
    }
  });

  it('clamps out-of-range positions', () => {
    expect(crossfaderGains(-3).a).toBe(1);
    expect(crossfaderGains(3).b).toBe(1);
  });
});
