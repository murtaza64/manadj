import { useMemo } from 'react';
import { useWaveformBlob } from '../waveform/useWaveformBlob';
import { useWaveformRendererV2 } from '../waveform/useWaveformRendererV2';
import { loopOverlayRegions } from '../waveform/loopOverlay';
import { useHotCues } from '../hooks/useHotCues';
import type { PlaybackClock } from '../playback/clock';
import type { LoopRegion } from '../playback/loop';
import type { BeatgridData } from '../types';
import './Waveform.css';

interface WaveformMinimapProps {
  trackId: number | null;
  clock: PlaybackClock;
  cuePoint: number | null;
  onSeek: (time: number) => void;
  /** Active loop (looping 05): drawn as a thin green band. */
  loop?: LoopRegion | null;
  /** Grey out (and ignore input) while the deck can't play — e.g. decoding. */
  dimmed?: boolean;
  /** Optional beat/downbeat ticks (useful at DAW-style zoom levels). */
  beatgrid?: BeatgridData | null;
  className?: string;
}

export default function WaveformMinimap({
  trackId,
  clock,
  cuePoint,
  onSeek,
  loop = null,
  dimmed = false,
  beatgrid = null,
  className,
}: WaveformMinimapProps) {
  const { data: waveformData, isLoading, error: fetchError } = useWaveformBlob(trackId);
  const { data: hotCues = [] } = useHotCues(trackId);
  const regions = useMemo(() => loopOverlayRegions(loop), [loop]);

  const { canvasRef, rendererRef, initError } = useWaveformRendererV2({
    clock,
    waveformData,
    config: {
      isMinimapMode: true,
    },
    cuePoint,
    hotCues,
    beatgrid,
    regions,
    slot: 'minimap',
  });

  const handleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const seekTime = rendererRef.current?.handleClick(event.nativeEvent);
    if (seekTime !== undefined) {
      onSeek(seekTime);
    }
  };

  // Loading and error states
  if (isLoading) {
    return (
      <div className={`minimap-container ${className || ''}`}>
        <div className="minimap-loading">Loading...</div>
      </div>
    );
  }

  if (fetchError || initError) {
    return (
      <div className={`minimap-container ${className || ''}`}>
        <div className="minimap-error">
          {initError || 'Failed to load minimap'}
        </div>
      </div>
    );
  }

  if (!trackId) {
    return (
      <div className={`minimap-container ${className || ''}`}>
        <div className="minimap-empty">No track</div>
      </div>
    );
  }

  return (
    <div className={`minimap-container ${dimmed ? 'waveform-dimmed' : ''} ${className || ''}`}>
      <canvas
        ref={canvasRef}
        className="minimap-canvas"
        style={{ cursor: 'pointer' }}
        onClick={handleClick}
      />
    </div>
  );
}
