import { describe, expect, it } from 'vitest';
import {
  BEAT_SECONDS_DEFAULT,
  ECHO_BEAT_LADDER,
  beatFxMixGains,
  echoDelaySeconds,
  reverbImpulseResponse,
  stepEchoBeats,
} from './beatFx';

describe('echo beat ladder (BEAT ◄ ►)', () => {
  it('walks the full GRV6 ladder up and back down', () => {
    let beats = ECHO_BEAT_LADDER[0];
    const up: number[] = [];
    for (let i = 0; i < ECHO_BEAT_LADDER.length - 1; i++) {
      beats = stepEchoBeats(beats, 'double');
      up.push(beats);
    }
    expect(up).toEqual([0.5, 0.75, 1, 2, 4, 8]);
    const down: number[] = [];
    for (let i = 0; i < ECHO_BEAT_LADDER.length - 1; i++) {
      beats = stepEchoBeats(beats, 'halve');
      down.push(beats);
    }
    expect(down).toEqual([4, 2, 1, 0.75, 0.5, 0.25]);
  });

  it('clamps at the ladder ends', () => {
    expect(stepEchoBeats(0.25, 'halve')).toBe(0.25);
    expect(stepEchoBeats(8, 'double')).toBe(8);
  });

  it('snaps off-ladder values to the nearest rung before stepping', () => {
    expect(stepEchoBeats(0.6, 'double')).toBe(0.75); // nearest 0.5 → up
    expect(stepEchoBeats(3, 'halve')).toBe(1); // nearest 2 → down
  });
});

describe('echo delay time', () => {
  it('is beats × seconds-per-beat (beats × 60/effectiveBpm)', () => {
    // 128 BPM → 0.46875 s/beat; half-beat echo = 0.234375 s.
    expect(echoDelaySeconds(0.5, 60 / 128)).toBeCloseTo(0.234375, 9);
    expect(echoDelaySeconds(4, 0.5)).toBe(2);
  });

  it('clamps to the DelayNode range and survives bad clocks', () => {
    expect(echoDelaySeconds(8, 60 / 40)).toBe(10); // 12 s raw → ceiling
    expect(echoDelaySeconds(0.25, 0.001)).toBe(0.01); // floor
    expect(echoDelaySeconds(1, NaN)).toBe(BEAT_SECONDS_DEFAULT);
    expect(echoDelaySeconds(1, 0)).toBe(BEAT_SECONDS_DEFAULT);
  });
});

describe('wet/dry crossfade', () => {
  it('maps the bipolar throw: -1 original, 0 midpoint, +1 effect', () => {
    expect(beatFxMixGains(-1)).toEqual({ dry: 1, wet: 0 });
    expect(beatFxMixGains(0)).toEqual({ dry: 1, wet: 1 });
    expect(beatFxMixGains(1)).toEqual({ dry: 0, wet: 1 });
  });

  it('keeps one side at unity on either side of center', () => {
    expect(beatFxMixGains(-0.5)).toEqual({ dry: 1, wet: 0.5 });
    expect(beatFxMixGains(0.5)).toEqual({ dry: 0.5, wet: 1 });
  });
});

describe('reverb impulse response', () => {
  const rate = 8000; // small rate keeps the test fast; math is rate-relative
  const { left, right } = reverbImpulseResponse(rate);

  it('spans ~2.5 s with no pre-delay', () => {
    expect(left.length).toBe(Math.round(rate * 2.5));
    expect(right.length).toBe(left.length);
    // Energy concentrates at the head (exponential decay, no pre-delay gap).
    const head = left.subarray(0, Math.floor(left.length / 10));
    expect(Math.max(...head.map(Math.abs))).toBeGreaterThan(0.001);
  });

  it('decays exponentially (tail far quieter than head)', () => {
    const rms = (slice: Float32Array) =>
      Math.sqrt(slice.reduce((sum, v) => sum + v * v, 0) / slice.length);
    const tenth = Math.floor(left.length / 10);
    expect(rms(left.subarray(left.length - tenth)) / rms(left.subarray(0, tenth))).toBeLessThan(
      0.01
    );
  });

  it('is energy-normalized per channel', () => {
    for (const ir of [left, right]) {
      expect(ir.reduce((sum, v) => sum + v * v, 0)).toBeCloseTo(1, 6);
    }
  });

  it('is stereo-decorrelated (independent noise per side)', () => {
    let dot = 0;
    for (let i = 0; i < left.length; i++) dot += left[i] * right[i];
    // Both sides are unit-energy, so the dot product IS the normalized
    // correlation at lag 0.
    expect(Math.abs(dot)).toBeLessThan(0.05);
  });

  it('supports tunable decay and stereo width', () => {
    const narrow = reverbImpulseResponse(rate, 1.2, 6000, 0);
    expect(narrow.left.length).toBe(Math.round(rate * 1.2));
    expect(narrow.left).toEqual(narrow.right);
    const wide = reverbImpulseResponse(rate, 1.2, 6000, 1);
    expect(wide.left).not.toEqual(wide.right);
  });

  it('is deterministic (seeded noise — testable, cacheable)', () => {
    const again = reverbImpulseResponse(rate);
    expect(again.left).toEqual(left);
    expect(again.right).toEqual(right);
  });
});
