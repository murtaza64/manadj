/**
 * DeckKeys — the Performance view's per-deck key bindings (issue 04), a
 * null-rendering component mounted once per <DeckScope>. Deck-blind: it
 * reads its Deck from the scope and its keys from DECK_KEYS by SIDE, so
 * every Deck is the same code — the left-hand map drives whichever Deck is
 * left-focused (A or C), the right-hand map whichever is right-focused
 * (B or D). The map is mirrored per hand, not per physical Deck.
 *
 * Guards mirror the library hub: keys are ignored while an input/textarea/
 * contenteditable has focus or with ctrl/meta/alt held, except Cmd+cue walk.
 * Hold-style keys suppress key repeat.
 */
import { useEffect, useRef } from 'react';
import { useViewActive } from '../../contexts/viewActive';
import { useDeck } from '../../hooks/useDeck';
import { useHotCueActions } from '../../hooks/useHotCueActions';
import { useMixer } from '../../hooks/useMixer';
import { MouseJogController } from './mouseJog';
import { getMouseJogSettings, setMouseJogSpeed } from './mouseJogSettings';
import { DECK_KEYS, hasKeyboardOverlay, isGuardedKeyEvent, isTextEntryTarget, isTypingTarget } from './performanceKeys';
import { registerKeyboardPointer, type KeyboardPointerFeedback } from './keyboardPointer';
import { invertControl, MIXER_DRAG_RANGE_PX, moveKnob, type KnobGesture } from './mouseControl';

