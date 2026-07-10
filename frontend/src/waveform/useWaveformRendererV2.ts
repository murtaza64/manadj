// Lifecycle hook for the texture renderer (ADR 0015): construction on the
// returned canvas, data feeding (waveform, beatgrid, hot cues, cue point),
// the clock-driven render loop, and disposal. The full waveform and the
// minimap are thin configurations of this one hook (ADR 0008).

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlaybackClock } from '../playback/clock';
import type { BeatgridData, HotCue } from '../types';
import { resolveLadder, resolvedMarkTimes } from '../meter/ladder';
import type { PersistedLadder } from '../meter/ladder';
import type { DecodedWaveform } from './blob';
import { WaveformRendererV2 } from './WaveformRendererV2';
import type { OverlayRegion, WaveformRendererConfig } from './WaveformRendererV2';
import { useStyleSlot } from './styleSlots';
import type { SlotName } from './styleSlots';

interface Options {
  clock: PlaybackClock;
  waveformData: DecodedWaveform | null | undefined;
  config: WaveformRendererConfig;
  cuePoint?: number | null;
  hotCues?: HotCue[];
  beatgrid?: BeatgridData | null;
  /** Persisted Metric-ladder deviation (metric-ladder 02): Reset marks the
   * resolver applies; absent/null = the default ladder. */
  metricLadder?: PersistedLadder | null;
  /** Deck beatjump size for target guides (beatjump-guides 01); null/absent
   * hides them. */
  beatjumpBeats?: number | null;
  /** Shaded overlay regions (looping 05), e.g. the active loop. */
  regions?: OverlayRegion[];
  /** Driven mode: no self-running render loop — the caller's own motion
   * clock calls the returned `draw()` once per frame. */
  driven?: boolean;
  /** Which persisted Waveform style slot this surface renders with.
   * Defaults to 'full'; minimaps pass 'minimap'. */
  slot?: SlotName;
}

export function useWaveformRendererV2({
  clock,
  waveformData,
  config,
  cuePoint = null,
  hotCues,
  beatgrid,
  metricLadder,
  beatjumpBeats = null,
  regions,
  driven = false,
  slot = 'full',
}: Options) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<WaveformRendererV2 | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const slotState = useStyleSlot(slot);

  useEffect(() => {
    if (!canvasRef.current || !waveformData) return;
    try {
      const renderer = new WaveformRendererV2(canvasRef.current, config);
      renderer.setWaveformData(waveformData);
      if (!driven) renderer.startRenderLoop(clock);
      rendererRef.current = renderer;
      setInitError(null);
      return () => {
        renderer.dispose();
        rendererRef.current = null;
      };
    } catch (err) {
      console.error('[useWaveformRendererV2] init failed:', err);
      setInitError('Failed to initialize waveform renderer');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waveformData, clock]);

  const draw = useCallback(() => {
    rendererRef.current?.renderFrame(clock);
  }, [clock]);

  // Persisted Waveform style: applied live (also after re-init).
  useEffect(() => {
    rendererRef.current?.setStyle(slotState.styleId, slotState.params);
  }, [slotState, waveformData]);

  useEffect(() => {
    rendererRef.current?.setCuePoint(cuePoint);
  }, [cuePoint, waveformData]);

  useEffect(() => {
    if (hotCues) rendererRef.current?.setHotCues(hotCues);
  }, [hotCues, waveformData]);

  useEffect(() => {
    if (beatgrid) {
      // Metric-ladder projection (metric-ladder 01/02): tier-weighted
      // gridlines with any persisted Reset marks applied; the renderer
      // never reads the ladder raw. Mark indicators draw at the RESOLVED
      // downbeats (what the count actually anchors to), not raw seconds.
      const ladder = resolveLadder(beatgrid, metricLadder);
      rendererRef.current?.setBeatgrid(
        beatgrid.beat_times,
        beatgrid.downbeat_times,
        ladder, // the projection IS the renderer's LadderGridInput slice
      );
      rendererRef.current?.setResetMarks(resolvedMarkTimes(beatgrid, metricLadder));
    }
  }, [beatgrid, metricLadder, waveformData]);

  useEffect(() => {
    if (regions) rendererRef.current?.setRegions(regions);
  }, [regions, waveformData]);

  useEffect(() => {
    rendererRef.current?.setBeatjumpGuides(beatjumpBeats);
  }, [beatjumpBeats, waveformData]);

  return { canvasRef, rendererRef, initError, draw };
}
