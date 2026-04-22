import { useEffect, useState, forwardRef, useImperativeHandle } from 'react';
import type { Track } from '../types';
import WebGLWaveform from './WebGLWaveform';
import { useAudio } from '../hooks/useAudio';
import { useWaveformData } from '../hooks/useWaveformData';
import { useHotCues } from '../hooks/useHotCues';
import HotCue from './HotCue';
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

  // Local state for time display (updated via setInterval, not React state from context)
  const [displayTime, setDisplayTime] = useState(0);

  // Fetch waveform data to get cue point
  const { rawData: waveformData } = useWaveformData(track?.id ?? null);

  // Fetch hot cues for current track
  const { data: hotCuesArray = [] } = useHotCues(track?.id ?? null);

  // Create a map from slot number to hot cue for easy lookup
  const hotCuesMap = new Map(hotCuesArray.map(hc => [hc.slot_number, hc]));

  // Update time display periodically (10 times per second)
  useEffect(() => {
    const interval = setInterval(() => {
      if (audio.audioRef.current) {
        setDisplayTime(audio.audioRef.current.currentTime);
      }
    }, 100); // 10 updates/sec - sufficient for time display

    return () => clearInterval(interval);
  }, [audio.audioRef]);

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
      const newTime = Math.max(0, Math.min(audio.duration, displayTime + jumpTime));
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

  // Check if at cue point for button styling
  const atCuePoint = audio.cuePoint !== null && Math.abs(displayTime - audio.cuePoint) < 0.1;

  return (
    <>
      {/* Waveform with controls overlays */}
      <div style={{ position: 'relative' }}>
        <WebGLWaveform trackId={track?.id ?? null} />

        {/* Controls overlay - top left */}
        <div className="player-controls-overlay">
          {/* Row 1: CUE button spanning all columns */}
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

          {/* Row 2: PLAY button spanning all columns */}
          <button
            onClick={audio.togglePlayPause}
            disabled={!track}
            className={`player-button ${audio.isPlaying ? 'player-button-playing' : 'player-button-paused'}`}
            title={audio.isPlaying ? 'Pause' : 'Play'}
          >
            ⏯
          </button>

          {/* Row 3: Jump back and forward buttons */}
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
                currentTime: audio.audioRef.current?.currentTime ?? 0,
                newTime: (audio.audioRef.current?.currentTime ?? 0) - jumpTime
              });
              const currentTime = audio.audioRef.current?.currentTime ?? 0;
              const newTime = Math.max(0, Math.min(audio.duration, currentTime - jumpTime));
              audio.seek(newTime);
            }}
            disabled={!track}
            className="player-button"
            title="Jump back 32 beats"
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
                currentTime: audio.audioRef.current?.currentTime ?? 0,
                newTime: (audio.audioRef.current?.currentTime ?? 0) + jumpTime
              });
              const currentTime = audio.audioRef.current?.currentTime ?? 0;
              const newTime = Math.max(0, Math.min(audio.duration, currentTime + jumpTime));
              audio.seek(newTime);
            }}
            disabled={!track}
            className="player-button"
            title="Jump forward 32 beats"
          >
            ►►
          </button>

          {/* Row 4: Time display - spanning all columns */}
          <div className="player-time">
            <span>{formatTime(displayTime)}</span>
            <span className="player-time-separator">/</span>
            <span>{formatTime(audio.duration)}</span>
          </div>
        </div>

        {/* Hot cues overlay - top right */}
        <div className="player-hotcues-overlay">
          {[1, 2, 3, 4, 5, 6, 7, 8].map(slot => (
            <HotCue
              key={slot}
              slotNumber={slot}
              trackId={track?.id ?? null}
              hotCue={hotCuesMap.get(slot)}
            />
          ))}
        </div>
      </div>
    </>
  );
});

Player.displayName = 'Player';

export default Player;
