import type { ChannelId } from '../../playback/mixer';

/** Four-channel mixer presentation order: channels 3, 1, 2, 4. */
export const PERFORMANCE_WAVEFORM_ORDER = ['C', 'A', 'B', 'D'] as const satisfies readonly ChannelId[];

export type DeckCount = 2 | 4;
const TWO_DECK_ORDER = ['A', 'B'] as const;

export function performanceWaveformOrder(deckCount: DeckCount): readonly ChannelId[] {
  return deckCount === 2 ? TWO_DECK_ORDER : PERFORMANCE_WAVEFORM_ORDER;
}

export function waveformRowTopPercent(deck: ChannelId, order: readonly ChannelId[]): number {
  return order.indexOf(deck) * (100 / order.length);
}

export function waveformRowCenterPercent(deck: ChannelId, order: readonly ChannelId[]): number {
  return waveformRowTopPercent(deck, order) + 50 / order.length;
}
