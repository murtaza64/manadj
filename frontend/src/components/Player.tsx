import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import type { Track } from '../types';
import CanvasWaveform from './CanvasWaveform';
import './Player.css';

interface PlayerProps {
  track: Track | null;
}

export interface PlayerHandle {
  togglePlay: () => void;
  skip: (seconds: number) => void;
  handleCueDown: () => void;
  handleCueUp: () => void;
}

const Player = forwardRef<PlayerHandle, PlayerProps>(({ track }, ref) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [cuePoint, setCuePoint] = useState<number | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);

  // Reset player when track changes
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(0);
      setError(null);
      setCuePoint(null);
      setIsPreviewing(false);
    }
  }, [track?.id]);

  // Setup audio event listeners
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const updateTime = () => setCurrentTime(audio.currentTime);
    const updateDuration = () => setDuration(audio.duration);
    const handleEnd = () => {
      setIsPlaying(false);
      if (isPreviewing && cuePoint !== null) {
        // Track ended during preview - reset to cue point
        if (audio) {
          audio.currentTime = cuePoint;
        }
        setIsPreviewing(false);
      }
    };
    const handleError = () => {
      setError('Failed to load audio file');
      setIsPlaying(false);
    };

    audio.addEventListener('timeupdate', updateTime);
    audio.addEventListener('loadedmetadata', updateDuration);
    audio.addEventListener('ended', handleEnd);
    audio.addEventListener('error', handleError);

    return () => {
      audio.removeEventListener('timeupdate', updateTime);
      audio.removeEventListener('loadedmetadata', updateDuration);
      audio.removeEventListener('ended', handleEnd);
      audio.removeEventListener('error', handleError);
    };
  }, [isPreviewing, cuePoint]);

  const togglePlay = async () => {
    if (!audioRef.current || !track) return;

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      try {
        await audioRef.current.play();
        setIsPlaying(true);
        setError(null);
      } catch (err) {
        setError('Playback failed');
        setIsPlaying(false);
      }
    }
  };

  const skip = (seconds: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = Math.max(
      0,
      Math.min(duration, audioRef.current.currentTime + seconds)
    );
  };

  const handleCueMouseDown = () => {
    if (!audioRef.current || !track) return;

    const currentPos = audioRef.current.currentTime;
    const atCuePoint = cuePoint !== null && Math.abs(currentPos - cuePoint) < 0.1;

    if (isPlaying) {
      // Behavior 3: Return to cue and pause
      if (cuePoint !== null) {
        audioRef.current.currentTime = cuePoint;
        audioRef.current.pause();
        setIsPlaying(false);
        setIsPreviewing(false);
      }
    } else if (atCuePoint && cuePoint !== null) {
      // Behavior 2: Preview from cue (start playback)
      audioRef.current.play().catch(() => {});
      setIsPreviewing(true);
    } else {
      // Behavior 1: Set cue point at current position
      setCuePoint(currentPos);
    }
  };

  const handleCueMouseUp = () => {
    if (!audioRef.current || !track) return;

    // Only return to cue if we were in preview mode
    if (isPreviewing && cuePoint !== null) {
      audioRef.current.pause();
      audioRef.current.currentTime = cuePoint;
      setIsPreviewing(false);
    }
  };

  // Expose togglePlay, skip, and cue handlers to parent via ref
  useImperativeHandle(ref, () => ({
    togglePlay,
    skip,
    handleCueDown: handleCueMouseDown,
    handleCueUp: handleCueMouseUp
  }));

  const formatTime = (seconds: number): string => {
    if (!isFinite(seconds)) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const audioSrc = track ? `http://localhost:8000/api/tracks/${track.id}/audio` : undefined;
  const trackTitle = track ? (track.title || track.filename.split('/').pop()) : 'No track selected';

  return (
    <>
      <audio ref={audioRef} src={audioSrc} preload="metadata" />

      {/* Waveform at top - full width */}
      {track && (
        <CanvasWaveform
          audioElement={audioRef.current}
          trackId={track.id}
          cuePoint={cuePoint}
        />
      )}

      {/* Controls and metadata at bottom */}
      <div className="player">
        <div className="player-track-info">
          <span className="player-track-name">{trackTitle}</span>
        </div>

        <div className="player-metadata">
          {track ? (
            <span className="player-metadata-field">{track.artist || '-'}</span>
          ) : (
            <span className="player-metadata-field">-</span>
          )}
        </div>

        <div className="player-controls">
          <button
            onClick={() => skip(-15)}
            disabled={!track}
            className="player-button"
            title="Skip back 15s"
          >
            ◄◄
          </button>

          <button
            onMouseDown={handleCueMouseDown}
            onMouseUp={handleCueMouseUp}
            onMouseLeave={handleCueMouseUp}
            disabled={!track}
            className={`player-button player-button-cue ${
              isPreviewing
                ? 'player-button-cue-held'
                : !isPlaying && cuePoint !== null
                ? Math.abs(currentTime - cuePoint) < 0.1
                  ? 'player-button-cue-at-cue'
                  : 'player-button-cue-away-from-cue'
                : ''
            }`}
            title="Cue (F)"
          >
            CUE
          </button>

          <button
            onClick={togglePlay}
            disabled={!track}
            className={`player-button ${isPlaying ? 'player-button-playing' : 'player-button-paused'}`}
            title={isPlaying ? 'Pause' : 'Play'}
          >
            ⏯
          </button>

          <button
            onClick={() => skip(15)}
            disabled={!track}
            className="player-button"
            title="Skip forward 15s"
          >
            ►►
          </button>
        </div>

        <div className="player-time">
          <span>{formatTime(currentTime)}</span>
          <span className="player-time-separator">/</span>
          <span>{formatTime(duration)}</span>
          {track && (
            <>
              <span className="player-time-separator">•</span>
              <span>{track.key || '-'}</span>
              <span className="player-time-separator">•</span>
              <span>{track.bpm ? `${track.bpm} BPM` : '-'}</span>
            </>
          )}
        </div>

        {error && (
          <div className="player-error">{error}</div>
        )}
      </div>
    </>
  );
});

Player.displayName = 'Player';

export default Player;
export type { PlayerHandle };
