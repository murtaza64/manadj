import { useEffect, useState, type RefObject } from 'react';
import type { Track } from '../types';
import type { PlayerHandle } from '../components/Player';
import { useAudio } from './useAudio';

interface UseKeyboardShortcutsProps {
  tracks: Track[];
  selectedTrack: Track | null;
  onSelectTrack: (track: Track | null) => void;
  playerRef: RefObject<PlayerHandle>;
  onNudgeBeatgrid?: (offsetMs: number) => void;
  onSetDownbeat?: () => void;
}

export function useKeyboardShortcuts({
  tracks,
  selectedTrack,
  onSelectTrack,
  playerRef,
  onNudgeBeatgrid,
  onSetDownbeat
}: UseKeyboardShortcutsProps) {
  const audio = useAudio();
  const [seekDirection, setSeekDirection] = useState<number>(0); // -1, 0, or 1
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Conflict prevention: ignore if typing in inputs or using certain modifiers
      const target = event.target as HTMLElement;
      const isInputFocused =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.contentEditable === 'true';

      if (isInputFocused || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }

      const key = event.key.toLowerCase();

      // Prevent key repeat for F key (cue button)
      if (key === 'f' && event.repeat) {
        event.preventDefault();
        return;
      }

      // Navigation: j/k
      if (key === 'j' || key === 'k') {
        event.preventDefault();

        if (tracks.length === 0) return;

        const currentIndex = selectedTrack
          ? tracks.findIndex(t => t.id === selectedTrack.id)
          : -1;

        let nextIndex: number;
        if (key === 'j') {
          // Next track (down)
          nextIndex = currentIndex === -1 ? 0 : currentIndex + 1;
          if (nextIndex >= tracks.length) nextIndex = tracks.length - 1;
        } else {
          // Previous track (up)
          nextIndex = currentIndex === -1 ? 0 : currentIndex - 1;
          if (nextIndex < 0) nextIndex = 0;
        }

        const nextTrack = tracks[nextIndex];
        onSelectTrack(nextTrack);

        // Scroll into view
        scrollTrackIntoView(nextTrack.id);
      }

      // Player controls: Space/a/s/f
      if (key === ' ' || key === 'a' || key === 's' || key === 'f') {
        if (!selectedTrack) return;

        event.preventDefault();

        if (key === ' ') {
          playerRef.current?.togglePlay();
        } else if (key === 'a') {
          playerRef.current?.skip(-32);  // Jump back 32 beats
        } else if (key === 's') {
          playerRef.current?.skip(32);   // Jump forward 32 beats
        } else if (key === 'f') {
          playerRef.current?.handleCueDown();
        }
      }

      // Beatgrid controls: Shift+H/L for nudge, G for set downbeat
      if ((key === 'h' || key === 'l') && event.shiftKey) {
        if (!selectedTrack) return;

        event.preventDefault();

        if (key === 'h' && onNudgeBeatgrid) {
          onNudgeBeatgrid(-10);  // Nudge left 10ms
        } else if (key === 'l' && onNudgeBeatgrid) {
          onNudgeBeatgrid(10);   // Nudge right 10ms
        }
      }

      if (key === 'g') {
        if (!selectedTrack) return;

        event.preventDefault();

        if (onSetDownbeat) {
          onSetDownbeat();
        }
      }

      // Slow seek: h/l (continuous when held, but not with Shift)
      if ((key === 'h' || key === 'l') && !event.shiftKey) {
        if (!selectedTrack) return;

        event.preventDefault();

        if (key === 'h') {
          setSeekDirection(-1);  // Seek backward
        } else if (key === 'l') {
          setSeekDirection(1);   // Seek forward
        }
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const isInputFocused =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.contentEditable === 'true';

      if (isInputFocused) {
        return;
      }

      const key = event.key.toLowerCase();

      // Release cue on F key up
      if (key === 'f') {
        if (!selectedTrack) return;
        event.preventDefault();
        playerRef.current?.handleCueUp();
      }

      // Stop slow seek on H/L key up (only if not holding Shift)
      if ((key === 'h' || key === 'l') && !event.shiftKey) {
        event.preventDefault();
        setSeekDirection(0);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
    };
  }, [tracks, selectedTrack, onSelectTrack, playerRef, onNudgeBeatgrid, onSetDownbeat]);

  // Continuous seek effect for H/L keys
  useEffect(() => {
    if (seekDirection === 0) return;

    const SEEK_SPEED = 0.01; // seconds per frame at 60fps
    let lastTimestamp = 0;
    let animationFrameId: number;

    const seek = (timestamp: number) => {
      if (lastTimestamp === 0) lastTimestamp = timestamp;
      const delta = (timestamp - lastTimestamp) / 1000; // Convert to seconds
      lastTimestamp = timestamp;

      // Read directly from audio element to avoid React state lag
      const audioEl = audio.audioRef.current;
      if (!audioEl) return;

      const seekAmount = seekDirection * SEEK_SPEED * (delta * 60); // Normalize to 60fps
      const newTime = Math.max(0, Math.min(audioEl.duration, audioEl.currentTime + seekAmount));
      audioEl.currentTime = newTime;

      animationFrameId = requestAnimationFrame(seek);
    };

    animationFrameId = requestAnimationFrame(seek);
    return () => cancelAnimationFrame(animationFrameId);
  }, [seekDirection, audio]);
}

// Helper function for scrolling selected track into view
function scrollTrackIntoView(trackId: number) {
  const rowElement = document.querySelector(`[data-track-id="${trackId}"]`);
  if (rowElement) {
    rowElement.scrollIntoView({
      behavior: 'smooth',
      block: 'center'
    });
  }
}
