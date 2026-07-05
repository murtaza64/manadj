import { useEffect, useRef } from 'react';
import { useWaveformBlob } from '../waveform/useWaveformBlob';
import { useWaveformRendererV2 } from '../waveform/useWaveformRendererV2';
import { useBeatgridData } from '../hooks/useBeatgridData';
import { useHotCues } from '../hooks/useHotCues';
import type { PlaybackClock } from '../playback/clock';
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
  /** Grey out (and ignore input) while the deck can't play — e.g. decoding. */
  dimmed?: boolean;
  /**
   * Linked time-zoom (Performance view): when set, the waveform shows this
   * many seconds regardless of track duration, and wheel zoom reports the
   * new value through onVisibleSecondsChange instead of zooming locally —
   * the parent owns the one zoom both decks share. When absent (library),
   * the renderer keeps its own zoom.
   */
  visibleSeconds?: number;
  onVisibleSecondsChange?: (seconds: number) => void;
  className?: string;
}

export default function WebGLWaveform({
  trackId,
  clock,
  cuePoint,
  transport,
  dimmed = false,
  visibleSeconds,
  onVisibleSecondsChange,
  className,
}: WebGLWaveformProps) {
  const { data: waveformData, isLoading, error: fetchError } = useWaveformBlob(trackId);
  const { data: beatgridData } = useBeatgridData(trackId);
  const { data: hotCues = [] } = useHotCues(trackId);

  const { canvasRef, rendererRef, initError } = useWaveformRendererV2({
    clock,
    waveformData,
    config: {
      isMinimapMode: false,
      playMarkerPosition: PLAY_MARKER_FRACTION,
      showTimeReadout: true,
    },
    cuePoint,
    hotCues,
    beatgrid: beatgridData?.data ?? null,
  });

  // Apply the shared time-zoom (also after re-init when new data lands).
  useEffect(() => {
    if (visibleSeconds !== undefined) {
      rendererRef.current?.setVisibleSeconds(visibleSeconds);
    }
  }, [visibleSeconds, waveformData, rendererRef]);

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

  const handleWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    if (visibleSeconds !== undefined && onVisibleSecondsChange) {
      // Linked zoom: report the step; the shared value comes back as a prop.
      event.nativeEvent.preventDefault();
      onVisibleSecondsChange(
        stepVisibleSeconds(visibleSeconds, event.deltaY < 0 ? 'in' : 'out')
      );
      return;
    }
    rendererRef.current?.handleWheel(event.nativeEvent);
  };

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
        onWheel={handleWheel}
      />
    </div>
  );
}
