/**
 * Lane colors + display names — bright, fully saturated per the project's
 * design language; shared by the lane canvases, strip labels, and the
 * per-deck lane toggle chips (mix-editor 32).
 *
 * Deck hue families (CONTEXT.md: Deck color): every lane's hue is its
 * deck's anchor hue plus a uniform role offset — A lanes read as a cyan
 * family, B as magenta. The fader lanes ARE the Deck colors
 * (theme/deckColors stays the single source for the anchors).
 *
 * Role → hue offset (same for both decks, full saturation):
 *   LOW −40° · FILTER −22° · FADER 0° · MID +22° · HIGH +42°
 */
import { DECK_COLORS } from '../theme/deckColors';
import type { LaneId } from './mixModel';

export const LANE_COLORS: Record<LaneId, string> = {
  faderA: DECK_COLORS.A, // #00e5ff — anchor 187°
  faderB: DECK_COLORS.B, // #ff2d95 — anchor 330°
  eqLowA: '#00ff6e',
  eqLowB: '#b52dff',
  eqMidA: '#008cff',
  eqMidB: '#ff2d4e',
  eqHighA: '#2d50ff',
  eqHighB: '#ff5c2d',
  filterA: '#00ffc3',
  filterB: '#f22dff',
};

/** Terse display names (mix-editor 32): what strip labels and toggle chips
 * show. Raw LaneIds survive only in model/persistence. */
export const LANE_LABELS: Record<LaneId, string> = {
  faderA: 'FADER',
  faderB: 'FADER',
  eqLowA: 'LOW',
  eqLowB: 'LOW',
  eqMidA: 'MID',
  eqMidB: 'MID',
  eqHighA: 'HIGH',
  eqHighB: 'HIGH',
  filterA: 'FILTER',
  filterB: 'FILTER',
};

/** Toggle-chip order per deck (mix-editor 32): FADER LOW MID HIGH FILTER. */
export const DECK_LANE_ORDER: Record<'A' | 'B', LaneId[]> = {
  A: ['faderA', 'eqLowA', 'eqMidA', 'eqHighA', 'filterA'],
  B: ['faderB', 'eqLowB', 'eqMidB', 'eqHighB', 'filterB'],
};
