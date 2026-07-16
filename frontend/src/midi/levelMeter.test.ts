/**
 * The channel level-meter seam (four-deck-performance 36): pure mean-level
 * shaping — no Web MIDI, no AudioContext, no React. Covers normalization,
 * segment/value encoding, VU ballistics, the rate-limited tick, and the
 * silence/red boundaries the acceptance criteria call out.
 */
import { describe, expect, it } from 'vitest';
import {
  MIXXX_VU_SCALE,
  encodeMeterValue,
  initialMeterState,
  meanAbsoluteToNormalized,
  meterTick,
  smoothLevel,
} from './levelMeter';

describe('meanAbsoluteToNormalized (Mixxx EngineVuMeter curve)', () => {
  it('clears to exactly 0 at silence', () => {
    expect(meanAbsoluteToNormalized(0)).toBe(0);
  });

  it('matches Mixxx log10(SHRT_MAX * meanAbs / 1000 + 1)', () => {
    expect(meanAbsoluteToNormalized(0.1)).toBeCloseTo(
      Math.log10(MIXXX_VU_SCALE * 0.1 + 1),
      6
    );
  });

  it('retains headroom for ordinary mastered peaks and clamps loud averages', () => {
    // Mean absolute 0.1 sits around segment 4/7, rather than redlining from
    // a near-full-scale sample peak as the old peak-dBFS curve did.
    expect(meanAbsoluteToNormalized(0.1)).toBeLessThan(0.7);
    expect(meanAbsoluteToNormalized(1)).toBe(1);
  });

});

describe('encodeMeterValue', () => {
  it('sends 0 for silence and the normal-level cap for full scale', () => {
    expect(encodeMeterValue(0, 117)).toBe(0);
    expect(encodeMeterValue(1, 117)).toBe(117);
  });

  it('rounds to the hardware CC resolution', () => {
    expect(encodeMeterValue(0.5, 117)).toBe(59);
  });
});

describe('smoothLevel (Mixxx VU ballistics)', () => {
  it('uses Mixxx immediate attack', () => {
    expect(smoothLevel(0, 1, 1 / 30)).toBe(1);
  });

  it('decays by 10% at Mixxx\'s 30 Hz update rate', () => {
    expect(smoothLevel(1, 0, 1 / 30)).toBeCloseTo(0.9, 6);
  });

  it('is frame-rate independent (equal total decay over equal time)', () => {
    const oneBig = smoothLevel(1, 0, 0.1);
    let stepped = 1;
    for (let i = 0; i < 10; i++) stepped = smoothLevel(stepped, 0, 0.01);
    expect(stepped).toBeCloseTo(oneBig, 2);
  });

  it('snaps to target with a zero or non-positive dt', () => {
    expect(smoothLevel(0.2, 0.9, 0)).toBe(0.9);
  });
});

describe('meterTick (rate-limited sampler tick)', () => {
  const level = (meanAbsolute: number, clipped = false) => ({ meanAbsolute, clipped });

  it('emits on the first tick and caps loud non-clipping audio below red', () => {
    const first = meterTick(initialMeterState(), level(1), 1 / 30, 117);
    expect(first.normalized).not.toBeNull();
    expect(first.state.lastValue).toBe(117);
    expect(first.peak).toBe(false);
  });

  it('emits nothing while the rounded output value is unchanged', () => {
    let state = meterTick(initialMeterState(), level(0.1), 1 / 30, 117).state;
    const second = meterTick(state, level(0.1), 1 / 30, 117);
    expect(second.normalized).toBeNull();
    state = second.state;
    const third = meterTick(state, level(0.1), 1 / 30, 117);
    expect(third.normalized).toBeNull();
  });

  it('re-emits as silence walks the meter down without sticking', () => {
    let state = meterTick(initialMeterState(), level(1), 1 / 30, 117).state;
    let sawChange = false;
    for (let i = 0; i < 60; i++) {
      const tick = meterTick(state, level(0), 1 / 30, 117);
      state = tick.state;
      if (tick.normalized !== null) sawChange = true;
    }
    expect(sawChange).toBe(true);
    expect(state.lastValue).toBe(0);
  });

  it('enters peak only on clipping and holds it for 500 ms', () => {
    let tick = meterTick(initialMeterState(), level(0.1, true), 1 / 30, 117);
    expect(tick.peak).toBe(true);
    expect(tick.state.lastValue).toBe(118); // internal peak sentinel

    let state = tick.state;
    for (let i = 0; i < 14; i++) {
      tick = meterTick(state, level(0.1), 1 / 30, 117);
      state = tick.state;
      expect(tick.peak).toBe(true);
    }
    tick = meterTick(state, level(0.1), 1 / 30, 117);
    expect(tick.peak).toBe(false);
    expect(tick.normalized).not.toBeNull();
  });
});
