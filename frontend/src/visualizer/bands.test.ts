import { describe, expect, it } from 'vitest';
import {
  aggregateBands,
  spectralCentroid,
  stepImpulses,
  stepTrend,
  INITIAL_IMPULSE_STATE,
  INITIAL_TREND,
  aggregateMultiband,
  logBandEdges,
  maxGroup,
  monstercatSpread,
  stepBands,
  stepLevels,
  wavesSpread,
  BAND_ATTACK_S,
  BAND_DB_CEIL,
  BAND_DB_FLOOR,
  SILENT_BANDS,
} from './bands';

const SAMPLE_RATE = 48000;
const FFT_SIZE = 2048;
const BINS = FFT_SIZE / 2;
const HZ_PER_BIN = SAMPLE_RATE / FFT_SIZE;

/** A spectrum with `db` in [fromHz, toHz) and silence (-Infinity) elsewhere. */
function spectrumWith(db: number, fromHz: number, toHz: number): Float32Array {
  const spectrum = new Float32Array(BINS).fill(-Infinity);
  for (let i = 0; i < BINS; i++) {
    const hz = i * HZ_PER_BIN;
    if (hz >= fromHz && hz < toHz) spectrum[i] = db;
  }
  return spectrum;
}

describe('aggregateBands (3-band, isolator-aligned)', () => {
  it('reads all-silence (analyser -Infinity) as zero in every band', () => {
    const bands = aggregateBands(
      new Float32Array(BINS).fill(-Infinity),
      SAMPLE_RATE,
      FFT_SIZE
    );
    expect(bands).toEqual(SILENT_BANDS);
  });

  it('energy below the low/mid crossover reads as low only', () => {
    const bands = aggregateBands(spectrumWith(-10, 40, 200), SAMPLE_RATE, FFT_SIZE);
    expect(bands.low).toBeGreaterThan(0.4);
    expect(bands.mid).toBe(0);
    expect(bands.high).toBe(0);
  });

  it('energy between the crossovers reads as mid only', () => {
    const bands = aggregateBands(spectrumWith(-10, 400, 2000), SAMPLE_RATE, FFT_SIZE);
    expect(bands.mid).toBeGreaterThan(0.4);
    expect(bands.low).toBe(0);
    expect(bands.high).toBe(0);
  });

  it('energy above the mid/high crossover reads as high only', () => {
    const bands = aggregateBands(spectrumWith(-10, 4000, 12000), SAMPLE_RATE, FFT_SIZE);
    expect(bands.high).toBeGreaterThan(0.4);
    expect(bands.low).toBe(0);
    expect(bands.mid).toBe(0);
  });

  it('power-averages: a band half-filled with equal energy reads lower than fully filled', () => {
    const full = aggregateBands(spectrumWith(-20, 300, 2400), SAMPLE_RATE, FFT_SIZE);
    const half = aggregateBands(spectrumWith(-20, 300, 1200), SAMPLE_RATE, FFT_SIZE);
    expect(half.mid).toBeLessThan(full.mid);
    expect(half.mid).toBeGreaterThan(0);
  });
});

describe('aggregateMultiband', () => {
  // A one-octave band centered near the 500 Hz tilt reference, where the
  // spectral tilt is ~0 dB — lets the tests pin the normalization window.
  const NEUTRAL_BAND = [360, 700];

  it('clamps at 1 for a band saturated above the dB ceiling', () => {
    const [level] = aggregateMultiband(
      spectrumWith(BAND_DB_CEIL + 8, NEUTRAL_BAND[0], NEUTRAL_BAND[1]),
      SAMPLE_RATE,
      FFT_SIZE,
      NEUTRAL_BAND
    );
    expect(level).toBe(1);
  });

  it('reads levels below the dB floor as zero', () => {
    const [level] = aggregateMultiband(
      spectrumWith(BAND_DB_FLOOR - 5, NEUTRAL_BAND[0], NEUTRAL_BAND[1]),
      SAMPLE_RATE,
      FFT_SIZE,
      NEUTRAL_BAND
    );
    expect(level).toBe(0);
  });

  it('applies rising spectral tilt: equal dB energy reads higher in a treble band than a bass band', () => {
    const spectrum = new Float32Array(BINS).fill(-20);
    const [low] = aggregateMultiband(spectrum, SAMPLE_RATE, FFT_SIZE, [100, 200]);
    const [high] = aggregateMultiband(spectrum, SAMPLE_RATE, FFT_SIZE, [4000, 8000]);
    expect(high).toBeGreaterThan(low);
  });

  it('gives narrow log-spaced bands at least one bin (no dead bars)', () => {
    // 30–33 Hz spans less than one bin at 23.4 Hz/bin.
    const [level] = aggregateMultiband(
      spectrumWith(-15, 0, 60),
      SAMPLE_RATE,
      FFT_SIZE,
      [30, 33]
    );
    expect(level).toBeGreaterThan(0);
  });
});

