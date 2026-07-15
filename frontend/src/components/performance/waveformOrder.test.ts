import { describe, expect, it } from 'vitest';
import { CHANNEL_IDS } from '../../playback/mixer';
import {
  PERFORMANCE_WAVEFORM_ORDER,
  waveformRowCenterPercent,
  waveformRowTopPercent,
} from './waveformOrder';

describe('Performance waveform order', () => {
  it('mirrors four-channel mixer order without changing canonical Deck iteration', () => {
    expect(PERFORMANCE_WAVEFORM_ORDER).toEqual(['C', 'A', 'B', 'D']);
    expect([...PERFORMANCE_WAVEFORM_ORDER].sort()).toEqual([...CHANNEL_IDS].sort());
    expect(CHANNEL_IDS).toEqual(['A', 'B', 'C', 'D']);
    expect(PERFORMANCE_WAVEFORM_ORDER.map(waveformRowTopPercent)).toEqual([0, 25, 50, 75]);
    expect(PERFORMANCE_WAVEFORM_ORDER.map(waveformRowCenterPercent)).toEqual([
      12.5, 37.5, 62.5, 87.5,
    ]);
  });
});
