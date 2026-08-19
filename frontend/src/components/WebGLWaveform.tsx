import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useWaveformBlob } from '../waveform/useWaveformBlob';
import { useWaveformRendererV2 } from '../waveform/useWaveformRendererV2';
import { loopOverlayRegions } from '../waveform/loopOverlay';
import { useBeatgridData } from '../hooks/useBeatgridData';
import { useMetricLadderData } from '../hooks/useMetricLadderData';
import { useHotCues } from '../hooks/useHotCues';
import { useDrops } from '../hooks/useDrops';
import type { PlaybackClock } from '../playback/clock';
import type { LoopRegion } from '../playback/loop';
import type { WaveformModulation } from '../waveform/WaveformRendererV2';
import { PLAY_MARKER_FRACTION, stepVisibleSeconds } from '../utils/waveformZoom';
import './Waveform.css';

/** The transport operations drag-to-scrub needs. */
export interface ScrubTransport {
  isPlaying(): boolean;
  pause(): void;
  play(): void;
  seek(time: number): void;
}

interface WebGLWaveformProps {
  trackId: number | null;
  clock: PlaybackClock;
  cuePoint: number | null;
  transport: ScrubTransport;
  /** Active loop region (looping 05): shaded green while a loop wraps. */
  loop?: LoopRegion | null;
  /** Grey out (and ignore input) while the deck can't play — e.g. decoding. */
  dimmed?: boolean;
  /**
   * Linked time-zoom (Performance view): when set, the waveform shows this
   * many seconds regardless of track duration, and wheel zoom reports the
   * new value through onVisibleSecondsChange instead of zooming locally —
   * the parent owns the one zoom all four Decks share. When absent (library),
   * the renderer keeps its own zoom.
   */
  visibleSeconds?: number;
  onVisibleSecondsChange?: (seconds: number) => void;
  className?: string;
  /** Deck beatjump size for target guides (beatjump-guides 01); absent
   * hides them. */
  beatjumpBeats?: number | null;
  /** Fixed-playhead position, 0-1 (default PLAY_MARKER_FRACTION = 0.25).
   * Per-surface: the performance decks must stay at 0.25 (PlayGuideOverlay
   * aligns to it); the library player centers at 0.5. */
  playMarkerFraction?: number;
  /** Time/bar readout placement (renderer config passthrough). */
  timeReadoutAnchor?: 'bottom-right' | 'top-left';
  timeReadoutOffset?: { x: number; y: number };
  /** Per-column amplitude modulation (renderer passthrough): the editor
   * feeds automation curves; the performance decks feed LIVE mixer state
   * (performance-mode 09 — the modTex is resampled every frame, so a
   * closure over the Mixer self-updates). */
  modulation?: WaveformModulation | null;
  /** Split mode (performance-mode 10): modulation reshapes only the top
   * lobe of the mirrored body; bottom lobe stays ground truth. */
  modulationSplit?: boolean;
}

