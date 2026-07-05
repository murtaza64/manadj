/**
 * Lane color assignments — bright, fully saturated per the project's
 * design language; shared by the lane canvases and the strip labels.
 * The fader lanes carry the Deck colors (theme/deckColors — the single
 * source); the EQ/filter variants are this module's own palette.
 */
import { DECK_COLORS } from '../theme/deckColors';
import type { LaneId } from './mixModel';

export const LANE_COLORS: Record<LaneId, string> = {
  faderA: DECK_COLORS.A,
  faderB: DECK_COLORS.B,
  eqLowA: '#ffe600',
  eqLowB: '#ff6b00',
  eqMidA: '#39ff14',
  eqMidB: '#14ff9e',
  eqHighA: '#b14bff',
  eqHighB: '#ff4b6e',
  filterA: '#4b9fff',
  filterB: '#ffb14b',
};
