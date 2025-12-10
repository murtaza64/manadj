import React, { createContext, useContext, useRef, useState, useEffect, ReactNode } from 'react';

export interface AudioContextState {
  // Audio element ref (managed centrally)
  audioRef: React.RefObject<HTMLAudioElement>;

  // Playback state
  isPlaying: boolean;
  duration: number;
  volume: number;

  // Track info
  currentTrackId: number | null;

  // Cue point (time in seconds)
  cuePoint: number | null;
  isPreviewing: boolean;

  // Hot cue preview states (indexed by slot 1-8)
  hotCuePreviewing: Record<number, boolean>;

  // Seek trigger (increments on each seek to trigger waveform sync)
  seekVersion: number;

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

  // Hot cue behaviors
  handleHotCueDown: (slotNumber: number, hotCueTime: number | null) => void;
  handleHotCueUp: (slotNumber: number, hotCueTime: number | null) => void;
}

const AudioContext = createContext<AudioContextState | undefined>(undefined);

interface AudioProviderProps {
  children: ReactNode;
}

export const AudioProvider: React.FC<AudioProviderProps> = ({ children }) => {
  const audioRef = useRef<HTMLAudioElement>(null);

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(1.0);

  // Track info
  const [currentTrackId, setCurrentTrackId] = useState<number | null>(null);
  const [cuePoint, setCuePoint] = useState<number | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [hotCuePreviewing, setHotCuePreviewing] = useState<Record<number, boolean>>({});

  // Seek trigger (increments on each seek)
  const [seekVersion, setSeekVersion] = useState(0);

  // Audio event listeners
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

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

    audio.addEventListener('durationchange', handleDurationChange);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);

    return () => {
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
      setSeekVersion(prev => prev + 1);  // Increment to trigger waveform sync
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
    // Pause playback if currently playing
    if (isPlaying && audioRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);
    }

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
        seek(cuePoint);  // Use seek() to trigger waveform sync
      }
      setIsPreviewing(false);
    }
  };

  // Hot cue behaviors
  const handleHotCueDown = (slotNumber: number, hotCueTime: number | null) => {
    const audio = audioRef.current;
    if (!audio) return;

    // If hot cue is not set, it will be set by the component calling the API
    // This handler only handles playback behavior when hot cue exists
    if (hotCueTime === null) return;

    if (isPlaying) {
      // While playing: seek to hot cue and continue playing
      audio.currentTime = hotCueTime;
      setSeekVersion(prev => prev + 1);  // Trigger waveform sync
    } else {
      // While paused: preview mode (play while held)
      setHotCuePreviewing(prev => ({ ...prev, [slotNumber]: true }));
      audio.currentTime = hotCueTime;
      audio.play().catch(() => {});
    }
  };

  const handleHotCueUp = (slotNumber: number, hotCueTime: number | null) => {
    const audio = audioRef.current;
    if (!audio || hotCueTime === null) return;

    // If was previewing this hot cue slot
    if (hotCuePreviewing[slotNumber]) {
      // If deck is now playing (play was pressed during preview), just end preview
      if (isPlaying) {
        setHotCuePreviewing(prev => ({ ...prev, [slotNumber]: false }));
        // Audio keeps playing
      } else {
        // If deck still paused, return to hot cue and pause
        audio.pause();
        seek(hotCueTime);  // Use seek() to trigger waveform sync
        setHotCuePreviewing(prev => ({ ...prev, [slotNumber]: false }));
      }
    }
  };

  const value: AudioContextState = {
    audioRef,
    isPlaying,
    duration,
    volume,
    currentTrackId,
    cuePoint,
    isPreviewing,
    hotCuePreviewing,
    seekVersion,
    play,
    pause,
    togglePlayPause,
    seek,
    setVolume,
    loadTrack,
    handleCueDown,
    handleCueUp,
    handleHotCueDown,
    handleHotCueUp,
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