describe('logBandEdges', () => {
  it('spans exactly min → max with a constant octave ratio', () => {
    const edges = logBandEdges(40, 16000, 8);
    expect(edges).toHaveLength(9);
    expect(edges[0]).toBeCloseTo(40, 6);
    expect(edges[8]).toBeCloseTo(16000, 6);
    const ratio = edges[1] / edges[0];
    for (let i = 1; i < 8; i++) {
      expect(edges[i + 1] / edges[i]).toBeCloseTo(ratio, 8);
    }
  });
});

describe('monstercatSpread', () => {
  it('lifts neighbors with exponential distance falloff', () => {
    const spread = monstercatSpread([0, 1, 0, 0], 2);
    expect(spread[0]).toBeCloseTo(0.5, 10);
    expect(spread[1]).toBe(1);
    expect(spread[2]).toBeCloseTo(0.5, 10);
    expect(spread[3]).toBeCloseTo(0.25, 10);
  });

  it('never lowers a bar and does not mutate the input', () => {
    const input = [0.9, 0.1, 0.8];
    const spread = monstercatSpread(input, 1.8);
    for (let i = 0; i < input.length; i++) {
      expect(spread[i]).toBeGreaterThanOrEqual(input[i]);
    }
    expect(input).toEqual([0.9, 0.1, 0.8]);
  });
});

describe('wavesSpread', () => {
  it('gives a spike a parabolic skirt reaching zero at the drop distance', () => {
    const spread = wavesSpread([0, 0, 1, 0, 0, 0, 0], 1 / 4);
    expect(spread[2]).toBe(1);
    expect(spread[1]).toBeCloseTo(0.75, 10); // 1 - (1/4)·1²
    expect(spread[3]).toBeCloseTo(0.75, 10);
    expect(spread[4]).toBeCloseTo(0, 10); // 1 - (1/4)·2²
    expect(spread[5]).toBe(0); // negative skirt never lowers a bar
  });

  it('never lowers a bar and does not mutate the input', () => {
    const input = [0.2, 0.9, 0.1];
    const spread = wavesSpread(input);
    for (let i = 0; i < input.length; i++) {
      expect(spread[i]).toBeGreaterThanOrEqual(input[i]);
    }
    expect(input).toEqual([0.2, 0.9, 0.1]);
  });
});

describe('maxGroup', () => {
  it('takes the max of each run', () => {
    expect(maxGroup([0.1, 0.5, 0.2, 0.9, 0.3, 0.1], 3)).toEqual([0.5, 0.9]);
  });

  it('keeps a short tail as its own group', () => {
    expect(maxGroup([0.1, 0.2, 0.3, 0.8], 3)).toEqual([0.3, 0.8]);
  });
});

describe('ballistics', () => {
  it('attacks faster than it releases', () => {
    const up = stepBands(SILENT_BANDS, { low: 1, mid: 1, high: 1 }, 0.016);
    const down = stepBands({ low: 1, mid: 1, high: 1 }, SILENT_BANDS, 0.016);
    expect(up.low).toBeGreaterThan(1 - down.low);
  });

  it('is frame-rate independent: two half-steps land near one full step', () => {
    const target = { low: 1, mid: 1, high: 1 };
    const one = stepBands(SILENT_BANDS, target, 0.032);
    const halfway = stepBands(SILENT_BANDS, target, 0.016);
    const two = stepBands(halfway, target, 0.016);
    expect(two.low).toBeCloseTo(one.low, 10);
  });

  it('converges onto the target', () => {
    let bands = SILENT_BANDS;
    const target = { low: 0.8, mid: 0.4, high: 0.1 };
    for (let i = 0; i < 100; i++) bands = stepBands(bands, target, BAND_ATTACK_S * 4);
    expect(bands.low).toBeCloseTo(target.low, 3);
    expect(bands.mid).toBeCloseTo(target.mid, 3);
    expect(bands.high).toBeCloseTo(target.high, 3);
  });

  it('stepLevels mirrors stepBands over arrays and tolerates length growth', () => {
    const stepped = stepLevels([0, 0.5], [1, 0, 1], 0.016);
    expect(stepped).toHaveLength(3);
    expect(stepped[0]).toBeGreaterThan(0.8); // fast attack
    expect(stepped[1]).toBeGreaterThan(0.4); // slow release
    expect(stepped[2]).toBeGreaterThan(0.8); // missing prev treated as 0
  });
});

