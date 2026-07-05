import { useEffect, useState } from 'react';
import type { Track } from '../types';
import { GRID_NUDGE_MS } from './useBeatgridData';
import { useDeck, useDeckReady, useDeckSnapshot } from './useDeck';
import { useScrubLoop } from './useScrubLoop';

/**
 * Library keyboard hub. Keys split by scope (ADR 0008):
 * - Selection-scoped (the highlighted row): j/k navigate, t tags, e energy
 * - Deck-scoped (the loaded Track): space play/pause, f cue (hold),
 *   a/s beatjump, h/l scrub (hold), 1-8 hot cues, Shift+1-8 delete hot cue,
 *   g set downbeat, Shift+H/L nudge beatgrid
 * - The bridge: Enter loads the selection onto the Deck
 */

interface UseKeyboardShortcutsProps {
  /** The anchor of the multi-selection: Enter/t/e target (playlist-editing 02). */
  selectedTrack: Track | null;
  /** j/k: move the anchor, collapsing any multi-selection to a single row. */
  onNavigate: (delta: 1 | -1) => void;
  /** Cmd/Ctrl-A: select all visible rows. */
  onSelectAll?: () => void;
  /** Delete/Backspace: remove the selection from the viewed playlist
   * (only provided in playlist views — playlist-editing 04). */
  onRemoveSelected?: () => void;
  /** Tab: switch pane focus (only provided in the split edit view —
   * playlist-editing 05). */
  onSwitchPane?: () => void;
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
  selectedTrack,
  onNavigate,
  onSelectAll,
  onRemoveSelected,
  onSwitchPane,
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
  // a/s jump by the deck's shared beatjump size (deck-controls PRD: one
  // per-deck N across modes — set it in any view, these keys use it).
  const { engine, beatjumpBeats } = useDeck();
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

      // Select all: Cmd/Ctrl-A (before the modifier guard below drops it)
      if (
        !isInputFocused &&
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        event.key.toLowerCase() === 'a' &&
        onSelectAll
      ) {
        event.preventDefault();
        onSelectAll();
        return;
      }

      if (isInputFocused || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }

      const key = event.key.toLowerCase();

      // Prevent key repeat for F key (cue button)
      if (key === 'f' && event.repeat) {
        event.preventDefault();
        return;
      }

      // Navigation: j/k or arrows (selection-scoped; collapses a multi-selection)
      if (key === 'j' || key === 'k' || event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        onNavigate(key === 'j' || event.key === 'ArrowDown' ? 1 : -1);
      }

      // Remove from playlist: Delete/Backspace (selection-scoped, no confirm)
      if ((event.key === 'Delete' || event.key === 'Backspace') && onRemoveSelected) {
        event.preventDefault();
        onRemoveSelected();
      }

      // Pane focus: Tab switches between the split view's panes
      if (event.key === 'Tab' && onSwitchPane) {
        event.preventDefault();
        onSwitchPane();
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
          engine.jumpBeats(-beatjumpBeats);
        } else if (key === 's') {
          engine.jumpBeats(beatjumpBeats);
        } else if (key === 'f') {
          engine.cueDown();
        }
      }

      // Beatgrid controls (deck-scoped): Shift+H/L nudge, G set downbeat
      if ((key === 'h' || key === 'l') && event.shiftKey) {
        if (!deckReady) return;

        event.preventDefault();

        if (key === 'h' && onNudgeBeatgrid) {
          onNudgeBeatgrid(-GRID_NUDGE_MS);
        } else if (key === 'l' && onNudgeBeatgrid) {
          onNudgeBeatgrid(GRID_NUDGE_MS);
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
    selectedTrack,
    onNavigate,
    onSelectAll,
    onRemoveSelected,
    onSwitchPane,
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
    beatjumpBeats,
    deckReady,
    deckCanPlay,
  ]);

  // Continuous scrub while h/l is held
  useScrubLoop(engine, scrubDirection);
}

// Helper function for scrolling selected track into view (also used by the
// Library's imperative browse handle for the Performance view's table keys
// and the hardware browser encoder).
//
// Burst-aware (midi-controller 10): rapid successive navigations (a spun
// encoder, held arrow keys) restart a smooth scroll animation on every call
// — it never completes and the list stutters. Within a burst we jump
// instantly (the row stays centered tick by tick); a lone navigation keeps
// the smooth glide.
const SCROLL_BURST_MS = 200;
let lastScrollMs = -Infinity;

export function scrollTrackIntoView(trackId: number) {
  const now = performance.now();
  const inBurst = now - lastScrollMs < SCROLL_BURST_MS;
  lastScrollMs = now;
  const rowElement = document.querySelector(`[data-track-id="${trackId}"]`);
  if (rowElement) {
    rowElement.scrollIntoView({
      behavior: inBurst ? 'auto' : 'smooth',
      block: 'center'
    });
  }
}
