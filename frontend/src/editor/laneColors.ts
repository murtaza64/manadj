/**
 * Lane colors + display names — bright, fully saturated per the project's
 * design language; shared by the lane canvases, strip labels, and the
 * per-deck lane toggle chips (mix-editor 32).
 *
 * Deck hue families (CONTEXT.md: Deck color): each deck's lanes form ONE
 * spectrum ramp along the strip display order — FILTER → HIGH → MID →
 * LOW → FADER in uniform −80/−60/−40/−20/0° hue offsets from the deck
 * anchor — so a fully-enabled deck reads as a smooth gradient ending at
 * the deck color at the waveform seam, with LOW next to the fader
 * (review nits 2026-07-06, replacing the grill's scattered-offset
 * table). The fader lanes ARE the Deck colors (theme/deckColors stays
 * the single source for the anchors); every hue keeps its anchor's
 * channel floor (A pure, B's 0x2d).
 */
import { DECK_COLORS } from '../theme/deckColors';
import type { LaneId } from './mixModel';

export const LANE_COLORS: Record<LaneId, string> = {
  faderA: DECK_COLORS.A, // #00e5ff — anchor 186°
  faderB: DECK_COLORS.B, // #ff2d95 — anchor 330°
  eqLowA: '#00ffc4',
  eqLowB: '#ff2ddb',
  eqMidA: '#00ff6f',
  eqMidB: '#dd2dff',
  eqHighA: '#00ff1a',
  eqHighB: '#972dff',
  filterA: '#3bff00',
  filterB: '#512dff',
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
