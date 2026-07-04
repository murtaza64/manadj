import { useMemo } from 'react';
import { useDeck, useDeckReady } from './useDeck';
import { useHotCues, useSetHotCue, useDeleteHotCue } from './useHotCues';
import type { HotCue } from '../types';

export interface HotCueActions {
  /** Hot cues by slot number for the given track. */
  bySlot: Map<number, HotCue>;
  /** False when no track is loaded/ready — all actions no-op. */
  enabled: boolean;
  /** Press: set-at-playhead when unset, jump/preview when set. */
  down: (slot: number) => void;
  /** Release: ends a hold-to-preview. */
  up: (slot: number) => void;
  /** Delete the hot cue in a slot. */
  remove: (slot: number) => void;
}

/** The injectable seam (deck-controls 05): what pressing a SET cue does —
 * deck trigger (jump/hold-preview) or an editor gesture (Slide/jump). The
 * curation half (set-empty-at-playhead, delete) is shared and identical. */
export interface HotCueSlotHandlers {
  enabled: boolean;
  getPlayhead: () => number;
  /** Press behavior for a SET cue. */
  trigger: (slot: number, timeSeconds: number) => void;
  /** Release, for hold-style triggers (absent = taps, e.g. editor gestures). */
  release?: (slot: number, timeSeconds: number) => void;
}

/**
 * Hot-cue slot behavior for a Track with an injected trigger — the single
 * implementation of the CURATION half (set / delete) everywhere hot cues
 * appear; what a press *does* is the caller's class (playback trigger vs
 * alignment gesture — deck-controls PRD).
 */
export function useHotCueSlots(
  trackId: number | null,
  handlers: HotCueSlotHandlers
): HotCueActions {
  const { data: hotCues = [] } = useHotCues(trackId);
  const setHotCue = useSetHotCue();
  const deleteHotCue = useDeleteHotCue();

  const bySlot = useMemo(
    () => new Map(hotCues.map((hc) => [hc.slot_number, hc])),
    [hotCues]
  );

  const enabled = trackId !== null && handlers.enabled;

  const down = (slot: number) => {
    if (!enabled || trackId === null) return;
    const cue = bySlot.get(slot);
    if (!cue) {
      // Hot cue not set: set it at the current playhead
      setHotCue.mutate({
        trackId,
        slotNumber: slot,
        data: { time_seconds: handlers.getPlayhead() },
      });
    } else {
      handlers.trigger(slot, cue.time_seconds);
    }
  };

  const up = (slot: number) => {
    if (!enabled) return;
    const cue = bySlot.get(slot);
    if (cue) handlers.release?.(slot, cue.time_seconds);
  };

  const remove = (slot: number) => {
    if (!enabled || trackId === null) return;
    const cue = bySlot.get(slot);
    if (cue) deleteHotCue.mutate({ trackId, slotNumber: slot });
  };

  return { bySlot, enabled, down, up, remove };
}

/**
 * Deck-scoped hot cue behavior for the loaded Track — the single
 * implementation behind both the pad buttons and the 1-8 keyboard keys.
 * Deliberately does NOT subscribe to preview state (callers that need it,
 * e.g. pad highlighting, select it themselves) so keyboard consumers like
 * the Library don't re-render on every stab.
 */
export function useHotCueActions(trackId: number | null): HotCueActions {
  const { engine } = useDeck();
  const ready = useDeckReady();
  return useHotCueSlots(trackId, {
    enabled: ready,
    getPlayhead: () => engine.getPlayhead(),
    trigger: (slot, t) => engine.hotCueDown(slot, t),
    release: (slot, t) => engine.hotCueUp(slot, t),
  });
}