export function DeckKeys({ enabled = true }: { enabled?: boolean }) {
  const viewActive = useViewActive() && enabled;
  const { deck, engine, loadedTrack, beatjumpBeats } = useDeck();
  const hotCues = useHotCueActions(loadedTrack?.id ?? null);
  const mixer = useMixer();
  const cueHeld = useRef(false);
  const padsHeld = useRef(new Map<number, () => void>());

  // Keep gesture state independent of React/query repaint frequency. Mouse
  // deltas read current mixer values so reversing at a stop responds at once.
  useEffect(() => {
    if (!viewActive) return;
    const keys = DECK_KEYS[deck === 'A' || deck === 'C' ? 'A' : 'B'];
    const mouseKeys = new Set([...Object.values(keys.knobs), keys.fader, keys.jog]);
    const held = new Map<string, {
      started: number; travel: number; secondTap: boolean;
      knob?: KnobGesture;
    }>();
    const lastTap = new Map<string, number>();
    let jogRotation = 0;
    const jog = new MouseJogController(engine, getMouseJogSettings, speed => setMouseJogSpeed(deck, speed));
    const release = () => {
      held.clear();
      lastTap.clear();
      jog.setTouch(false);
      pointer.stop();
    };
    const pointer = registerKeyboardPointer({
      cancel: release,
      move: (dx, dy, elapsedMs) => {
        for (const press of held.values()) press.travel += Math.hypot(dx, dy);
        // Diagonal movement does not double sensitivity or cancel itself.
        const delta = (Math.abs(dx) >= Math.abs(dy) ? dx : -dy) / MIXER_DRAG_RANGE_PX;
        const clamp = (value: number) => Math.max(0, Math.min(1, value));
        if (delta !== 0) {
          const now = performance.now();
          const channel = mixer.getChannelState(deck);
          for (const band of ['filter', 'high', 'mid', 'low'] as const) {
            const press = held.get(keys.knobs[band]);
            if (!press) continue;
            const bipolar = band === 'filter';
            const value = bipolar ? channel.filter : channel.eq[band];
            press.knob = moveKnob(press.knob, value, delta, now, bipolar);
            if (bipolar) mixer.setFilter(deck, press.knob.value);
            else mixer.setEq(deck, band, press.knob.value);
          }
          if (held.has(keys.fader)) mixer.setFader(deck, clamp(channel.fader + delta));
        }
        if (dx !== 0 && held.has(keys.jog)) {
          jogRotation += dx * 2;
          jog.move(dx, elapsedMs);
        }
      },
      feedback: () => {
        const feedback: KeyboardPointerFeedback[] = [];
        const channel = mixer.getChannelState(deck);
        const automation = mixer.getAutomation(deck);
        const color = `var(--deck-${deck.toLowerCase()})`;
        for (const key of held.keys()) {
          if (key === keys.jog) {
            const snapshot = engine.getSnapshot();
            const label = jog.isPlatterMode ? (jog.isTouching ? 'SCRATCH' : 'SCRATCH READY') : snapshot.playing ? 'BEND' : 'SEEK';
            feedback.push({ id: key, kind: 'jog', label: `${deck} ${label}`,
              value: jogRotation, color, detail: snapshot.playing && !jog.isPlatterMode
                ? `${snapshot.bendPercent.toFixed(2)}%` : `${engine.getPlayhead().toFixed(2)}s` });
          } else if (key === keys.fader) {
            feedback.push({ id: key, kind: 'fader', label: `${deck} VOL`, value: channel.fader,
              color, detail: `${Math.round(channel.fader * 100)}%` });
          } else {
            const band = (['filter', 'high', 'mid', 'low'] as const).find(band => keys.knobs[band] === key)!;
            const value = band === 'filter' ? (channel.filter + 1) / 2 : channel.eq[band];
            const ghost = automation
              ? band === 'filter' ? (automation.filter + 1) / 2 : automation.eq[band]
              : null;
            feedback.push({ id: key, kind: 'knob', label: `${deck} ${band.toUpperCase()}`, value,
              control: band === 'filter' ? 'filter' : band === 'high' ? 'eqHigh' : band === 'mid' ? 'eqMid' : 'eqLow',
              ghost, color, detail: `${Math.round((ghost ?? value) * 100)}%` });
          }
        }
        return feedback;
      },
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (isGuardedKeyEvent(event)) {
        release();
        return;
      }
      const key = event.key.toLowerCase();
      if (key === 'shift' && held.has(keys.jog)) {
        event.preventDefault();
        if (!event.repeat) jog.setTouch(true);
        return;
      }
      if (!mouseKeys.has(key)) return;
      event.preventDefault();
      if (event.repeat || held.has(key)) return;
      if (key === keys.jog && engine.getSnapshot().loadState !== 'ready') return;
      const now = performance.now();
      held.set(key, { started: now, travel: 0, secondTap: now - (lastTap.get(key) ?? -Infinity) <= 300 });
      lastTap.delete(key);
      if (key === keys.jog) jog.setTouch(event.shiftKey);
      if (held.has(key)) pointer.start();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (key === 'shift' && held.has(keys.jog)) {
        event.preventDefault();
        jog.setTouch(false);
        return;
      }
      const press = held.get(key);
      if (!press) return;
      held.delete(key);
      event.preventDefault();
      const now = performance.now();
      const tap = key !== keys.jog && press.travel <= 3 && now - press.started <= 250;
      if (tap && press.secondTap && !isGuardedKeyEvent(event)) {
        const channel = mixer.getChannelState(deck);
        if (key === keys.fader) mixer.setFader(deck, invertControl(channel.fader, 1));
        else {
          const band = (['filter', 'high', 'mid', 'low'] as const).find(band => keys.knobs[band] === key)!;
          if (band === 'filter') mixer.setFilter(deck, 0);
          else mixer.setEq(deck, band, invertControl(channel.eq[band], 0.5));
        }
      } else if (tap && !press.secondTap) lastTap.set(key, now);
      if (key === keys.jog) jog.setTouch(false);
      if (!held.size) pointer.stop();
    };
    const onFocus = () => {
      if (isTextEntryTarget(document.activeElement)) release();
    };
    const onVisibility = () => {
      if (document.hidden) release();
    };
    const onBlur = () => {
      release();
      // Also recover a missed pointer-up from the on-screen nudge buttons.
      engine.setBend(0);
    };
    const releaseJog = () => {
      held.delete(keys.jog);
      jog.setTouch(false);
      if (!held.size) pointer.stop();
    };
    // Engine-ended scratches need a fresh contact, never a stale Shift hold.
    const unsubscribe = engine.subscribe(() => {
      const snapshot = engine.getSnapshot();
      if (snapshot.loadState !== 'ready') release();
      else if (jog.isTouching && !snapshot.scratching) releaseJog();
      else jog.syncState();
    });
    const unsubscribeTransport = engine.addTransportEventListener(event => {
      if (jog.isTouching && (event.action === 'seek' || event.action === 'jumpBeats'
        || event.action === 'hotCue' || event.action === 'scratchEnd')) releaseJog();
    });
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      unsubscribe();
      unsubscribeTransport();
      release();
      jog.dispose();
      pointer.dispose();
    };
  }, [deck, engine, mixer, viewActive, loadedTrack?.id]);

  // Only release cues this keyboard started, never a MIDI or replay preview
  // on a deck that is merely being hidden by the layout toggle.
  useEffect(
    () => () => {
      if (cueHeld.current) {
        cueHeld.current = false;
        engine.cueUp();
      }
      for (const release of padsHeld.current.values()) release();
      padsHeld.current.clear();
    },
    [engine, viewActive]
  );

  useEffect(() => {
    if (!viewActive) return;
    // Pick the hand map by side: left-side Decks (A/C) use the left-hand
    // ('A') layout, right-side (B/D) the right-hand ('B') layout.
    const keys = DECK_KEYS[deck === 'A' || deck === 'C' ? 'A' : 'B'];
    const padSlot = (key: string) => {
      const i = keys.pads.indexOf(key);
      return i === -1 ? null : i + 1;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (!viewActive || isTypingTarget(event) || hasKeyboardOverlay()) return;
      const snapshot = engine.getSnapshot();
      const ready = snapshot.loadState === 'ready' && snapshot.trackId === loadedTrack?.id;
      const canPlay = snapshot.loadState === 'ready' || snapshot.loadState === 'fetching' || snapshot.loadState === 'decoding';
      const key = event.key.toLowerCase();
      if (event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey &&
          (key === keys.jumpBack || key === keys.jumpForward)) {
        event.preventDefault();
        if (!event.repeat && ready && !engine.getSnapshot().playing) {
          hotCues.walk?.(key === keys.jumpBack ? 'prev' : 'next');
        }
        return;
      }
      if (isGuardedKeyEvent(event)) return;

      // Hold keys: swallow repeats but keep the event claimed.
      if (
        event.repeat &&
        (key === keys.cue || padSlot(key) !== null)
      ) {
        event.preventDefault();
        return;
      }

      if (key === keys.play) {
        if (!canPlay) return;
        event.preventDefault();
        engine.togglePlay(event.timeStamp);
      } else if (key === keys.cue) {
        if (!ready) return;
        event.preventDefault();
        cueHeld.current = true;
        engine.cueDown();
      } else if (key === keys.jumpBack || key === keys.jumpForward) {
        if (!ready) return;
        event.preventDefault();
        engine.jumpBeats(key === keys.jumpBack ? -beatjumpBeats : beatjumpBeats);
      } else {
        const slot = padSlot(key);
        if (slot !== null) {
          if (!ready) return;
          event.preventDefault();
          hotCues.down(slot);
          padsHeld.current.set(slot, () => hotCues.up(slot));
        }
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();

      if (key === keys.cue) {
        if (!cueHeld.current) return;
        event.preventDefault();
        cueHeld.current = false;
        engine.cueUp();
      } else {
        const slot = padSlot(key);
        if (slot !== null && padsHeld.current.has(slot)) {
          event.preventDefault();
          padsHeld.current.get(slot)!();
          padsHeld.current.delete(slot);
        }
      }
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
    };
  }, [deck, engine, loadedTrack?.id, beatjumpBeats, hotCues, viewActive]);

  return null;
}
