import type { ChannelId } from '../../playback/mixer';

/** Four-channel mixer presentation order: channels 3, 1, 2, 4. */
export const PERFORMANCE_WAVEFORM_ORDER = ['C', 'A', 'B', 'D'] as const satisfies readonly ChannelId[];

const ROW_HEIGHT_PERCENT = 100 / PERFORMANCE_WAVEFORM_ORDER.length;

export function waveformRowTopPercent(deck: ChannelId): number {
  return PERFORMANCE_WAVEFORM_ORDER.indexOf(deck) * ROW_HEIGHT_PERCENT;
}

export function waveformRowCenterPercent(deck: ChannelId): number {
  return waveformRowTopPercent(deck) + ROW_HEIGHT_PERCENT / 2;
}
