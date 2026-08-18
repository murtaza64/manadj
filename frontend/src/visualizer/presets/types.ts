/**
 * Visualizer preset contract (realtime-visualization 01/02). A preset is a
 * factory for a stateful canvas-2D renderer: the window owns the rAF loop
 * and the band feed; the preset owns nothing but pixels. Presets receive
 * already-smoothed band levels (visualizer/bands.ts ballistics run in the
 * main-window bridge), so they can map levels straight to geometry.
 */

import type { BandLevels, EnergyTrend } from '../bands';
import type { BeatInfo, DeckStateInfo } from '../channel';

export interface VisualizerFrameData {
  /** Smoothed low/mid/high in [0, 1] (isolator-aligned). */
  bands: BandLevels;
  /** Smoothed geometric multiband levels in [0, 1] (channel.ts
   * SPECTRUM_BAND_COUNT bands, 40 Hz → 16 kHz). */
  spectrum: number[];
  /** Stereo time-domain snapshot; null unless the preset declared
   * wantsWave (and audio is live). */
  wave: { left: Float32Array; right: Float32Array } | null;
  /** Beat lock from the dominant audible deck; null without a grid. */
  beat: BeatInfo | null;
  /** Per-band onset impulses in [0, 1]: transient hits (kick/snare/hat),
   * near-zero for sustained material. */
  impulse: BandLevels;
  /** Slow energy baseline + drop excitement. */
  trend: EnergyTrend;
  /** Normalized spectral centroid (0 dark … 1 bright, 0.5 neutral). */
  centroid: number;
  /** Per-deck audible state (deck-aware presets); empty when unknown. */
  decks: DeckStateInfo[];
  /** Resolved values for the preset's declared params (id → value). */
  params: Record<string, number>;
  /** Seconds since the renderer started. */
  time: number;
  /** Seconds since the previous frame. */
  dt: number;
}

export interface PresetRenderer {
  render(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    frame: VisualizerFrameData
  ): void;
}

/** A user-tweakable preset parameter (viz-window chrome sliders). */
export interface PresetParam {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
}

export interface VisualizerPreset {
  id: string;
  name: string;
  /** Tweakables, persisted per preset (visualizerStore). */
  params?: PresetParam[];
  /** GL presets are cheap per pixel: raise the backing budget to ~1440p
   * (canvas presets stay at 1080p — full-canvas 2D compositing is what
   * loaded the GPU in the HDMI stutter incident). */
  hiRes?: boolean;
  /** Declares the stereo time-domain feed requirement (scope/goniometer);
   * the window's ping forwards it so other presets don't pay the cost. */
  wantsWave?: boolean;
  create(): PresetRenderer;
}