describe('stepImpulses', () => {
  const DT = 1 / 60;
  const hit = { low: 0.9, mid: 0, high: 0 };
  const rest = { low: 0.1, mid: 0, high: 0 };

  it('fires on an onset and stays quiet for sustained material', () => {
    // Sustain: feed a constant level until the reference catches up.
    let state = INITIAL_IMPULSE_STATE;
    for (let i = 0; i < 120; i++) state = stepImpulses(state, hit, DT);
    expect(state.impulse.low).toBeLessThan(0.15); // sustained ≈ quiet
    // Now a fresh hit from a low reference fires hard.
    let kicked = INITIAL_IMPULSE_STATE;
    for (let i = 0; i < 60; i++) kicked = stepImpulses(kicked, rest, DT);
    kicked = stepImpulses(kicked, hit, DT);
    expect(kicked.impulse.low).toBeGreaterThan(0.8);
  });

  it('decays quickly after the hit', () => {
    let state = INITIAL_IMPULSE_STATE;
    for (let i = 0; i < 60; i++) state = stepImpulses(state, rest, DT);
    state = stepImpulses(state, hit, DT);
    const peak = state.impulse.low;
    for (let i = 0; i < 30; i++) state = stepImpulses(state, rest, DT); // 0.5 s
    expect(state.impulse.low).toBeLessThan(peak * 0.05);
  });

  it('keeps bands independent (a kick is not a snare)', () => {
    let state = INITIAL_IMPULSE_STATE;
    state = stepImpulses(state, { low: 0.9, mid: 0, high: 0 }, DT);
    expect(state.impulse.low).toBeGreaterThan(0.5);
    expect(state.impulse.mid).toBe(0);
    expect(state.impulse.high).toBe(0);
  });
});

describe('stepTrend', () => {
  const DT = 1 / 60;

  it('excitement rises on sustained energy above the baseline (a drop)', () => {
    let trend = INITIAL_TREND;
    for (let i = 0; i < 60; i++) trend = stepTrend(trend, 0.15, DT); // intro
    trend = stepTrend(trend, 0.8, DT); // the drop lands
    expect(trend.excitement).toBeGreaterThan(0.9);
  });

  it('returns to calm as the baseline absorbs the new level', () => {
    let trend = INITIAL_TREND;
    for (let i = 0; i < 60 * 60; i++) trend = stepTrend(trend, 0.8, DT); // long plateau
    expect(trend.slow).toBeCloseTo(0.8, 1);
    expect(trend.excitement).toBeLessThan(0.15);
  });

  it('breakdowns read as zero excitement', () => {
    let trend = { slow: 0.7, excitement: 1 };
    trend = stepTrend(trend, 0.1, DT); // energy falls below baseline
    expect(trend.excitement).toBe(0);
  });
});

describe('spectralCentroid', () => {
  it('reads bass-only content low and treble-only high', () => {
    const low = [1, 0.8, 0, 0, 0, 0, 0, 0];
    const high = [0, 0, 0, 0, 0, 0, 0.8, 1];
    expect(spectralCentroid(low)).toBeLessThan(0.15);
    expect(spectralCentroid(high)).toBeGreaterThan(0.85);
  });

  it('is neutral (0.5) for silence and for flat spectra', () => {
    expect(spectralCentroid([0, 0, 0, 0])).toBe(0.5);
    expect(spectralCentroid([0.5, 0.5, 0.5, 0.5, 0.5])).toBeCloseTo(0.5, 10);
  });
});
