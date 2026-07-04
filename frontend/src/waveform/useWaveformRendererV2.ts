// Lifecycle hook for the v2 texture renderer (ADR 0015) — the v2 counterpart
// of useWaveformRenderer, same return shape, so components can choose the
// engine at the seam. Collapses into useWaveformRenderer when the legacy
// renderer is deleted (issue 04).

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlaybackClock } from '../playback/clock';
import type { BeatgridData, HotCue } from '../types';
import type { WebGLRendererConfig } from '../utils/WebGLWaveformRenderer';
import type { DecodedWaveform } from './blob';
import { WaveformRendererV2 } from './WaveformRendererV2';

interface Options {
  clock: PlaybackClock;
  waveformData: DecodedWaveform | null | undefined;
  config: WebGLRendererConfig;
  cuePoint?: number | null;
  hotCues?: HotCue[];
  beatgrid?: BeatgridData | null;
  driven?: boolean;
}

export function useWaveformRendererV2({
  clock,
  waveformData,
  config,
  cuePoint = null,
  hotCues,
  beatgrid,
  driven = false,
}: Options) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<WaveformRendererV2 | null>(null);
  const [initError, setInitError] = useState<string | null>(null);

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

  useEffect(() => {
    rendererRef.current?.setCuePoint(cuePoint);
  }, [cuePoint, waveformData]);

  useEffect(() => {
    if (hotCues) rendererRef.current?.setHotCues(hotCues);
  }, [hotCues, waveformData]);

  useEffect(() => {
    if (beatgrid) {
      rendererRef.current?.setBeatgrid(beatgrid.beat_times, beatgrid.downbeat_times);
    }
  }, [beatgrid, waveformData]);

  return { canvasRef, rendererRef, initError, draw };
}
