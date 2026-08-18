/**
 * Visualizer window wire protocol (realtime-visualization 01). The main
 * window owns the one AudioContext (ADR 0009) — the visualizer window NEVER
 * creates audio. Band levels cross windows over a BroadcastChannel: the viz
 * window pings while open; the main-window bridge transmits band frames
 * only while pings are fresh, so an idle app pays nothing.
 */

import type { BandLevels } from './bands';

export const VISUALIZER_CHANNEL = 'manadj-visualizer';

/** Viz window → main: "I'm open, keep the frames coming". */
export const PING_INTERVAL_MS = 500;
/** Main window stops transmitting after this long without a ping. */
export const PING_TIMEOUT_MS = 2000;

export interface VisualizerPing {
  type: 'ping';
}

/** Multiband resolution shipped alongside the 3-band levels. */
export const SPECTRUM_BAND_COUNT = 8;

/** Main → viz: one smoothed band frame (~60 Hz while a viz window pings). */
export interface VisualizerFrame {
  type: 'bands';
  /** Isolator-aligned low/mid/high (bars, nebula). */
  bands: BandLevels;
  /** SPECTRUM_BAND_COUNT geometric bands, 40 Hz → 16 kHz (spectrum preset). */
  spectrum: number[];
  /** Sender performance.now() — lets the renderer detect a stalled feed. */
  sentAt: number;
}

export type VisualizerMessage = VisualizerPing | VisualizerFrame;

/** URL the visualizer window opens at (App.tsx pathname branch). */
export const VISUALIZER_PATH = '/visualizer';
