import React, { createContext, useContext, useRef, useState, useEffect, ReactNode } from 'react';

export interface AudioContextState {
  // Audio element ref (managed centrally)
  audioRef: React.RefObject<HTMLAudioElement>;

  // Playback state
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;

  // Track info
  currentTrackId: number | null;

  // Cue point (time in seconds)
  cuePoint: number | null;
  isPreviewing: boolean;

  // Playback controls
  play: () => void;
  pause: () => void;
  togglePlayPause: () => void;
  seek: (time: number) => void;
  setVolume: (volume: number) => void;

  // Track loading
  loadTrack: (trackId: number, cuePointTime: number | null) => void;

  // Cue button behaviors
  handleCueDown: () => void;
  handleCueUp: () => void;
}

const AudioContext = createContext<AudioContextState | undefined>(undefined);

interface AudioProviderProps {
  children: ReactNode;
}

export const AudioProvider: React.FC<AudioProviderProps> = ({ children }) => {
  const audioRef = useRef<HTMLAudioElement>(null);

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(1.0);

  // Track info
  const [currentTrackId, setCurrentTrackId] = useState<number | null>(null);
  const [cuePoint, setCuePoint] = useState<number | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);

  // Audio event listeners
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => setCurrentTime(audio.currentTime);
    const handleDurationChange = () => setDuration(audio.duration);
    const handleEnded = () => {
      setIsPlaying(false);
      // If track ended during preview, return to cue point
      if (isPreviewing && cuePoint !== null) {
        audio.currentTime = cuePoint;
        setIsPreviewing(false);
      }
    };
    const handleError = (e: Event) => {
      console.error('[AudioContext] Audio error:', e);
      console.error('[AudioContext] Audio element error:', audio.error);
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('durationchange', handleDurationChange);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('durationchange', handleDurationChange);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
    };
  }, [isPreviewing, cuePoint]);

  // Playback controls
  const play = () => {
    if (!audioRef.current) return;
    setIsPlaying(true);
    audioRef.current.play().catch(err => {
      console.error('[AudioContext] Play failed:', err);
      setIsPlaying(false);
    });
  };

  const pause = () => {
    if (!audioRef.current) return;
    setIsPlaying(false);
    audioRef.current.pause();
  };

  const togglePlayPause = () => {
    if (isPlaying) {
      pause();
    } else {
      play();
    }
  };

  const seek = (time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  const setVolume = (vol: number) => {
    if (audioRef.current) {
      audioRef.current.volume = vol;
      setVolumeState(vol);
    }
  };

  // Track loading
  const loadTrack = (trackId: number, cuePointTime: number | null) => {
    setCurrentTrackId(trackId);
    setCuePoint(cuePointTime);
    setIsPreviewing(false);

    if (audioRef.current) {
      audioRef.current.src = `http://localhost:8000/api/tracks/${trackId}/audio`;
      audioRef.current.load();
    }
  };

  // Cue button behaviors (original from Player component)
  const handleCueDown = () => {
    const audio = audioRef.current;
    if (!audio) return;

    const currentPos = audio.currentTime;
    const atCuePoint = cuePoint !== null && Math.abs(currentPos - cuePoint) < 0.01;

    if (isPlaying) {
      // Behavior 3: Return to cue and pause (pause the deck)
      if (cuePoint !== null) {
        audio.currentTime = cuePoint;
        setIsPlaying(false);
        audio.pause();
        setIsPreviewing(false);
      }
    } else if (atCuePoint && cuePoint !== null) {
      // Behavior 2: Preview from cue (audio plays but deck stays paused)
      setIsPreviewing(true);
      audio.play().catch(() => {});
    } else {
      // Behavior 1: Set cue point at current position
      setCuePoint(currentPos);

      // TODO: Persist to backend
      // fetch(`http://localhost:8000/api/tracks/${currentTrackId}/waveform/cue`, {
      //   method: 'PUT',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify({ cue_point_time: currentPos })
      // });
    }
  };

  const handleCueUp = () => {
    const audio = audioRef.current;
    if (!audio) return;

    // If previewing and deck was started (play pressed), just end preview
    if (isPreviewing && isPlaying) {
      setIsPreviewing(false);
      // Audio keeps playing, deck stays playing
    } else if (isPreviewing) {
      // If previewing and deck still paused, return to cue
      audio.pause();
      if (cuePoint !== null) {
        audio.currentTime = cuePoint;
      }
      setIsPreviewing(false);
    }
  };

  const value: AudioContextState = {
    audioRef,
    isPlaying,
    currentTime,
    duration,
    volume,
    currentTrackId,
    cuePoint,
    isPreviewing,
    play,
    pause,
    togglePlayPause,
    seek,
    setVolume,
    loadTrack,
    handleCueDown,
    handleCueUp,
  };

  return (
    <AudioContext.Provider value={value}>
      {children}
      {/* Hidden audio element managed by context */}
      <audio ref={audioRef} style={{ display: 'none' }} />
    </AudioContext.Provider>
  );
};

export const useAudioContext = () => {
  const context = useContext(AudioContext);
  if (!context) {
    throw new Error('useAudioContext must be used within AudioProvider');
  }
  return context;
};
