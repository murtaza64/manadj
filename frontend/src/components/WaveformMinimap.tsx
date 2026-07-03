import { useWaveformRenderer } from '../hooks/useWaveformRenderer';
import { useWaveformData } from '../hooks/useWaveformData';
import { useHotCues } from '../hooks/useHotCues';
import type { PlaybackClock } from '../playback/clock';
import './Waveform.css';

interface WaveformMinimapProps {
  trackId: number | null;
  clock: PlaybackClock;
  cuePoint: number | null;
  onSeek: (time: number) => void;
  /** Grey out (and ignore input) while the deck can't play — e.g. decoding. */
  dimmed?: boolean;
  className?: string;
}

export default function WaveformMinimap({
  trackId,
  clock,
  cuePoint,
  onSeek,
  dimmed = false,
  className,
}: WaveformMinimapProps) {
  const { data: waveformData, isLoading, error: fetchError } = useWaveformData(trackId);
  const { data: hotCues = [] } = useHotCues(trackId);

  const { canvasRef, rendererRef, initError } = useWaveformRenderer({
    clock,
    waveformData,
    config: {
      isMinimapMode: true,
      maxZoom: 1.0,
      minZoom: 1.0,
    },
    cuePoint,
    hotCues,
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
