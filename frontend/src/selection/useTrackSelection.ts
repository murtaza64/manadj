/**
 * Selection machinery for one track table pane (playlist-editing 05).
 *
 * Wraps the pure selection model with React state: anchor Track caching
 * (so the anchor can stay visible after leaving the active filter, e.g.
 * the Unprocessed flow), pruning on list changes, click/keyboard handlers,
 * and an identity-stable drag-payload getter. The split edit view mounts
 * one instance per pane.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Track } from '../types';
import { scrollTrackIntoView } from '../hooks/useKeyboardShortcuts';
import type { SelectMods } from '../components/TrackRow';
import {
  EMPTY_SELECTION,
  click,
  navigate as navigateSelection,
  prune,
  rangeClick,
  selectAll,
  toggleClick,
  type Selection,
} from './selectionModel';

export interface TrackSelection {
  /** The tracks to display — input order, with the anchor spliced back in
   * when keepAnchorVisible is set and it left the list. */
  tracks: Track[];
  selection: Selection;
  setSelection: React.Dispatch<React.SetStateAction<Selection>>;
  /** Membership set for row highlighting. */
  selectedIds: ReadonlySet<number>;
  /** The anchor's Track object (load/edit target). */
  selectedTrack: Track | null;
  handleRowSelect: (track: Track, mods: SelectMods) => void;
  handleNavigate: (delta: 1 | -1) => void;
  handleSelectAll: () => void;
  /** Drag payload for a row: the whole selection when the row is in it. */
  getDragIds: (trackId: number) => number[];
}

export function useTrackSelection(
  inputTracks: Track[],
  options: { keepAnchorVisible?: boolean } = {}
): TrackSelection {
  const { keepAnchorVisible = false } = options;
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);
  const [anchorTrackCache, setAnchorTrackCache] = useState<Track | null>(null);
  const [anchorPosition, setAnchorPosition] = useState<number | null>(null);

  // The anchor's Track object: from the visible list, falling back to the
  // cached copy (so it survives leaving the active filter).
  const selectedTrack =
    inputTracks.find((t) => t.id === selection.anchorId) ??
    (anchorTrackCache && anchorTrackCache.id === selection.anchorId ? anchorTrackCache : null);

  // Keep the anchor in the list at its last-known position even if it no
  // longer matches the filter (e.g., in Unprocessed view after tagging).
  let tracks = inputTracks;
  if (
    keepAnchorVisible &&
    selectedTrack &&
    !inputTracks.some((t) => t.id === selectedTrack.id) &&
    anchorPosition !== null
  ) {
    tracks = [...inputTracks];
    tracks.splice(Math.min(anchorPosition, tracks.length), 0, selectedTrack);
  }

  const displayedIds = tracks.map((t) => t.id);
  const displayedIdsKey = displayedIds.join(',');

  // Cache the anchor's Track object (and position) while it is visible.
  useEffect(() => {
    if (selection.anchorId === null) {
      setAnchorTrackCache(null);
      setAnchorPosition(null);
      return;
    }
    const index = tracks.findIndex((t) => t.id === selection.anchorId);
    if (index !== -1) {
      setAnchorTrackCache(tracks[index]);
      setAnchorPosition(index);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection.anchorId, displayedIdsKey]);

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
    setSelection((prev) =>
      mods.shift
        ? rangeClick(prev, track.id, displayedIdsRef.current)
        : mods.toggle
          ? toggleClick(prev, track.id)
          : click(prev, track.id)
    );
  }, []);

  const handleNavigate = useCallback((delta: 1 | -1) => {
    const next = navigateSelection(selectionRef.current, delta, displayedIdsRef.current);
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
    tracks,
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
