import { useEffect, type RefObject } from 'react';
import type { Track } from '../types';
import type { PlayerHandle } from '../components/Player';

interface UseKeyboardShortcutsProps {
  tracks: Track[];
  selectedTrack: Track | null;
  onSelectTrack: (track: Track | null) => void;
  playerRef: RefObject<PlayerHandle>;
}

export function useKeyboardShortcuts({
  tracks,
  selectedTrack,
  onSelectTrack,
  playerRef
}: UseKeyboardShortcutsProps) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Conflict prevention: ignore if typing in inputs or using modifiers
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
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const isInputFocused =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.contentEditable === 'true';

      if (isInputFocused || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }

      const key = event.key.toLowerCase();

      // Release cue on F key up
      if (key === 'f') {
        if (!selectedTrack) return;
        event.preventDefault();
        playerRef.current?.handleCueUp();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
    };
  }, [tracks, selectedTrack, onSelectTrack, playerRef]);
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
