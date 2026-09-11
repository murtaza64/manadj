import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FILTER_SETTINGS,
  FILTER_MODELS,
  sanitizeFilterSettings,
} from './filterSettings';
import { describeSweepFilter, sweepResponseDb } from './sweepFilter';

describe('configurable channel sweep', () => {
  it('uses the approved 24 dB sound with exact dry center and 2.55 dB wet compensation', () => {
    const center = describeSweepFilter(DEFAULT_FILTER_SETTINGS, 0, 48000);
    expect(center.wet).toBe(0);
    const swept = describeSweepFilter(DEFAULT_FILTER_SETTINGS, -1, 48000);
    expect(swept.stages).toHaveLength(2);
    expect(swept.frequency).toBeCloseTo(40);
    expect(swept.gainDb).toBeCloseTo(-2.55);
    expect(
      sweepResponseDb(
        DEFAULT_FILTER_SETTINGS,
        0,
        new Float32Array([100, 1000, 10000]),
        48000,
      ),
    ).toEqual([0, 0, 0]);
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
