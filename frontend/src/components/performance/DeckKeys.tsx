/**
 * DeckKeys — the Performance view's per-deck key bindings (issue 04), a
 * null-rendering component mounted once per <DeckScope>. Deck-blind: it
 * reads its deck from the scope and its keys from DECK_KEYS, so A and B are
 * the same code with mirrored maps.
 *
 * Guards mirror the library hub: keys are ignored while an input/textarea/
 * contenteditable has focus or with ctrl/meta/alt held; hold-style keys
 * (cue, nudge, pads) suppress key repeat.
 */
import { useEffect } from 'react';
import { useDeck, useDeckReady, useDeckSnapshot } from '../../hooks/useDeck';
import { useHotCueActions } from '../../hooks/useHotCueActions';
import { NUDGE_BEND_PERCENT } from '../../playback/tempo';
import { DECK_KEYS, isGuardedKeyEvent, isTypingTarget } from './performanceKeys';

export function DeckKeys() {
  const { deck, engine, loadedTrack, beatjumpBeats } = useDeck();
  const ready = useDeckReady();
  // The play key is allowed while loading — the engine latches play intent
  // (library-hub parity for space, on this view's play key).
  const canPlay = useDeckSnapshot(
    (s) =>
      s.loadState === 'ready' || s.loadState === 'fetching' || s.loadState === 'decoding'
  );
  const hotCues = useHotCueActions(loadedTrack?.id ?? null);

  useEffect(() => {
    const keys = DECK_KEYS[deck];
    const padSlot = (key: string) => {
      const i = keys.pads.indexOf(key);
      return i === -1 ? null : i + 1;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (isGuardedKeyEvent(event)) return;
      const key = event.key.toLowerCase();

      // Hold keys: swallow repeats but keep the event claimed.
      if (
        event.repeat &&
        (key === keys.cue ||
          key === keys.nudgeBack ||
          key === keys.nudgeForward ||
          padSlot(key) !== null)
      ) {
        event.preventDefault();
        return;
      }

      if (key === keys.play) {
        if (!canPlay) return;
        event.preventDefault();
        engine.togglePlay();
      } else if (key === keys.cue) {
        if (!ready) return;
        event.preventDefault();
        engine.cueDown();
      } else if (key === keys.jumpBack || key === keys.jumpForward) {
        if (!ready) return;
        event.preventDefault();
        engine.jumpBeats(key === keys.jumpBack ? -beatjumpBeats : beatjumpBeats);
      } else if (key === keys.nudgeBack || key === keys.nudgeForward) {
        if (!ready) return;
        event.preventDefault();
        engine.setBend(key === keys.nudgeBack ? -NUDGE_BEND_PERCENT : NUDGE_BEND_PERCENT);
      } else {
        const slot = padSlot(key);
        if (slot !== null) {
          if (!hotCues.enabled) return;
          event.preventDefault();
          hotCues.down(slot);
        }
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      // Input focus only — a modifier held at release must not eat the keyup
      // (library-hub parity; a stuck held-cue otherwise).
      if (isTypingTarget(event)) return;
      const key = event.key.toLowerCase();

      if (key === keys.cue) {
        if (!ready) return;
        event.preventDefault();
        engine.cueUp();
      } else if (key === keys.nudgeBack || key === keys.nudgeForward) {
        event.preventDefault();
        engine.setBend(0);
      } else {
        const slot = padSlot(key);
        if (slot !== null && hotCues.enabled) {
          event.preventDefault();
          hotCues.up(slot);
        }
      }
    };

    // A missed keyup (window blur mid-hold) must not strand a bend.
    const onBlur = () => engine.setBend(0);

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [deck, engine, ready, canPlay, beatjumpBeats, hotCues]);

  return null;
}
