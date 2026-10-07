import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FILTER_SETTINGS,
  FILTER_MODELS,
  sanitizeFilterSettings,
} from './filterSettings';
import {
  cascadePeakDb,
  describeSweepFilter,
  sweepResponseDb,
} from './sweepFilter';

/** Dense log-frequency grid for brute-force response maxima. */
const GRID = Float32Array.from(
  { length: 8192 },
  (_, i) => 1 * 23900 ** (i / 8191),
);

describe('configurable channel sweep', () => {
  it('uses the approved 24 dB sound with exact dry center and measured peak compensation', () => {
    const center = describeSweepFilter(DEFAULT_FILTER_SETTINGS, 0, 48000);
    expect(center.wet).toBe(0);
    const swept = describeSweepFilter(DEFAULT_FILTER_SETTINGS, -1, 48000);
    expect(swept.stages).toHaveLength(2);
    expect(swept.frequency).toBeCloseTo(40);
    const peak = cascadePeakDb(swept.type, swept.stages, 48000);
    expect(peak).toBeGreaterThan(10); // res24 hump is far above nominal 17 × 0.15
    expect(swept.gainDb).toBeCloseTo(-0.85 * peak);
    expect(
      sweepResponseDb(
        DEFAULT_FILTER_SETTINGS,
        0,
        new Float32Array([100, 1000, 10000]),
        48000,
      ),
    ).toEqual([0, 0, 0]);
  });

  it('measures the true cascade peak at every model, position and resonance', () => {
    for (const model of ['res12', 'res24', 'res48', 'dual'] as const) {
      for (const position of [-1, -0.6, 0.35, 0.7, 1]) {
        for (const resonance of [0, 8, 17, 24]) {
          const s = { ...DEFAULT_FILTER_SETTINGS, model, resonance };
          const d = describeSweepFilter(s, position, 48000);
          expect(d.wet).toBe(1);
          const measured = cascadePeakDb(d.type, d.stages, 48000);
          // Brute-force reference: response max minus the applied makeup gain.
          const responseMax = Math.max(...sweepResponseDb(s, position, GRID, 48000));
          expect(measured).toBeCloseTo(responseMax - d.gainDb, 1);
          expect(measured).toBeGreaterThanOrEqual(0);
          // Compensation scales the measured overshoot, not nominal resonance.
          expect(d.gainDb).toBeCloseTo(-s.compensation * measured, 6);
        }
      }
    }
  });

  it('full compensation pins the wet peak at trim (flat loudness); zero leaves it raw', () => {
    const flat = { ...DEFAULT_FILTER_SETTINGS, compensation: 1, trim: -3 };
    for (const position of [-1, 0.5]) {
      const max = Math.max(...sweepResponseDb(flat, position, GRID, 48000));
      expect(max).toBeCloseTo(-3, 1);
    }
    const raw = describeSweepFilter(
      { ...DEFAULT_FILTER_SETTINGS, compensation: 0 },
      1,
      48000,
    );
    expect(raw.gainDb).toBe(0);
    const butterworth = describeSweepFilter(
      { ...DEFAULT_FILTER_SETTINGS, resonance: 0 },
      1,
      48000,
    );
    expect(butterworth.gainDb).toBeCloseTo(0, 2); // no hump, no penalty
  });

  it('keeps the original filter available without applying experimental controls', () => {
    const s = {
      ...DEFAULT_FILTER_SETTINGS,
      model: 'current' as const,
      drive: 18,
      resonance: 24,
    };
    expect(describeSweepFilter(s, -1, 48000)).toMatchObject({
      frequency: 80,
      gainDb: 0,
      wet: 1,
      stages: [{ frequency: 80, qDb: 3 }],
    });
    expect(describeSweepFilter(s, 1, 48000).frequency).toBeCloseTo(8000);
    expect(describeSweepFilter(s, 0, 48000).frequency).toBe(20000);
  });

  it('clamps positions, frequencies and invalid preferences before they reach audio', () => {
    const s = sanitizeFilterSettings({
      model: 'bad',
      resonance: Infinity,
      compensation: -2,
      drive: 100,
      curve: NaN,
      trim: '12',
    });
    expect(s).toMatchObject({
      model: 'res24',
      resonance: 17,
      compensation: 0,
      drive: 18,
      curve: 1,
      trim: 0,
    });
    for (const model of FILTER_MODELS) {
      for (const position of [-99, -1, -0.5, NaN, 0, 0.5, 1, 99]) {
        const d = describeSweepFilter(
          { ...s, model: model.id },
          position,
          8000,
        );
        expect(d.wet).toBeGreaterThanOrEqual(0);
        expect(d.wet).toBeLessThanOrEqual(1);
        for (const stage of d.stages) {
          expect(stage.frequency).toBeGreaterThan(0);
          expect(stage.frequency).toBeLessThan(4000);
          expect(Number.isFinite(stage.qDb)).toBe(true);
        }
      }
    }
  });
});
