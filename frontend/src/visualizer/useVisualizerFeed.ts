/**
 * The visualizer feed as a hook (realtime-visualization 06): ping the
 * main-window bridge, collect frames into a ref (never React state —
 * frame rate), expose staleness at poll rate. Extracted from
 * VisualizerApp so the arena (?arena=1) shares the one feed contract.
 */

import { useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { INITIAL_TREND, SILENT_BANDS } from './bands';
import type { BandLevels, EnergyTrend } from './bands';
import { PING_INTERVAL_MS, SPECTRUM_BAND_COUNT, VISUALIZER_CHANNEL } from './channel';
import type {
  BeatInfo,
  DeckStateInfo,
  VisualizerMessage,
  VisualizerPing,
} from './channel';

export const SILENT_SPECTRUM = new Array<number>(SPECTRUM_BAND_COUNT).fill(0);
/** Band feed older than this renders as silence (main window gone/paused). */
export const STALE_MS = 1000;

export interface FeedState {
  bands: BandLevels;
  bandsSlow: BandLevels;
  spectrum: number[];
  wave: { left: Float32Array; right: Float32Array } | null;
  beat: BeatInfo | null;
  impulse: BandLevels;
  trend: EnergyTrend;
  centroid: number;
  spread: number;
  flatness: number;
  decks: DeckStateInfo[];
  receivedAt: number;
}

export const SILENT_FEED: FeedState = {
  bands: SILENT_BANDS,
  bandsSlow: SILENT_BANDS,
  spectrum: SILENT_SPECTRUM,
  wave: null,
  beat: null,
  impulse: SILENT_BANDS,
  trend: INITIAL_TREND,
  centroid: 0.5,
  spread: 0.5,
  flatness: 0.5,
  decks: [],
  receivedAt: -Infinity,
};

export function useVisualizerFeed(options: {
  wantsWave: () => boolean;
  presetId?: () => string | undefined;
  params?: () => Record<string, number> | undefined;
  onMessage?: (message: VisualizerMessage) => void;
}): { feedRef: MutableRefObject<FeedState>; stalled: boolean } {
  const feedRef = useRef<FeedState>(SILENT_FEED);
  const [stalled, setStalled] = useState(true);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const channel = new BroadcastChannel(VISUALIZER_CHANNEL);
    channel.onmessage = (event: MessageEvent<VisualizerMessage>) => {
      optionsRef.current.onMessage?.(event.data);
      if (event.data?.type !== 'bands') return;
      feedRef.current = {
        bands: event.data.bands,
        bandsSlow: event.data.bandsSlow ?? event.data.bands,
        spectrum: event.data.spectrum ?? SILENT_SPECTRUM,
        wave: event.data.wave ?? null,
        beat: event.data.beat ?? null,
        impulse: event.data.impulse ?? SILENT_BANDS,
        trend: event.data.trend ?? INITIAL_TREND,
        centroid: event.data.centroid ?? 0.5,
        spread: event.data.spread ?? 0.5,
        flatness: event.data.flatness ?? 0.5,
        decks: event.data.decks ?? [],
        receivedAt: performance.now(),
      };
    };
    const ping = () => {
      const current = optionsRef.current;
      const message: VisualizerPing = {
        type: 'ping',
        wantsWave: current.wantsWave(),
        presetId: current.presetId?.(),
        params: current.params?.(),
      };
      channel.postMessage(message);
    };
    ping();
    const pingTimer = setInterval(ping, PING_INTERVAL_MS);
    const staleTimer = setInterval(() => {
      setStalled(performance.now() - feedRef.current.receivedAt > STALE_MS);
    }, 500);
    return () => {
      clearInterval(pingTimer);
      clearInterval(staleTimer);
      channel.close();
    };
  }, []);

  return { feedRef, stalled };
}

/** A frame's feed slice at render time (stale → silence). */
export function feedFrame(feed: FeedState, now: number): Omit<FeedState, 'receivedAt'> {
  const fresh = now - feed.receivedAt <= STALE_MS;
  return fresh ? feed : SILENT_FEED;
}
