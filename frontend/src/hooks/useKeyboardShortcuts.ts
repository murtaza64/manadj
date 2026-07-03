import { useEffect, useState } from 'react';
import type { Track } from '../types';
import { useDeck, useDeckReady, useDeckSnapshot } from './useDeck';
import { useScrubLoop } from './useScrubLoop';
import { BEATJUMP_BEATS } from '../playback/constants';

/**
 * Library keyboard hub. Keys split by scope (ADR 0008):
 * - Selection-scoped (the highlighted row): j/k navigate, t tags, e energy
 * - Deck-scoped (the loaded Track): space play/pause, f cue (hold),
 *   a/s beatjump, h/l scrub (hold), 1-8 hot cues, Shift+1-8 delete hot cue,
 *   g set downbeat, Shift+H/L nudge beatgrid
 * - The bridge: Enter loads the selection onto the Deck
 */

interface UseKeyboardShortcutsProps {
  tracks: Track[];
  selectedTrack: Track | null;
  onSelectTrack: (track: Track | null) => void;
  onLoadTrack: (track: Track) => void;
  onNudgeBeatgrid?: (offsetMs: number) => void;
  onSetDownbeat?: () => void;
  onEnterTagEditMode?: () => void;
  onEnterEnergyEditMode?: () => void;
  onHotCueDown?: (slotNumber: number) => void;
  onHotCueUp?: (slotNumber: number) => void;
  onHotCueDelete?: (slotNumber: number) => void;
  isEnergyEditMode?: boolean;
}

