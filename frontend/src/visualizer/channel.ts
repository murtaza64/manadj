/**
 * Visualizer window wire protocol (realtime-visualization 01/02). The main
 * window owns the one AudioContext (ADR 0009) — the visualizer window NEVER
 * creates audio. Band levels cross windows over a BroadcastChannel: the viz
 * window pings while open (carrying what its active preset needs); the
 * main-window bridge transmits frames only while pings are fresh, and ships
 * the (heavier) stereo waveform only while a preset wants it.
 */

import type { BandLevels } from './bands';

export const VISUALIZER_CHANNEL = 'manadj-visualizer';

/** Viz window → main: "I'm open, keep the frames coming". */
export const PING_INTERVAL_MS = 500;
/** Main window stops transmitting after this long without a ping. */
export const PING_TIMEOUT_MS = 2000;

/** Fine multiband resolution (radial/waves/mirror density); the Spectrum
 * preset groups these 24 geometric bands into its 8 (edges compose). */
export const SPECTRUM_BAND_COUNT = 24;

/** Stereo waveform samples per side per frame (analyser window decimated). */
export const WAVE_POINTS = 1024;

export interface VisualizerPing {
  type: 'ping';
  /** Active preset needs the stereo time-domain feed (scope/goniometer). */
  wantsWave?: boolean;
  /** Active preset id — the laptop-side control modal mirrors it. */
  presetId?: string;
}

/** Main window → viz: remote preset switch (realtime-visualization 03) —
 * the projector-fullscreen window has no reachable chrome. */
export interface VisualizerSetPreset {
  type: 'set-preset';
  presetId: string;
}

/** Beat lock from the dominant audible deck's beatgrid (ADR 0016: the grid
 * is authoritative). Null while nothing gridded is audibly playing. Bar
 * fields anchor to the grid's downbeats (4/4 assumed without them). */
export interface BeatInfo {
  /** 0 = on the beat, 0.5 = the offbeat. */
  phase: number;
  /** 0 = the downbeat, sweeping the whole bar. */
  barPhase: number;
  /** Whole beat within the bar, 0-based (0 = the downbeat). */
  beatInBar: number;
  beatsPerBar: number;
  bpm: number | null;
}

/** Main → viz: one smoothed band frame (~60 Hz while a viz window pings). */
export interface VisualizerFrame {
  type: 'bands';
  /** Isolator-aligned low/mid/high (bars, nebula, tunnel drive). */
  bands: BandLevels;
  /** SPECTRUM_BAND_COUNT geometric bands, 40 Hz → 16 kHz. */
  spectrum: number[];
  /** Stereo time-domain snapshot — only while the ping wants it. */
  wave?: { left: Float32Array; right: Float32Array } | null;
  /** Beat lock — null without an audible gridded deck. */
  beat?: BeatInfo | null;
  /** Sender performance.now() — lets the renderer detect a stalled feed. */
  sentAt: number;
}

export type VisualizerMessage = VisualizerPing | VisualizerFrame | VisualizerSetPreset;

/** URL the visualizer window opens at (App.tsx pathname branch). */
export const VISUALIZER_PATH = '/visualizer';
