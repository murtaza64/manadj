import { useEffect, useRef } from 'react';
import { useWaveformBlob } from '../waveform/useWaveformBlob';
import { useWaveformRendererV2 } from '../waveform/useWaveformRendererV2';
import { useBeatgridData } from '../hooks/useBeatgridData';
import { useHotCues } from '../hooks/useHotCues';
import type { PlaybackClock } from '../playback/clock';
import { stepVisibleSeconds } from '../utils/waveformZoom';
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
      playMarkerPosition: 0.25,
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

  // Drag-to-scrub state
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const wasPlaying = useRef(false);

  const handleMouseDown = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!rendererRef.current) return;

    isDragging.current = true;
    dragStartX.current = event.clientX;
    event.currentTarget.style.cursor = 'grabbing';

    // Pause playback during the drag; the clock then holds still while the
    // drag offset shifts the visible content.
    wasPlaying.current = transport.isPlaying();
    if (wasPlaying.current) {
      transport.pause();
    }
  };

  const handleMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging.current || !rendererRef.current) return;
    rendererRef.current.setDragOffset(event.clientX - dragStartX.current);
  };

  const endDrag = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging.current) return;
    isDragging.current = false;
    event.currentTarget.style.cursor = 'grab';

    const seekTime = rendererRef.current?.commitDrag();
    if (seekTime !== undefined) {
      transport.seek(seekTime);
    }
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
