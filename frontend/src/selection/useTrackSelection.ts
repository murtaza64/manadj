/**
 * Selection machinery for one track table pane (playlist-editing 05).
 *
 * Wraps the pure selection model with React state: pruning on list
 * changes, click/keyboard handlers, and an identity-stable drag-payload
 * getter. The split edit view mounts one instance per pane.
 *
 * Selection is browse-only: rows that leave the visible list (filters,
 * sort, view switches, tagging away from Unprocessed) are simply dropped
 * from the selection. Editing targets the LOADED track (loaded-track
 * authority), so nothing needs to keep a selected row artificially
 * visible.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Track } from '../types';
import {
  scrollTrackIntoView,
  trackRowInView,
  visibleTrackIds,
} from '../hooks/useKeyboardShortcuts';
import type { SelectMods } from '../components/TrackRow';
import {
  click,
  EMPTY_SELECTION,
  navigate as navigateSelection,
  prune,
  reanchorId,
  selectAll,
  selectGesture,
  type Selection,
} from './selectionModel';

export interface TrackSelection {
  selection: Selection;
  setSelection: React.Dispatch<React.SetStateAction<Selection>>;
  /** Membership set for row highlighting. */
  selectedIds: ReadonlySet<number>;
  /** The anchor's Track object (load/edit target); null when off-list. */
  selectedTrack: Track | null;
  handleRowSelect: (track: Track, mods: SelectMods) => void;
  handleNavigate: (delta: 1 | -1) => void;
  handleSelectAll: () => void;
  /** Drag payload for a row: the whole selection when the row is in it. */
  getDragIds: (trackId: number) => number[];
}

export function useTrackSelection(tracks: Track[]): TrackSelection {
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);

  const selectedTrack = tracks.find((t) => t.id === selection.anchorId) ?? null;

  const displayedIds = tracks.map((t) => t.id);
  const displayedIdsKey = displayedIds.join(',');

  // Reconcile the selection when the visible list changes (filters, sort,
  // view switches): selected rows that vanished are dropped.
  useEffect(() => {
    setSelection((prev) => prune(prev, displayedIds));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayedIdsKey]);

  // ALL handlers are ref-backed and identity-stable: they end up as props
  // on hundreds of memoized rows, so a fresh closure per render would
  // defeat the memo and re-render the whole table on every interaction.
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const displayedIdsRef = useRef(displayedIds);
  displayedIdsRef.current = displayedIds;

  const handleRowSelect = useCallback((track: Track, mods: SelectMods) => {
    setSelection((prev) => selectGesture(prev, track.id, mods, displayedIdsRef.current));
  }, []);

  const handleNavigate = useCallback((delta: 1 | -1) => {
    const sel = selectionRef.current;
    // Re-anchor when the anchor row isn't on screen (a filter changed the
    // rows underneath, or the user scrolled away): the first tick selects
    // the row at the viewport edge in the direction of travel instead of
    // jumping the list back to the stale position (midi-controller 16).
    if (sel.anchorId === null || !trackRowInView(sel.anchorId)) {
      const id = reanchorId(displayedIdsRef.current, visibleTrackIds(), delta);
      if (id !== null) {
        scrollTrackIntoView(id);
        setSelection(click(sel, id));
        return;
      }
    }
    const next = navigateSelection(sel, delta, displayedIdsRef.current);
    if (next.anchorId !== null) scrollTrackIntoView(next.anchorId);
    setSelection(next);
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelection((prev) => selectAll(prev, displayedIdsRef.current));
  }, []);

  const getDragIds = useCallback((trackId: number) => {
    const sel = selectionRef.current;
    return sel.ids.includes(trackId) ? [...sel.ids] : [trackId];
  }, []);

  const selectedIds = useMemo(() => new Set(selection.ids), [selection.ids]);

  return {
    selection,
    setSelection,
    selectedIds,
    selectedTrack,
    handleRowSelect,
    handleNavigate,
    handleSelectAll,
    getDragIds,
  };
}
