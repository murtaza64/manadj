/**
 * Visualizer window wire protocol (realtime-visualization 01/02). The main
 * window owns the one AudioContext (ADR 0009) — the visualizer window NEVER
 * creates audio. Band levels cross windows over a BroadcastChannel: the viz
 * window pings while open (carrying what its active preset needs); the
 * main-window bridge transmits frames only while pings are fresh, and ships
 * the (heavier) stereo waveform only while a preset wants it.
 */

import type { BandLevels, EnergyTrend } from './bands';

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
  /** Active preset's resolved param values (modal sliders mirror them). */
  params?: Record<string, number>;
}

/** Main window → viz: remote preset switch (realtime-visualization 03) —
 * the projector-fullscreen window has no reachable chrome. */
export interface VisualizerSetPreset {
  type: 'set-preset';
  presetId: string;
}

/** Main window → viz: remote param tweak (realtime-visualization 05). */
export interface VisualizerSetParam {
  type: 'set-param';
  presetId: string;
  paramId: string;
  value: number;
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
  /** Absolute bar index from the first downbeat (phrase tiers derive). */
  barIndex: number;
  /**
   * LADDER-CORRECT bar ordinal (realtime-visualization 08): the bar's
   * position within its governing metric-ladder segment (restarts at each
   * Reset mark / the Ladder anchor — ADRs 0029/0030), resolved through the
   * one canonical resolver (meter/ladder.ts). Phrase (%4) and section (%16)
   * tiers derive from THIS, so rollovers land on the ladder's boundaries,
   * not first-downbeat modular arithmetic. Null (fall back to barIndex)
   * without a metric ladder — no grid, before the first downbeat, or a
   * stale main window that never sends the field. */
  ladderBarIndex?: number | null;
  bpm: number | null;
}

/** Per-deck audible state (realtime-visualization 05, deck-aware presets):
 * level is the deck's channel signal WEIGHTED by its Master-bus gain
 * (trim × fader × crossfader — capture/audibility deckMasterGain), Mixxx-
 * normalized, so a faded-out playing deck reads ~0. trackId lets presets
 * recognize doubles (same track audible on two decks). */
export interface DeckStateInfo {
  channel: 'A' | 'B' | 'C' | 'D';
  /** Master-audible level, 0..1. */
  level: number;
  playing: boolean;
  trackId: number | null;
  /** This deck's OWN beat position (any running deck, not just the
   * dominant one) — per-deck presets show beatmatch by simultaneity. */
  beatPhase: number | null;
  barPhase: number | null;
  beatInBar: number | null;
  beatsPerBar: number;
  bpm: number | null;
  /** EQ knob positions (0..1, 0.5 = flat) and fader position. */
  eq: { low: number; mid: number; high: number };
  fader: number;
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
  /** Per-band onset impulses (kicks/snares/hats vs sustained material). */
  impulse?: BandLevels;
  /** Slow energy baseline + drop excitement. */
  trend?: EnergyTrend;
  /** Normalized spectral centroid (0 dark … 1 bright, 0.5 neutral). */
  centroid?: number;
  /** Spectral spread (0 narrow/tonal-pole … 1 wide; 0.5 silence). */
  spread?: number;
  /** Spectral flatness (0 peaky/tonal … 1 noisy; 0.5 silence). */
  flatness?: number;
  /** Per-deck audible state (A–D, fixed order). */
  decks?: DeckStateInfo[];
  /** Sender performance.now() — lets the renderer detect a stalled feed. */
  sentAt: number;
}

export type VisualizerMessage =
  | VisualizerPing
  | VisualizerFrame
  | VisualizerSetPreset
  | VisualizerSetParam;

/** URL the visualizer window opens at (App.tsx pathname branch). */
export const VISUALIZER_PATH = '/visualizer';
