/**
 * Drag-to-Load (gh#296): a track drag dropped on a Deck surface Loads the
 * drag's PRIMARY (first) track onto that Deck — never fans out. Reuses the
 * track drag payload (trackDrag) and the host view's existing Load path.
 *
 * The host view supplies the policy through DeckDropContext (Performance:
 * the load-lock tryLoad; Library: replace-freely). Surfaces without a
 * provider are inert. DeckDropOverlay draws the highlight; a refused Deck
 * shows the refusal on hover and the drop is not accepted (dropEffect 'none').
 */
import { createContext, useCallback, useContext, useEffect, useState, type DragEvent } from 'react';
import { api } from '../api/client';
import type { ChannelId } from '../playback/mixer';
import type { Track } from '../types';
import { isTrackDrag, readTrackDragPayload } from './trackDrag';

export interface DeckDropPolicy {
  /** Load through the view's normal path (which re-applies its own refusals). */
  load: (deck: ChannelId, track: Track) => void;
  /** True while a Load onto this deck would be refused (checked live on hover). */
  isRefused?: (deck: ChannelId) => boolean;
  /** Surface the refusal (e.g. flash the deck's lock hint). */
  onRefused?: (deck: ChannelId) => void;
}

export const DeckDropContext = createContext<DeckDropPolicy | null>(null);

export type DeckDropState = 'ok' | 'refused' | null;

/** The drag's primary track id (first in drag order), or null. */
export function primaryDraggedTrackId(dt: DataTransfer): number | null {
  const ids = readTrackDragPayload(dt);
  return ids.length > 0 ? ids[0] : null;
}

export interface DeckDropHandlers {
  onDragEnter: (e: DragEvent) => void;
  onDragOver: (e: DragEvent) => void;
  onDragLeave: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
}

/**
 * Drop-target wiring for one Deck surface. `policy` defaults to the nearest
 * DeckDropContext; with neither, handlers are inert and state stays null.
 */
export function useDeckDropTarget(
  deck: ChannelId,
  policyOverride?: DeckDropPolicy | null
): { dropState: DeckDropState; dropHandlers: DeckDropHandlers } {
  const ctxPolicy = useContext(DeckDropContext);
  const policy = policyOverride ?? ctxPolicy;
  const [dropState, setDropState] = useState<DeckDropState>(null);

  // A cancelled drag (Esc / dropped elsewhere) may skip dragleave here.
  useEffect(() => {
    if (dropState === null) return;
    const clear = () => setDropState(null);
    window.addEventListener('dragend', clear);
    window.addEventListener('drop', clear);
    return () => {
      window.removeEventListener('dragend', clear);
      window.removeEventListener('drop', clear);
    };
  }, [dropState]);

  const accept = useCallback(
    (e: DragEvent, entering: boolean) => {
      if (!policy || !isTrackDrag(e.dataTransfer)) return;
      e.preventDefault();
      const refused = policy.isRefused?.(deck) ?? false;
      e.dataTransfer.dropEffect = refused ? 'none' : 'copy';
      setDropState(refused ? 'refused' : 'ok');
      if (refused && entering) policy.onRefused?.(deck);
    },
    [policy, deck]
  );

  const onDragEnter = useCallback((e: DragEvent) => accept(e, true), [accept]);
  const onDragOver = useCallback((e: DragEvent) => accept(e, false), [accept]);

  const onDragLeave = useCallback((e: DragEvent) => {
    const next = e.relatedTarget;
    if (next instanceof Node && e.currentTarget.contains(next)) return;
    setDropState(null);
  }, []);

  const onDrop = useCallback(
    (e: DragEvent) => {
      if (!policy || !isTrackDrag(e.dataTransfer)) return;
      e.preventDefault();
      // Don't let an enclosing drop target (e.g. a pane) also claim it.
      e.stopPropagation();
      setDropState(null);
      if (policy.isRefused?.(deck)) {
        policy.onRefused?.(deck);
        return;
      }
      const id = primaryDraggedTrackId(e.dataTransfer);
      if (id === null) return;
      api.tracks
        .getById(id)
        .then((track: Track) => policy.load(deck, track))
        .catch((err) => console.error('drag-load: failed to fetch track', id, err));
    },
    [policy, deck]
  );

  return { dropState, dropHandlers: { onDragEnter, onDragOver, onDragLeave, onDrop } };
}