export default function WebGLWaveform({
  trackId,
  clock,
  cuePoint,
  transport,
  loop = null,
  dimmed = false,
  beatjumpBeats = null,
  visibleSeconds,
  onVisibleSecondsChange,
  className,
  playMarkerFraction = PLAY_MARKER_FRACTION,
  timeReadoutAnchor,
  timeReadoutOffset,
  modulation = null,
  modulationSplit = false,
}: WebGLWaveformProps) {
  const { data: waveformData, isLoading, error: fetchError } = useWaveformBlob(trackId);
  const { data: beatgridData } = useBeatgridData(trackId);
  const { data: metricLadder } = useMetricLadderData(trackId);
  const { data: hotCues = [] } = useHotCues(trackId);
  // Possible drops (structure-analysis 02): fetch once blob + grid exist.
  const { drops } = useDrops(trackId, Boolean(waveformData && beatgridData));
  const regions = useMemo(() => loopOverlayRegions(loop), [loop]);

  const { canvasRef, rendererRef, initError } = useWaveformRendererV2({
    clock,
    waveformData,
    config: {
      isMinimapMode: false,
      playMarkerPosition: playMarkerFraction,
      showTimeReadout: true,
      timeReadoutAnchor,
      timeReadoutOffset,
    },
    cuePoint,
    hotCues,
    beatgrid: beatgridData?.data ?? null,
    metricLadder: metricLadder ?? null,
    beatjumpBeats,
    regions,
    dropMarks: drops,
  });

  // Apply the shared time-zoom (also after re-init when new data lands).
  useEffect(() => {
    if (visibleSeconds !== undefined) {
      rendererRef.current?.setVisibleSeconds(visibleSeconds);
    }
  }, [visibleSeconds, waveformData, rendererRef]);

  // Modulation passthrough (also re-applied after re-init on new data).
  useEffect(() => {
    rendererRef.current?.setModulation(modulation);
    rendererRef.current?.setModulationSplit(modulationSplit);
  }, [modulation, modulationSplit, waveformData, rendererRef]);

  // Drag-to-scrub: REAL seeks per pointer move (silent — the deck pauses
  // for the drag's duration). The playhead is then always where the view
  // says, so every playhead consumer (guides, minimap, readouts) tracks the
  // drag for free — no visual-offset side channel to keep in sync. Cheap by
  // construction: a seek on a paused buffer deck is an anchor update
  // (ADR 0018), and the engine clamps to the track.
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartPlayhead = useRef(0);
  const wasPlaying = useRef(false);

  const handleMouseDown = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!rendererRef.current) return;

    isDragging.current = true;
    dragStartX.current = event.clientX;
    dragStartPlayhead.current = clock.getPlayhead();
    event.currentTarget.style.cursor = 'grabbing';

    wasPlaying.current = transport.isPlaying();
    if (wasPlaying.current) {
      transport.pause();
    }
  };

  const handleMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging.current || !rendererRef.current) return;
    // Drag right = backward in time (content follows the pointer).
    const dx = event.clientX - dragStartX.current;
    const width = event.currentTarget.clientWidth || 1;
    const seconds = visibleSeconds ?? rendererRef.current.getVisibleSeconds();
    transport.seek(dragStartPlayhead.current - (dx / width) * seconds);
  };

  const endDrag = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging.current) return;
    isDragging.current = false;
    event.currentTarget.style.cursor = 'grab';
    if (wasPlaying.current) {
      transport.play();
    }
  };

  // Wheel zoom must attach natively with { passive: false } (the pattern in
  // PerfDiffViewer / OverviewLadder): React's onWheel lands in a passive
  // listener, where the preventDefault is a no-op that logs a console error
  // on every tick. Dependency-free effect: the canvas mounts and unmounts
  // across the loading/error early returns, so re-attach every render.
  const handleWheel = useCallback(
    (event: WheelEvent) => {
      if (visibleSeconds !== undefined && onVisibleSecondsChange) {
        // Linked zoom: report the step; the shared value comes back as a prop.
        event.preventDefault();
        onVisibleSecondsChange(
          stepVisibleSeconds(visibleSeconds, event.deltaY < 0 ? 'in' : 'out')
        );
        return;
      }
      rendererRef.current?.handleWheel(event);
    },
    [visibleSeconds, onVisibleSecondsChange, rendererRef],
  );
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  });

  // Loading and error states
  if (isLoading) {
    return (
      <div className={`waveform-container ${className || ''}`}>
        <div className="waveform-loading">Loading waveform...</div>
      </div>
    );
  }

  if (fetchError || initError) {
    return (
      <div className={`waveform-container ${className || ''}`}>
        <div className="waveform-error">
          {initError || 'Failed to load waveform'}
        </div>
      </div>
    );
  }

  if (!trackId) {
    return (
      <div className={`waveform-container ${className || ''}`}>
        <div className="waveform-empty">No track loaded</div>
      </div>
    );
  }

  return (
    <div className={`waveform-container ${dimmed ? 'waveform-dimmed' : ''} ${className || ''}`}>
      <canvas
        ref={canvasRef}
        className="waveform-canvas"
        style={{ cursor: 'grab' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
      />
    </div>
  );
}