export function useKeyboardShortcuts({
  tracks,
  selectedTrack,
  onSelectTrack,
  onLoadTrack,
  onNudgeBeatgrid,
  onSetDownbeat,
  onEnterTagEditMode,
  onEnterEnergyEditMode,
  onHotCueDown,
  onHotCueUp,
  onHotCueDelete,
  isEnergyEditMode
}: UseKeyboardShortcutsProps) {
  const { engine } = useDeck();
  const deckReady = useDeckReady();
  // Space is allowed while loading — the engine latches play intent.
  const deckCanPlay = useDeckSnapshot(
    (s) => s.loadState === 'ready' || s.loadState === 'fetching' || s.loadState === 'decoding'
  );
  const [scrubDirection, setScrubDirection] = useState<number>(0); // -1, 0, or 1

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

      // Navigation: j/k (selection-scoped)
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

      // Load: Enter puts the selection on the Deck (the browse -> Deck bridge).
      // Skip when a button has focus (e.g. after clicking a player control) —
      // Enter there should not surprise-load the selection.
      if (event.key === 'Enter') {
        if (!selectedTrack || target.tagName === 'BUTTON') return;
        event.preventDefault();
        onLoadTrack(selectedTrack);
      }

      // Deck transport: Space/a/s/f
      if (key === ' ' || key === 'a' || key === 's' || key === 'f') {
        // Space latches play intent during a load; the rest need audio.
        if (key === ' ' ? !deckCanPlay : !deckReady) return;

        event.preventDefault();

        if (key === ' ') {
          engine.togglePlay();
        } else if (key === 'a') {
          engine.jumpBeats(-BEATJUMP_BEATS);
        } else if (key === 's') {
          engine.jumpBeats(BEATJUMP_BEATS);
        } else if (key === 'f') {
          engine.cueDown();
        }
      }

      // Beatgrid controls (deck-scoped): Shift+H/L nudge, G set downbeat
      if ((key === 'h' || key === 'l') && event.shiftKey) {
        if (!deckReady) return;

        event.preventDefault();

        if (key === 'h' && onNudgeBeatgrid) {
          onNudgeBeatgrid(-10);  // Nudge left 10ms
        } else if (key === 'l' && onNudgeBeatgrid) {
          onNudgeBeatgrid(10);   // Nudge right 10ms
        }
      }

      if (key === 'g') {
        if (!deckReady) return;

        event.preventDefault();

        if (onSetDownbeat) {
          onSetDownbeat();
        }
      }

      // Tag editing mode: T (selection-scoped)
      if (key === 't') {
        if (!selectedTrack) return;

        event.preventDefault();

        if (onEnterTagEditMode) {
          onEnterTagEditMode();
        }
      }

      // Energy editing mode: E (selection-scoped)
      if (key === 'e') {
        if (!selectedTrack) return;

        event.preventDefault();

        if (onEnterEnergyEditMode) {
          onEnterEnergyEditMode();
        }
      }

      // Scrub: h/l held (deck-scoped, continuous, but not with Shift)
      if ((key === 'h' || key === 'l') && !event.shiftKey) {
        if (!deckReady) return;

        event.preventDefault();

        if (key === 'h') {
          setScrubDirection(-1);  // Scrub backward
        } else if (key === 'l') {
          setScrubDirection(1);   // Scrub forward
        }
      }

      // Hot cue keys: 1-8 (deck-scoped; prevent key repeat like F key)
      // Use event.code to detect Digit1-8 regardless of Shift state
      // Skip if in energy edit mode (numbers 1-5 set energy level)
      if (/^Digit[1-8]$/.test(event.code) && !event.shiftKey) {
        if (!deckReady || isEnergyEditMode) return;

        // Prevent key repeat for hot cue buttons
        if (event.repeat) {
          event.preventDefault();
          return;
        }

        event.preventDefault();

        // Extract digit from 'Digit1' -> 1
        const slotNumber = parseInt(event.code.slice(-1), 10);
        if (onHotCueDown) {
          onHotCueDown(slotNumber);
        }
      }

      // Hot cue delete: Shift+1-8 (deck-scoped, single press only, no repeat)
      if (/^Digit[1-8]$/.test(event.code) && event.shiftKey) {
        if (!deckReady || isEnergyEditMode) return;

        // Prevent key repeat
        if (event.repeat) {
          event.preventDefault();
          return;
        }

        event.preventDefault();

        // Extract digit from 'Digit1' -> 1
        const slotNumber = parseInt(event.code.slice(-1), 10);
        if (onHotCueDelete) {
          onHotCueDelete(slotNumber);
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
        if (!deckReady) return;
        event.preventDefault();
        engine.cueUp();
      }

      // Stop scrub on H/L key up (only if not holding Shift)
      if ((key === 'h' || key === 'l') && !event.shiftKey) {
        event.preventDefault();
        setScrubDirection(0);
      }

      // Hot cue key up: 1-8 (only for non-Shift, since Shift deletes)
      if (/^Digit[1-8]$/.test(event.code) && !event.shiftKey) {
        if (!deckReady || isEnergyEditMode) return;

        event.preventDefault();

        // Extract digit from 'Digit1' -> 1
        const slotNumber = parseInt(event.code.slice(-1), 10);
        if (onHotCueUp) {
          onHotCueUp(slotNumber);
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
    };
  }, [
    tracks,
    selectedTrack,
    onSelectTrack,
    onLoadTrack,
    onNudgeBeatgrid,
    onSetDownbeat,
    onEnterTagEditMode,
    onEnterEnergyEditMode,
    onHotCueDown,
    onHotCueUp,
    onHotCueDelete,
    isEnergyEditMode,
    engine,
    deckReady,
    deckCanPlay,
  ]);

  // Continuous scrub while h/l is held
  useScrubLoop(engine, scrubDirection);
}

// Helper function for scrolling selected track into view (also used by the
// Library's imperative browse handle for the Performance view's table keys)
export function scrollTrackIntoView(trackId: number) {
  const rowElement = document.querySelector(`[data-track-id="${trackId}"]`);
  if (rowElement) {
    rowElement.scrollIntoView({
      behavior: 'smooth',
      block: 'center'
    });
  }
}
