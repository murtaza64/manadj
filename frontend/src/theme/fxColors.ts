/**
 * Beat FX effect identity colors (#354) — fully saturated, distinct from the
 * Deck colors (cyan/magenta/orange/violet) so an FX band on a deck lane
 * never reads as another Deck.
 */
import type { BeatFxEffectId } from '../playback/beatFx';

export const BEAT_FX_COLORS: Record<BeatFxEffectId, string> = {
  echo: '#ffe600',
  reverb: '#39ff14',
  flanger: '#ff1f1f',
};

/** LEVEL/DEPTH (bipolar −1..1) → band opacity: the wet share, squared for
 * contrast across the usual 0..+1 throw, floored so a dry-side span stays
 * visible. */
export function fxDepthOpacity(depth: number): number {
  const wet = (Math.max(-1, Math.min(1, depth)) + 1) / 2;
  return 0.2 + 0.8 * wet * wet;
}
