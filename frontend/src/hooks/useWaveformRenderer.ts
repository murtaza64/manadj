import { useCallback, useEffect, useRef, useState } from 'react';
import { WebGLWaveformRenderer } from '../utils/WebGLWaveformRenderer';
import type { WaveformDataWebGL, WebGLRendererConfig } from '../utils/WebGLWaveformRenderer';
import type { PlaybackClock } from '../playback/clock';
import type { BeatgridData, HotCue } from '../types';

interface UseWaveformRendererOptions {
  /** Playback clock driving the render loop. Must be referentially stable. */
  clock: PlaybackClock;
  waveformData: WaveformDataWebGL | null | undefined;
  config: WebGLRendererConfig;
  cuePoint?: number | null;
  hotCues?: HotCue[];
  beatgrid?: BeatgridData | null;
  /** Driven mode: no self-running render loop — the caller's own motion
   * clock calls the returned `draw()` once per frame (multi-layer views
   * that must commit DOM writes and canvas paints in the same frame).
   * Applied at construction only, like `config`. */
  driven?: boolean;
}

/**
 * Owns a WebGLWaveformRenderer's lifecycle: construction on the returned
 * canvas, data feeding (waveform, beatgrid, hot cues, cue point), the
 * clock-driven render loop, and disposal. The full waveform and the minimap
 * are thin configurations of this one hook (ADR 0008 — twin-lifecycle
 * consolidation).
 */
export function useWaveformRenderer({
  clock,
  waveformData,
  config,
  cuePoint = null,
  hotCues,
  beatgrid,
  driven = false,
}: UseWaveformRendererOptions) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<WebGLWaveformRenderer | null>(null);
  const [initError, setInitError] = useState<string | null>(null);

  // Renderer lifecycle, keyed on data + clock. Config is applied at
  // construction only (it never changes for a mounted component).
  useEffect(() => {
    if (!canvasRef.current || !waveformData) return;

    try {
      const renderer = new WebGLWaveformRenderer(canvasRef.current, config);
      renderer.setWaveformData(waveformData);
      if (!driven) renderer.startRenderLoop(clock);
      rendererRef.current = renderer;
      setInitError(null);

      return () => {
        renderer.dispose();
        rendererRef.current = null;
      };
    } catch (err) {
      console.error('[useWaveformRenderer] init failed:', err);
      setInitError('Failed to initialize waveform renderer');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waveformData, clock]);

  /** Driven mode: render one frame now. No-op until the renderer exists
   * (waveform data still loading) or after disposal. Stable identity. */
  const draw = useCallback(() => {
    rendererRef.current?.renderFrame(clock);
  }, [clock]);

  // Marker/grid data (also re-applied after re-init via the waveformData dep).
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
