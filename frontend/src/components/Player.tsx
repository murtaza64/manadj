import { useEffect, forwardRef, useImperativeHandle } from 'react';
import type { Track } from '../types';
import { formatKeyDisplay } from '../utils/keyUtils';
import WebGLWaveform from './WebGLWaveform';
import { useAudio } from '../hooks/useAudio';
import { useWaveformData } from '../hooks/useWaveformData';
import { useSetBeatgridDownbeat, useNudgeBeatgrid } from '../hooks/useBeatgridData';
import './Player.css';

interface PlayerProps {
  track: Track | null;
}

export interface PlayerHandle {
  togglePlay: () => void;
  skip: (beats: number) => void;
  handleCueDown: () => void;
  handleCueUp: () => void;
}

const Player = forwardRef<PlayerHandle, PlayerProps>(({ track }, ref) => {
  // Get audio state and controls from context
  const audio = useAudio();

  // Beatgrid editing mutations
  const setDownbeat = useSetBeatgridDownbeat();
  const nudgeGrid = useNudgeBeatgrid();

  // Fetch waveform data to get cue point
  const { rawData: waveformData } = useWaveformData(track?.id ?? null);

  // Load track when it changes (only when track ID or waveform data changes)
  useEffect(() => {
    if (track) {
      const cuePointTime = waveformData?.cue_point_time ?? null;
      audio.loadTrack(track.id, cuePointTime);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.id, waveformData?.cue_point_time]);

  // Expose controls to parent via ref
  useImperativeHandle(ref, () => ({
    togglePlay: audio.togglePlayPause,
    skip: (beats: number) => {
      // Skip by beats instead of seconds
      const bpm = track?.bpm ?? 120;
      const secondsPerBeat = 60 / bpm;
      const jumpTime = beats * secondsPerBeat;
      const newTime = Math.max(0, Math.min(audio.duration, audio.currentTime + jumpTime));
      audio.seek(newTime);
    },
    handleCueDown: audio.handleCueDown,
    handleCueUp: audio.handleCueUp,
  }));

  const formatTime = (seconds: number): string => {
    if (!isFinite(seconds)) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Handler for set downbeat button
  const handleSetDownbeat = () => {
    if (!track) return;
    setDownbeat.mutate({
      trackId: track.id,
      downbeatTime: audio.currentTime
    });
  };

  // Handler for nudge buttons
  const handleNudge = (offsetMs: number) => {
    if (!track) return;
    nudgeGrid.mutate({
      trackId: track.id,
      offsetMs
    });
  };

  // Check if at cue point for button styling
  const atCuePoint = audio.cuePoint !== null && Math.abs(audio.currentTime - audio.cuePoint) < 0.1;

  return (
    <>
      {/* Waveform with controls overlay */}
      <div style={{ position: 'relative' }}>
        <WebGLWaveform trackId={track?.id ?? null} />

        {/* Controls overlay - top left */}
        <div style={{
          position: 'absolute',
          top: '8px',
          left: '8px',
          display: 'grid',
          gridTemplateColumns: 'auto auto',
          gridTemplateRows: 'auto auto auto',
          gap: '4px',
          padding: '8px',
          background: 'rgba(17, 17, 17, 0.8)',
          backdropFilter: 'blur(4px)',
        }}>
          {/* Row 1: CUE button */}
          <button
            onMouseDown={audio.handleCueDown}
            onMouseUp={audio.handleCueUp}
            onMouseLeave={audio.handleCueUp}
            disabled={!track}
            className={`player-button player-button-cue ${
              audio.isPreviewing
                ? 'player-button-cue-held'
                : !audio.isPlaying && audio.cuePoint !== null
                ? atCuePoint
                  ? 'player-button-cue-at-cue'
                  : 'player-button-cue-away-from-cue'
                : ''
            }`}
            title="Cue (F)"
          >
            CUE
          </button>

          {/* Row 1: Time display */}
          <div className="player-time" style={{
            fontSize: '12px',
            color: 'var(--subtext1)',
            display: 'flex',
            alignItems: 'center',
          }}>
            <span>{formatTime(audio.currentTime)}</span>
            <span className="player-time-separator">/</span>
            <span>{formatTime(audio.duration)}</span>
          </div>

          {/* Row 2: Play button */}
          <button
            onClick={audio.togglePlayPause}
            disabled={!track}
            className={`player-button ${audio.isPlaying ? 'player-button-playing' : 'player-button-paused'}`}
            title={audio.isPlaying ? 'Pause' : 'Play'}
          >
            ⏯
          </button>

          {/* Row 2: Key and BPM */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
            fontSize: '12px',
            color: 'var(--subtext1)',
            justifyContent: 'center',
          }}>
            {track && (
              <>
                <div style={{ color: 'var(--text)' }}>
                  {formatKeyDisplay(track.key)}
                </div>
                <div style={{ color: 'var(--text)' }}>
                  {track.bpm ? `${track.bpm} BPM` : '-'}
                </div>
              </>
            )}
          </div>

          {/* Row 3: Beat jump buttons */}
          <div style={{ display: 'flex', gap: '4px' }}>
            <button
              onClick={() => {
                const bpm = track?.bpm ?? 120;
                const beatsToJump = 32;
                const secondsPerBeat = 60 / bpm;
                const jumpTime = beatsToJump * secondsPerBeat;
                console.log('[Beatjump] Backward:', {
                  bpm,
                  beats: beatsToJump,
                  secondsPerBeat,
                  jumpTime,
                  currentTime: audio.currentTime,
                  newTime: audio.currentTime - jumpTime
                });
                const newTime = Math.max(0, Math.min(audio.duration, audio.currentTime - jumpTime));
                audio.seek(newTime);
              }}
              disabled={!track}
              className="player-button"
              title="Jump back 32 beats"
              style={{ flex: 1 }}
            >
              ◄◄
            </button>

            <button
              onClick={() => {
                const bpm = track?.bpm ?? 120;
                const beatsToJump = 32;
                const secondsPerBeat = 60 / bpm;
                const jumpTime = beatsToJump * secondsPerBeat;
                console.log('[Beatjump] Forward:', {
                  bpm,
                  beats: beatsToJump,
                  secondsPerBeat,
                  jumpTime,
                  currentTime: audio.currentTime,
                  newTime: audio.currentTime + jumpTime
                });
                const newTime = Math.max(0, Math.min(audio.duration, audio.currentTime + jumpTime));
                audio.seek(newTime);
              }}
              disabled={!track}
              className="player-button"
              title="Jump forward 32 beats"
              style={{ flex: 1 }}
            >
              ►►
            </button>
          </div>

          {/* Row 3: Beatgrid editing controls */}
          <div style={{ display: 'flex', gap: '4px' }}>
            <button
              onClick={() => handleNudge(-10)}
              disabled={!track || nudgeGrid.isPending}
              className="player-button"
              title="Nudge grid 10ms earlier"
              style={{ flex: 1 }}
            >
              ◄
            </button>
            <button
              onClick={handleSetDownbeat}
              disabled={!track || setDownbeat.isPending}
              className="player-button"
              style={{
                color: 'var(--blue)',
                borderColor: 'var(--blue)',
                flex: 1,
              }}
              title="Set downbeat at current position"
            >
              D
            </button>
            <button
              onClick={() => handleNudge(10)}
              disabled={!track || nudgeGrid.isPending}
              className="player-button"
              title="Nudge grid 10ms later"
              style={{ flex: 1 }}
            >
              ►
            </button>
          </div>
        </div>
      </div>
    </>
  );
});

Player.displayName = 'Player';

export default Player;
export type { PlayerHandle };
