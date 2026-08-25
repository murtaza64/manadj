/**
 * Shared visualizer style vocabulary (realtime-visualization 02), distilled
 * from Vissonance (github.com/tariqksoliman/Vissonance) — the strongest
 * visual-cohesion trick in its presets is a LOUDNESS-DRIVEN GLOBAL HUE:
 * every element colors from one energy-swept hue per frame (deep blue when
 * quiet → magenta/red as the track lifts), instead of static palettes.
 * Scene motion (rotation, scroll) also scales with energy so the whole
 * frame breathes with the music. Pure helpers; presets stay canvas-only.
 */

import { ADDITIVE_COLORS } from '../waveform/styles';
import type { BandLevels } from './bands';

/** The waveform's canonical band identity (waveform/styles.ts
 * ADDITIVE_COLORS): low = red, mid = green, high = blue. Band-identity
 * presets (Bars, Spectrum, LED, Nebula layers) speak the same color
 * language as the waveforms so the visualizer reads as manadj. */
export const BAND_RGB: Record<keyof BandLevels, readonly [number, number, number]> = {
  low: ADDITIVE_COLORS[0],
  mid: ADDITIVE_COLORS[1],
  high: ADDITIVE_COLORS[2],
};

/** 0-1 RGB triple → css color, with optional brightness scale. */
export function cssRgb(
  rgb: readonly [number, number, number],
  alpha = 1,
  scale = 1
): string {
  const c = (v: number) => Math.round(Math.min(1, v * scale) * 255);
  return `rgba(${c(rgb[0])}, ${c(rgb[1])}, ${c(rgb[2])}, ${alpha})`;
}

/** Band ramp for fine multiband presets: red (bass) → green (mid) → blue
 * (treble), piecewise-lerped through the waveform band colors. */
export function bandRampRgb(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t));
  const [from, to, k] =
    x < 0.5 ? [BAND_RGB.low, BAND_RGB.mid, x * 2] : [BAND_RGB.mid, BAND_RGB.high, x * 2 - 1];
  return [
    from[0] + (to[0] - from[0]) * k,
    from[1] + (to[1] - from[1]) * k,
    from[2] + (to[2] - from[2]) * k,
  ];
}

/** Overall energy in [0, 1]: bass-weighted mean — the low band carries the
 * musical "loudness" feel on dance material. */
export function energyOf(bands: BandLevels): number {
  return Math.min(1, bands.low * 0.5 + bands.mid * 0.3 + bands.high * 0.2);
}

/**
 * The Vissonance hue sweep: 250° (deep blue) at silence, falling through
 * violet → magenta → red as energy rises (their `250 - loudness·2.2`,
 * normalized). `offset` shifts the whole story (e.g. +180 for accents).
 */
export function energyHue(energy: number, offset = 0): number {
  return (((250 - energy * 210 + offset) % 360) + 360) % 360;
}
