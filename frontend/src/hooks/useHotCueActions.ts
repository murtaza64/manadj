import { useMemo } from 'react';
import { useDeck, useDeckSnapshot } from './useDeck';
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

/**
 * Deck-scoped hot cue behavior for the loaded Track — the single
 * implementation behind both the pad buttons and the 1-8 keyboard keys.
 * Deliberately does NOT subscribe to preview state (callers that need it,
 * e.g. pad highlighting, select it themselves) so keyboard consumers like
 * the Library don't re-render on every stab.
 */
export function useHotCueActions(trackId: number | null): HotCueActions {
  const { engine } = useDeck();
  const ready = useDeckSnapshot((s) => s.loadState === 'ready');
  const { data: hotCues = [] } = useHotCues(trackId);
  const setHotCue = useSetHotCue();
  const deleteHotCue = useDeleteHotCue();

  const bySlot = useMemo(
    () => new Map(hotCues.map((hc) => [hc.slot_number, hc])),
    [hotCues]
  );

  const enabled = trackId !== null && ready;

  const down = (slot: number) => {
    if (!enabled || trackId === null) return;
    const cue = bySlot.get(slot);
    if (!cue) {
      // Hot cue not set: set it at the current playhead
      setHotCue.mutate({
        trackId,
        slotNumber: slot,
        data: { time_seconds: engine.getPlayhead() },
      });
    } else {
      // Hot cue is set: trigger playback behavior
      engine.hotCueDown(slot, cue.time_seconds);
    }
  };

  const up = (slot: number) => {
    if (!enabled) return;
    const cue = bySlot.get(slot);
    if (cue) engine.hotCueUp(slot, cue.time_seconds);
  };

  const remove = (slot: number) => {
    if (!enabled || trackId === null) return;
    const cue = bySlot.get(slot);
    if (cue) deleteHotCue.mutate({ trackId, slotNumber: slot });
  };

  return { bySlot, enabled, down, up, remove };
}
