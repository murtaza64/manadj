import { useMemo } from 'react';
import { useWaveformBlob } from '../waveform/useWaveformBlob';
import type { DecodedWaveform } from '../waveform/blob';
import { useWaveformRendererV2 } from '../waveform/useWaveformRendererV2';
import { useViewActive } from '../contexts/viewActive';
import { loopOverlayRegions } from '../waveform/loopOverlay';
import { useHotCues } from '../hooks/useHotCues';
import type { PlaybackClock } from '../playback/clock';
import type { LoopRegion } from '../playback/loop';
import type { BeatgridData } from '../types';
import './Waveform.css';

interface WaveformMinimapProps {
  /** Per-stem waveforms (stems #213): masked everywhere on the minimap
   * (history behind the playhead, live mask ahead). */
  stemWaveforms?: DecodedWaveform[] | null;
  /** Per-column mask source; stable identity. */
  stemMaskAt?: ((t: number) => readonly number[]) | null;
  /** Any-value wake: repaint paused decks on stem toggles. */
  wakeKey?: unknown;
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
  /** Whether the deck is advancing (performance-hardening 01): pins the loop
   * at 60fps and wakes it instantly at play. Defaults to false. */
  playing?: boolean;
  /** Event-driven wake (#155): the deck's transport gesture stream, so
   * paused seeks (MIDI jog, beatjump, hot cues) repaint on the next frame
   * instead of the 250ms idle poll. Must be stable. */
  subscribeWake?: (cb: () => void) => () => void;
}

export default function WaveformMinimap({
  stemWaveforms = null,
  stemMaskAt = null,
  wakeKey,
  trackId,
  clock,
  cuePoint,
  onSeek,
  loop = null,
  dimmed = false,
  beatgrid = null,
  className,
  playing = false,
  subscribeWake,
}: WaveformMinimapProps) {
  const { data: waveformData, isLoading, error: fetchError } = useWaveformBlob(trackId);
  const { data: hotCues = [] } = useHotCues(trackId);
  const regions = useMemo(() => loopOverlayRegions(loop), [loop]);
  const viewActive = useViewActive();

  const { canvasRef, rendererRef, initError } = useWaveformRendererV2({
    clock,
    waveformData,
    stemWaveforms,
    stemMaskAt,
    stemLobeSplit: false,
    wakeKey,
    config: {
      isMinimapMode: true,
    },
    cuePoint,
    hotCues,
    beatgrid,
    regions,
    slot: 'minimap',
    active: viewActive,
    playing,
    subscribeWake,
  });

  const handleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const seekTime = rendererRef.current?.handleClick(event.nativeEvent);
    if (seekTime !== undefined) {
      onSeek(seekTime);
      // Paused seek: wake the idle loop so the playhead repaints this frame
      // (performance-hardening 01).
      rendererRef.current?.markDirty();
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
