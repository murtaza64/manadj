import { describe, expect, it } from 'vitest';
import { CHANNEL_IDS } from '../../playback/mixer';
import {
  PERFORMANCE_WAVEFORM_ORDER,
  performanceWaveformOrder,
  waveformRowCenterPercent,
  waveformRowTopPercent,
} from './waveformOrder';

describe('Performance waveform order', () => {
  it('mirrors four-channel mixer order without changing canonical Deck iteration', () => {
    expect(PERFORMANCE_WAVEFORM_ORDER).toEqual(['C', 'A', 'B', 'D']);
    expect([...PERFORMANCE_WAVEFORM_ORDER].sort()).toEqual([...CHANNEL_IDS].sort());
    expect(CHANNEL_IDS).toEqual(['A', 'B', 'C', 'D']);
    expect(PERFORMANCE_WAVEFORM_ORDER.map((deck) => waveformRowTopPercent(deck, PERFORMANCE_WAVEFORM_ORDER))).toEqual([0, 25, 50, 75]);
    expect(PERFORMANCE_WAVEFORM_ORDER.map((deck) => waveformRowCenterPercent(deck, PERFORMANCE_WAVEFORM_ORDER))).toEqual([
      12.5, 37.5, 62.5, 87.5,
    ]);
  });

  it('projects two-deck rows against A/B only', () => {
    const order = performanceWaveformOrder(2);
    expect(order).toEqual(['A', 'B']);
    expect(order.map((deck) => waveformRowTopPercent(deck, order))).toEqual([0, 50]);
    expect(order.map((deck) => waveformRowCenterPercent(deck, order))).toEqual([25, 75]);
    expect(performanceWaveformOrder(4)).toBe(PERFORMANCE_WAVEFORM_ORDER);
  });
});
