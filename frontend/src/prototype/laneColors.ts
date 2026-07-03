/**
 * Lane color assignments — bright, fully saturated per the project's
 * design language; shared by the lane canvases and the strip labels.
 */
import type { LaneId } from './mixProtoModel';

export const LANE_COLORS: Record<LaneId, string> = {
  faderA: '#00e5ff',
  faderB: '#ff2d95',
  eqLowA: '#ffe600',
  eqLowB: '#ff6b00',
  eqMidA: '#39ff14',
  eqMidB: '#14ff9e',
  eqHighA: '#b14bff',
  eqHighB: '#ff4b6e',
  filterA: '#4b9fff',
  filterB: '#ffb14b',
};
