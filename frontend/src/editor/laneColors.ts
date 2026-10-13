/**
 * Lane colors + display names — bright, fully saturated per the project's
 * design language; shared by the lane canvases, strip labels, and the
 * per-deck lane toggle chips (mix-editor 32).
 *
 * Deck hue families (CONTEXT.md: Deck color): fader lanes ARE the Deck
 * colors (theme/deckColors stays the single source for the anchors);
 * filters wear the mix-editor 32 family's old LOW hues (−20° off the
 * deck anchor — closest to the anchor, so the filter still reads as
 * "the deck's own color, shifted").
 *
 * EQ lanes (mix-editor 39 experiment): the three bands are an RGB triad —
 * LOW red, MID green, HIGH blue — the same triad on both decks, hue-
 * rotated ~25° BLUEWARD for deck A and REDWARD for deck B so the decks
 * stay tellable apart at a glance. Bright, fully saturated per the
 * project's design language (B keeps its 0x2d channel floor).
 */
import { DECK_COLORS } from '../theme/deckColors';
import type { LaneId } from './mixModel';

export const LANE_COLORS: Record<LaneId, string> = {
  faderA: DECK_COLORS.A, // #00e5ff — anchor 186°
  faderB: DECK_COLORS.B, // #ff2d95 — anchor 330°
  eqLowA: '#ff0066', // red, blueward (335°)
  eqLowB: '#ff2d2d', // red (0°)
  eqMidA: '#00ff6a', // green, blueward (145°)
  eqMidB: '#95ff2d', // green, redward (95°)
  eqHighA: '#3399ff', // blue, cyanward (210°)
  eqHighB: '#5c2dff', // blue-violet (254°)
  filterA: '#00ffc4', // the 32-family LOW hue (−20° off the anchor)
  filterB: '#ff2ddb', // the 32-family LOW hue (−20° off the anchor)
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

/** Top→bottom display order for each deck's strips AND toggle chips
 * (review nits 2026-07-06): A runs FILTER→HIGH→MID→LOW→FADER into the
 * seam (LOW beside the fader); B mirrors it (FADER at the seam, FILTER
 * at the outer edge) — the two decks read as one arrangement reflected
 * around the waveform pair. */
export const DECK_LANE_ORDER: Record<'A' | 'B', LaneId[]> = {
  A: ['filterA', 'eqHighA', 'eqMidA', 'eqLowA', 'faderA'],
  B: ['faderB', 'eqLowB', 'eqMidB', 'eqHighB', 'filterB'],
};
