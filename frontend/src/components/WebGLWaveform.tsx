import { useEffect, useRef } from 'react';
import { useWaveformRenderer } from '../hooks/useWaveformRenderer';
import { useWaveformData } from '../hooks/useWaveformData';
import { useBeatgridData } from '../hooks/useBeatgridData';
import { useHotCues } from '../hooks/useHotCues';
import { useWaveformBlob } from '../waveform/useWaveformBlob';
import { useWaveformRendererV2 } from '../waveform/useWaveformRendererV2';
import type { PlaybackClock } from '../playback/clock';
import { stepVisibleSeconds } from '../utils/waveformZoom';
import './Waveform.css';

/** The renderer surface the interaction handlers below rely on — satisfied
 * by both the legacy geometry renderer and the v2 texture renderer. */
interface InteractiveWaveformRenderer {
  setDragOffset(pixels: number): void;
  commitDrag(): number | undefined;
  handleWheel(event: WheelEvent): void;
  setVisibleSeconds(seconds: number): void;
}

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
   * the renderer keeps its own track-relative zoom.
   */
  visibleSeconds?: number;
  onVisibleSecondsChange?: (seconds: number) => void;
  className?: string;
  /** Which waveform engine draws this surface. 'v2' = the texture renderer
   * over Waveform data blobs (ADR 0015); 'legacy' = the geometry renderer
   * over JSON peaks. Library player runs v2 (issue 03); the remaining
   * surfaces swap in issue 04, after which this prop disappears. */
  renderEngine?: 'legacy' | 'v2';
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
  renderEngine = 'legacy',
}: WebGLWaveformProps) {
  const isV2 = renderEngine === 'v2';
  // Both hooks run (rules of hooks); the inactive one gets a null track id
  // and stays idle (no fetch, no renderer).
  const legacyData = useWaveformData(isV2 ? null : trackId);
  const blobData = useWaveformBlob(isV2 ? trackId : null);
  const { data: beatgridData } = useBeatgridData(trackId);
  const { data: hotCues = [] } = useHotCues(trackId);

  const rendererConfig = {
    isMinimapMode: false,
    playMarkerPosition: 0.25,
    maxZoom: 50.0,
    minZoom: 0.5,
    showTimeReadout: true,
  };
  const legacy = useWaveformRenderer({
    clock,
    waveformData: legacyData.data,
    config: rendererConfig,
    cuePoint,
    hotCues,
    beatgrid: beatgridData?.data ?? null,
  });
  const v2 = useWaveformRendererV2({
    clock,
    waveformData: blobData.data,
    config: rendererConfig,
    cuePoint,
    hotCues,
    beatgrid: beatgridData?.data ?? null,
  });

  const canvasRef = isV2 ? v2.canvasRef : legacy.canvasRef;
  const initError = isV2 ? v2.initError : legacy.initError;
  const isLoading = isV2 ? blobData.isLoading : legacyData.isLoading;
  const fetchError = isV2 ? blobData.error : legacyData.error;
  const rendererRef = {
    get current(): InteractiveWaveformRenderer | null {
      return isV2 ? v2.rendererRef.current : legacy.rendererRef.current;
    },
  };

  // Apply the shared time-zoom (also after re-init when new data lands).
  useEffect(() => {
    if (visibleSeconds !== undefined) {
      rendererRef.current?.setVisibleSeconds(visibleSeconds);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleSeconds, legacyData.data, blobData.data]);

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
