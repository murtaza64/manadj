import { useState, useRef, useEffect, useImperativeHandle, useMemo, useCallback } from 'react';
import type { Ref } from 'react';
import { useQueries, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import TrackList from './TrackList';
import FilterBar from './FilterBar';
import TagEditor, { type TagEditorHandle } from './TagEditor';
import Player from './Player';
import PlaylistSidebar, { type ViewType } from './PlaylistSidebar';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { useSetBeatgridDownbeat, useNudgeBeatgrid } from '../hooks/useBeatgridData';
import { useHotCueActions } from '../hooks/useHotCueActions';
import { registerBrowseSurface } from '../midi/controlRegistry';
import type { PaginatedTracks, Track } from '../types';
import type { ChannelId } from '../playback/mixer';
import { useFilters } from '../contexts/FilterContext';
import { useDeck, useDeckReady, useDecks } from '../hooks/useDeck';
import { transitionsFrom, useTransitionIndex } from '../editor/transitionIndex';
import { candidateIdSet, deriveFollowQuery, followedReferences, orderByTier } from '../follow/model';
import type { FollowReference } from '../follow/model';
import { useFollowFlags } from '../follow/followStore';
import { useFollowParams } from '../follow/paramsStore';
import { EMPTY_SELECTION, click } from '../selection/selectionModel';
import { useTrackSelection } from '../selection/useTrackSelection';
import {
  applyReorder,
  indicatorY,
  insertionIndexFromPointer,
  splitByMembership,
  type RowRect,
} from '../selection/dropIndex';
import { isTrackDrag, readTrackDragPayload, readTrackDragSource } from '../selection/trackDrag';
import ContextMenu, { useContextMenuState, type MenuItem } from './ContextMenu';
import { useToast } from './Toast';
import type { Playlist } from '../types';
import {
  PLAY_ORDER_SORT,
  isPlayOrderSort,
  nextPlaylistSort,
  sortPlaylistTracks,
  type PlaylistSort,
  type PlaylistSortColumn,
} from '../utils/trackSort';

/** Which selection instance a row menu acts on. */
type MenuPane = 'main' | 'editLibrary';

/** Stable empty list for the dormant edit-pane selection instance. */
const EMPTY_TRACKS: Track[] = [];

/**
 * The embedded library's browse surface, driven from outside (issue 04):
 * browseOnly mode does NOT mount the library keyboard hub — the Performance
 * view owns its keys outright and drives the table through this handle.
 */
export interface LibraryBrowseHandle {
  /** Move the selection up (-1) / down (+1), scrolling it into view. */
  navigate: (delta: 1 | -1) => void;
  getSelectedTrack: () => Track | null;
}

interface LibraryProps {
  /** Render only the browse surface (sidebar/filter/table) without the
   * Player/TagEditor block — used when a deck surface is shown elsewhere
   * (the Performance view embeds the library this way). Implies: the
   * library keyboard hub is not mounted (each view owns its hub). */
  browseOnly?: boolean;
  /** Per-row hover load-to-A/B buttons (Performance view). Double-click
   * also routes through this (deck A), so the view's load policy applies. */
  onLoadToDeck?: (deck: ChannelId, track: Track) => void;
  /** Selection access for the embedding view's keyboard hub. */
  browseRef?: Ref<LibraryBrowseHandle>;
}

export default function Library({
  browseOnly = false,
  onLoadToDeck,
  browseRef,
}: LibraryProps) {
  const [selectedView, setSelectedView] = useState<ViewType>('all');
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<number | null>(null);
  const [isEnergyEditMode, setIsEnergyEditMode] = useState(false);
  const queryClient = useQueryClient();
  const tagEditorRef = useRef<TagEditorHandle | null>(null);
  const { filters, setFilters } = useFilters();
  // The shared Deck: performance actions target the loaded Track, not the
  // selection. Narrow snapshot selector so transport events don't re-render
  // the (large) library tree.
  const { engine, loadedTrack, loadTrack } = useDeck();
  const deckReady = useDeckReady();
  const showToast = useToast();

  // Transition-library discovery (transition-library 02): per-row marks for
  // tracks with a saved Transition FROM either loaded deck, starred when
  // the pair is Preferred. Index rebuilds live on editor save events.
  const decks = useDecks();
  const transitionIndex = useTransitionIndex();
  const fromA = transitionsFrom(transitionIndex, decks.A.loadedTrack?.id);
  const fromB = transitionsFrom(transitionIndex, decks.B.loadedTrack?.id);

  // ── Follow mode (follow-mode 01) ───────────────────────────────────────
  // Follow composes BESIDE the manual filters: one candidates query per
  // followed reference (full conjunction per reference), unioned by id,
  // intersected with the manually-filtered list below. Never writes
  // FilterState — toggling Follow off restores the manual view exactly.
  // A Load onto a followed Deck changes the reference → new query keys →
  // the list updates hands-off. (Proven tier folds in via issue 03;
  // playback rules 02; tiered ordering 04; own parameters modal 05.)
  const followFlags = useFollowFlags();
  const followParams = useFollowParams();
  const followRefs = followedReferences(followFlags, {
    A: decks.A.loadedTrack,
    B: decks.B.loadedTrack,
  });
  const followQueries = useQueries({
    queries: followRefs.map(({ deck, reference }) => {
      const q = deriveFollowQuery(reference, followParams);
      return {
        queryKey: ['tracks', 'follow', deck, reference.id, q, selectedView === 'archived'],
        queryFn: (): Promise<PaginatedTracks> =>
          api.tracks.list(1, 1000, {
            tagIds: q.tagIds,
            energyMin: q.energyMin,
            energyMax: q.energyMax,
            tagMatchMode: q.tagMatchMode,
            bpmCenter: q.bpmCenter,
            bpmThresholdPercent: q.bpmThresholdPercent,
            keyCamelotIds: q.keyCamelotIds,
            archived: selectedView === 'archived' ? true : undefined,
          }),
        placeholderData: (previousData: unknown) => previousData,
      };
    }),
  });
  /** Candidate ids while following: both evidence tiers (follow-mode 03) —
   * heuristic query results unioned with the proven tier (saved
   * Transitions from each followed reference), or the proven tier alone
   * under provenOnly. Heuristic sets come from the reference queries that
   * have data: a still-loading second reference doesn't un-narrow the
   * already-followed list. Null (= no filtering) only when nothing is
   * followed, or when heuristics are wanted but none have resolved yet —
   * the manual list shows unfiltered rather than flashing empty. */
  const followProvenSets = followRefs.map(({ reference }) =>
    transitionsFrom(transitionIndex, reference.id)
  );
  const resolvedFollowQueries = followQueries.filter((q) => q.data !== undefined);
  const followCandidateIds = (() => {
    if (followRefs.length === 0) return null;
    if (!followParams.provenOnly && resolvedFollowQueries.length === 0) return null;
    return candidateIdSet(
      resolvedFollowQueries.map((q) => q.data!.items ?? []),
      followProvenSets,
      followParams.provenOnly
    );
  })();
  /** References for tier ordering (follow-mode 04), proven maps included. */
  const followReferences: FollowReference[] = followRefs.map(({ reference }, i) => ({
    track: reference,
    proven: followProvenSets[i],
  }));

  // Beatgrid mutation hooks
  const setDownbeat = useSetBeatgridDownbeat();
  const nudgeGrid = useNudgeBeatgrid();

  // ── Split view (playlist-editing 05) ───────────────────────────────────
  // The split stacks two panes: the playlist (Play order) on top, the full
  // library with its FilterBar below. Closed, the playlist view is exactly
  // the single-table layout (which still supports drag-reordering).
  const [isSplitViewOpen, setIsSplitViewOpen] = useState(false);
  const splitView =
    !browseOnly && selectedView === 'playlist' && selectedPlaylistId !== null && isSplitViewOpen;
  useEffect(() => {
    // Leaving the playlist (or the view) closes the split.
    setIsSplitViewOpen(false);
  }, [selectedView, selectedPlaylistId]);

  // Focus model: click focuses a pane; Tab switches; keyboard routes to it.
  const [focusedPane, setFocusedPane] = useState<'playlist' | 'library'>('playlist');
  useEffect(() => {
    setFocusedPane('playlist');
  }, [splitView]);

  // Fetch all tracks ('all'/'unprocessed' views, and the edit-mode library pane)
  const { data: allTracksData, isLoading: isLoadingAllTracks, error: allTracksError } = useQuery({
    queryKey: ['tracks', filters, selectedView],
    queryFn: () => api.tracks.list(1, 1000, {
      tagIds: filters.selectedTagIds,
      search: filters.search,
      energyMin: filters.energyMin,
      energyMax: filters.energyMax,
      tagMatchMode: filters.tagMatchMode,
      bpmCenter: filters.bpmCenter,
      bpmThresholdPercent: filters.bpmCenter !== null ? filters.bpmThresholdPercent : null,
      keyCamelotIds: filters.selectedKeyCamelotIds,
      unprocessed: selectedView === 'unprocessed' ? true : undefined,
      archived: selectedView === 'archived' ? true : undefined,
      sortColumn: filters.sortColumn,
      sortDirection: filters.sortDirection,
    }),
    enabled: selectedView !== 'playlist' || splitView,
    placeholderData: (previousData) => previousData,
  });

  // Fetch playlist tracks (when playlist view selected)
  const { data: playlistData, isLoading: isLoadingPlaylist, error: playlistError } = useQuery({
    queryKey: ['playlist', selectedPlaylistId],
    queryFn: () => api.playlists.get(selectedPlaylistId!),
    enabled: selectedView === 'playlist' && selectedPlaylistId !== null,
    placeholderData: (previousData) => previousData,
  });

  // Playlist-view sort (playlist-editing 04): client-side and view-only —
  // it never rewrites Play order. Default (and reset on playlist switch)
  // is the # column ascending, i.e. Play order itself.
  const [playlistSort, setPlaylistSort] = useState<PlaylistSort>(PLAY_ORDER_SORT);
  useEffect(() => {
    setPlaylistSort(PLAY_ORDER_SORT);
  }, [selectedPlaylistId]);

  /** Play order by track id (from the API's position-ordered response). */
  const playOrder = useMemo(() => {
    if (selectedView !== 'playlist') return undefined;
    return new Map<number, number>(
      (playlistData?.tracks ?? []).map((t: Track, i: number) => [t.id, i])
    );
  }, [selectedView, playlistData]);

  // Playlists for the "Add to playlist ▸" submenu (shares the sidebar's cache).
  const { data: playlists = [] } = useQuery({
    queryKey: ['playlists'],
    queryFn: api.playlists.list,
  });

  // Add tracks to playlist mutation (sequential appends, selection order).
  // Duplicates are idempotent no-ops server-side (entry identity); skips
  // are reported with a toast.
  const addToPlaylistMutation = useMutation({
    mutationFn: async ({ playlistId, trackIds }: { playlistId: number; trackIds: number[] }) => {
      let skipped = 0;
      for (const trackId of trackIds) {
        const result = await api.playlists.addTrack(playlistId, { track_id: trackId });
        if (result.skipped) skipped += 1;
      }
      return { skipped, total: trackIds.length };
    },
    onSuccess: ({ skipped }) => {
      queryClient.invalidateQueries({ queryKey: ['playlist'] });
      if (skipped > 0) {
        showToast(skipped === 1 ? '1 track already in playlist' : `${skipped} tracks already in playlist`);
      }
    },
  });

  // Loaded-track authority (issue 23): the editor panel (tags, energy,
  // title/artist, BPM, key) edits the LOADED track — selection is for
  // browsing and Load only. Fresh copy via query so edits reflect in the
  // panel without mutating the deck's own loaded-track snapshot.
  const { data: freshLoadedTrack } = useQuery({
    queryKey: ['track', loadedTrack?.id],
    queryFn: () => api.tracks.get(loadedTrack!.id),
    enabled: loadedTrack !== null,
  });
  const editorTrack =
    loadedTrack && freshLoadedTrack?.id === loadedTrack.id ? freshLoadedTrack : loadedTrack;

  const mutation = useMutation({
    mutationFn: (data: { energy?: number; tag_ids?: number[]; bpm?: number; key?: number }) => {
      if (!loadedTrack) return Promise.reject(new Error('no loaded track'));
      return api.tracks.update(loadedTrack.id, data);
    },
    onSuccess: async () => {
      // Refetch queries and wait for them to complete
      await queryClient.refetchQueries({ queryKey: ['tracks'] });
      await queryClient.refetchQueries({ queryKey: ['playlist'] });
      // Invalidate tags to update track counts
      await queryClient.invalidateQueries({ queryKey: ['tags'] });
      // Refresh the editor panel's copy of the loaded track
      await queryClient.invalidateQueries({ queryKey: ['track'] });
    },
  });

  // Positioned inserts (drop with insertion line): sequential adds keep
  // the payload's selection order; duplicates were split out client-side.
  const insertToPlaylistMutation = useMutation({
    mutationFn: async ({
      playlistId,
      trackIds,
      position,
    }: {
      playlistId: number;
      trackIds: number[];
      position: number | null;
    }) => {
      for (let i = 0; i < trackIds.length; i++) {
        await api.playlists.addTrack(playlistId, {
          track_id: trackIds[i],
          ...(position !== null ? { position: position + i } : {}),
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['playlist'] });
    },
  });

  // Reorder (drag within the playlist pane): sends the full permutation.
  const reorderPlaylistMutation = useMutation({
    mutationFn: ({ playlistId, order }: { playlistId: number; order: number[] }) =>
      api.playlists.reorderTracks(
        playlistId,
        order.map((track_id, position) => ({ track_id, position }))
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['playlist'] });
    },
    onError: () => {
      // e.g. the playlist changed under us (stale permutation → 400)
      showToast('Reorder failed — playlist refreshed');
      queryClient.invalidateQueries({ queryKey: ['playlist'] });
    },
  });

  // Remove tracks from the viewed playlist (keyed by track id — entry
  // identity). No confirmation: re-adding is cheap.
  const removeFromPlaylistMutation = useMutation({
    mutationFn: async ({ playlistId, trackIds }: { playlistId: number; trackIds: number[] }) => {
      for (const trackId of trackIds) {
        await api.playlists.removeTrack(playlistId, trackId);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['playlist'] });
    },
  });

  const handleTrackDrop = (playlistId: number, trackIds: number[]) => {
    addToPlaylistMutation.mutate({ playlistId, trackIds });
  };

  // ── Archive / Unarchive (track-archival 01) ────────────────────────────
  // Archived (CONTEXT.md): curation verdict — removes from all playlists;
  // record/file persist. Confirm only when playlist entries are affected.
  const archiveMutation = useMutation({
    mutationFn: async (trackIds: number[]) => {
      for (const id of trackIds) {
        await api.tracks.archive(id);
      }
      return trackIds.length;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ['tracks'] });
      queryClient.invalidateQueries({ queryKey: ['playlist'] });
      showToast(count === 1 ? 'Track archived' : `${count} tracks archived`);
    },
  });

  const unarchiveMutation = useMutation({
    mutationFn: async (trackIds: number[]) => {
      for (const id of trackIds) {
        await api.tracks.unarchive(id);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tracks'] });
    },
  });

  const archiveTracks = async (trackIds: number[]) => {
    const memberships = (
      await Promise.all(trackIds.map((id) => api.tracks.getPlaylists(id)))
    ).reduce((n, playlists) => n + playlists.length, 0);
    const what = trackIds.length === 1 ? 'this track' : `${trackIds.length} tracks`;
    if (
      memberships > 0 &&
      !confirm(
        `Archive ${what}? Also removes ${memberships} playlist ${memberships === 1 ? 'entry' : 'entries'} (not restored on unarchive).`
      )
    ) {
      return;
    }
    archiveMutation.mutate(trackIds);
  };

  const handleFieldUpdate = async (trackId: number, field: 'title' | 'artist', value: string) => {
    try {
      // Optimistic update of the editor panel's loaded-track copy
      queryClient.setQueryData(['track', trackId], (prev: Track | undefined) =>
        prev ? { ...prev, [field]: value } : prev
      );

      await api.tracks.update(trackId, { [field]: value });
      await queryClient.invalidateQueries({ queryKey: ['track', trackId] });
      await queryClient.invalidateQueries({ queryKey: ['tracks'] });
      await queryClient.invalidateQueries({ queryKey: ['playlist'] });
    } catch (error) {
      console.error('Failed to update track:', error);
      // Revert optimistic update on error by refetching
      queryClient.invalidateQueries({ queryKey: ['track', trackId] });
      queryClient.invalidateQueries({ queryKey: ['tracks'] });
      queryClient.invalidateQueries({ queryKey: ['playlist'] });
    }
  };

  /** Sort for library tables (server-side, via FilterContext). */
  const handleSortLibrary = (column: PlaylistSortColumn) => {
    if (column === 'position') return; // # exists only in playlist tables
    setFilters(prev => {
      // Toggle direction if same column, otherwise default to desc
      const newDirection = prev.sortColumn === column && prev.sortDirection === 'desc'
        ? 'asc'
        : 'desc';

      return {
        ...prev,
        sortColumn: column,
        sortDirection: newDirection
      };
    });
  };

  const handleSort = (column: PlaylistSortColumn) => {
    // Playlist table: local, view-only sort (Play order untouched).
    if (selectedView === 'playlist') {
      setPlaylistSort((prev) => nextPlaylistSort(prev, column));
      return;
    }
    handleSortLibrary(column);
  };

  // Beatgrid edits are playhead-dependent, so they act on the loaded Track
  const handleNudgeBeatgrid = (offsetMs: number) => {
    if (!loadedTrack || !deckReady) return;
    nudgeGrid.mutate({ trackId: loadedTrack.id, offsetMs });
  };

  const handleSetDownbeat = () => {
    if (!loadedTrack || !deckReady) return;
    setDownbeat.mutate({
      trackId: loadedTrack.id,
      downbeatTime: engine.getPlayhead(),
    });
  };

  // ── Track lists per pane ───────────────────────────────────────────────
  // Library list ('all'/'unprocessed' views and the edit-mode library pane),
  // with the Follow candidate set composed client-side (follow-mode 01/03).
  let libraryTracks = allTracksData?.items || [];
  if (followCandidateIds) {
    // Filter to candidates, then tier-order them (follow-mode 04): the
    // stable sort keeps the server sort within each tier.
    libraryTracks = orderByTier(
      libraryTracks.filter((t: Track) => followCandidateIds.has(t.id)),
      followReferences
    );
  }

  // Playlist list, in the view-only playlist sort. The Follow filter
  // applies only outside edit mode — in the split, the FilterBar belongs
  // to the library pane.
  let playlistTracks = sortPlaylistTracks(playlistData?.tracks || [], playlistSort);
  if (followCandidateIds && !splitView) {
    playlistTracks = orderByTier(
      playlistTracks.filter((t: Track) => followCandidateIds.has(t.id)),
      followReferences
    );
  }

  // ── Selection machinery: one instance per pane ─────────────────────────
  // 'main' is the single always-present table (playlist or library,
  // depending on the view; the top pane in the split). 'editLibrary' only
  // exists while editing.
  const currentTracks = selectedView === 'playlist' ? playlistTracks : libraryTracks;
  const mainSel = useTrackSelection(currentTracks);
  const editLibSel = useTrackSelection(splitView ? libraryTracks : EMPTY_TRACKS);

  /** The pane keyboard input acts on. */
  const activeSel = splitView && focusedPane === 'library' ? editLibSel : mainSel;
  const selectedTrack = activeSel.selectedTrack;

  // Switching views/playlists clears the main selection outright (prune
  // would do most of it; this also covers same-id coincidences).
  const resetMainSelection = mainSel.setSelection;
  useEffect(() => {
    resetMainSelection(EMPTY_SELECTION);
  }, [selectedView, selectedPlaylistId, resetMainSelection]);

  const isLoading = selectedView === 'playlist' ? isLoadingPlaylist : isLoadingAllTracks;
  const error = selectedView === 'playlist' ? playlistError : allTracksError;

  // Delete/Backspace and the context-menu Remove item (playlist views only;
  // in the split, only the playlist pane removes).
  const canRemoveFromPlaylist = selectedView === 'playlist' && selectedPlaylistId !== null;
  const removeTracksFromViewedPlaylist = (trackIds: number[]) => {
    if (!canRemoveFromPlaylist || trackIds.length === 0) return;
    removeFromPlaylistMutation.mutate({ playlistId: selectedPlaylistId!, trackIds });
  };
  const handleRemoveSelected = () => removeTracksFromViewedPlaylist([...mainSel.selection.ids]);
  const removeEnabled = canRemoveFromPlaylist && (!splitView || focusedPane === 'playlist');

  // ── Playlist-pane drag & drop (playlist-editing 06) ────────────────────
  // Positional drops only when the pane shows actual Play order; under any
  // other sort the drop appends (and in-pane reorders are refused).
  const playlistPaneRef = useRef<HTMLDivElement>(null);
  const [dropIndicator, setDropIndicator] = useState<{ index: number; y: number } | null>(null);
  const canPositionDrops = isPlayOrderSort(playlistSort);
  const playlistMemberIds = useMemo(
    () => new Set<number>((playlistData?.tracks ?? []).map((t: Track) => t.id)),
    [playlistData]
  );

  /** Row rectangles in the pane's content coordinates (scroll included). */
  const paneRowRects = (pane: HTMLDivElement): RowRect[] => {
    const paneRect = pane.getBoundingClientRect();
    return Array.from(pane.querySelectorAll('tbody tr[data-track-id]')).map((row) => {
      const r = (row as HTMLElement).getBoundingClientRect();
      return { top: r.top - paneRect.top + pane.scrollTop, height: r.height };
    });
  };

  const handlePlaylistPaneDragOver = (e: React.DragEvent) => {
    if (!isTrackDrag(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const pane = playlistPaneRef.current;
    if (!pane) return;
    const rects = paneRowRects(pane);
    const pointerY = e.clientY - pane.getBoundingClientRect().top + pane.scrollTop;
    const index = canPositionDrops ? insertionIndexFromPointer(pointerY, rects) : rects.length;
    setDropIndicator({ index, y: indicatorY(index, rects) });
  };

  const handlePlaylistPaneDragLeave = (e: React.DragEvent) => {
    if (!playlistPaneRef.current?.contains(e.relatedTarget as Node)) {
      setDropIndicator(null);
    }
  };

  const handlePlaylistPaneDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const indicator = dropIndicator;
    setDropIndicator(null);
    if (selectedPlaylistId === null) return;
    const droppedIds = readTrackDragPayload(e.dataTransfer);
    if (droppedIds.length === 0) return;

    const { newIds, presentIds } = splitByMembership(droppedIds, playlistMemberIds);

    // Reorders are source-based: only drags that STARTED in the playlist
    // pane move tracks. A fully-present drop from the library pane is a
    // no-op with a toast (PRD: adding a present track never moves it).
    if (readTrackDragSource(e.dataTransfer) === 'playlist-pane') {
      if (!canPositionDrops) {
        showToast('Sort by # to reorder');
        return;
      }
      const orderIds = (playlistData?.tracks ?? []).map((t: Track) => t.id);
      const newOrder = applyReorder(orderIds, presentIds, indicator?.index ?? orderIds.length);
      if (newOrder.join(',') !== orderIds.join(',')) {
        reorderPlaylistMutation.mutate({ playlistId: selectedPlaylistId, order: newOrder });
      }
      return;
    }

    if (newIds.length === 0) {
      if (presentIds.length > 0) {
        showToast(
          presentIds.length === 1
            ? '1 track already in playlist'
            : `${presentIds.length} tracks already in playlist`
        );
      }
      return;
    }

    // Cross-pane add: insert the new tracks at the indicated position
    // (append under a non-# sort); skip and report the already-present.
    insertToPlaylistMutation.mutate({
      playlistId: selectedPlaylistId,
      trackIds: newIds,
      position: canPositionDrops ? (indicator?.index ?? null) : null,
    });
    if (presentIds.length > 0) {
      showToast(
        presentIds.length === 1
          ? '1 track already in playlist'
          : `${presentIds.length} tracks already in playlist`
      );
    }
  };

  // ── Track-row context menu (playlist-editing 03) ───────────────────────
  const { menu: rowMenu, openMenu: openRowMenu, closeMenu: closeRowMenu } =
    useContextMenuState<{ track: Track; pane: MenuPane }>();

  const selForPane = (pane: MenuPane) => (pane === 'editLibrary' ? editLibSel : mainSel);

  // Ref-backed + stable per pane: these land on every memoized row.
  const menuDepsRef = useRef({ mainSel, editLibSel, splitView });
  menuDepsRef.current = { mainSel, editLibSel, splitView };

  const rowContextMenu = useCallback(
    (pane: MenuPane, track: Track, pos: { x: number; y: number }) => {
      const deps = menuDepsRef.current;
      const sel = pane === 'editLibrary' ? deps.editLibSel : deps.mainSel;
      // Standard behavior: right-clicking outside the selection selects the row.
      if (!sel.selection.ids.includes(track.id)) {
        sel.setSelection(click(sel.selection, track.id));
      }
      if (deps.splitView) setFocusedPane(pane === 'editLibrary' ? 'library' : 'playlist');
      openRowMenu(pos.x, pos.y, { track, pane });
    },
    [openRowMenu]
  );
  const handleRowContextMenuMain = useCallback(
    (track: Track, pos: { x: number; y: number }) => rowContextMenu('main', track, pos),
    [rowContextMenu]
  );
  const handleRowContextMenuEditLib = useCallback(
    (track: Track, pos: { x: number; y: number }) => rowContextMenu('editLibrary', track, pos),
    [rowContextMenu]
  );

  /** The view's load policy (editor-midi 03): the embedding view's when
   * present (editor assign-to-pair, Performance lock), else the library's
   * free replace straight onto the shared Decks. Menu items and hardware
   * LOAD route through the same policy. */
  const loadWithViewPolicy = (deck: ChannelId, track: Track) => {
    if (onLoadToDeck) onLoadToDeck(deck, track);
    else decks[deck].loadTrack(track);
  };
  const loadWithViewPolicyRef = useRef(loadWithViewPolicy);
  useEffect(() => {
    loadWithViewPolicyRef.current = loadWithViewPolicy;
  });

  const rowMenuItems: MenuItem[] = useMemo(() => {
    if (!rowMenu) return [];
    const { track: menuTrack, pane } = rowMenu.context;
    const paneSelection = selForPane(pane).selection;
    const targetIds = paneSelection.ids.includes(menuTrack.id) ? [...paneSelection.ids] : [menuTrack.id];
    const multi = targetIds.length > 1;
    const loadDisabledTitle = multi ? 'Load acts on a single track' : undefined;
    return [
      {
        label: 'Load to Deck A',
        disabled: multi,
        title: loadDisabledTitle,
        onSelect: () => loadWithViewPolicy('A', menuTrack),
      },
      {
        label: 'Load to Deck B',
        disabled: multi,
        title: loadDisabledTitle,
        onSelect: () => loadWithViewPolicy('B', menuTrack),
      },
      {
        label: multi ? `Add ${targetIds.length} to playlist` : 'Add to playlist',
        separatorBefore: true,
        disabled: playlists.length === 0,
        title: playlists.length === 0 ? 'No playlists yet' : undefined,
        submenu: playlists.map((p: Playlist) => ({
          label: p.name,
          onSelect: () => addToPlaylistMutation.mutate({ playlistId: p.id, trackIds: targetIds }),
        })),
      },
      ...(canRemoveFromPlaylist && pane === 'main'
        ? [
            {
              label: multi ? `Remove ${targetIds.length} from playlist` : 'Remove from playlist',
              danger: true,
              onSelect: () => removeTracksFromViewedPlaylist(targetIds),
            } satisfies MenuItem,
          ]
        : []),
      // Archived (CONTEXT.md): verdict in normal views; reversal in the
      // Archived view (which also keeps Load/Add for auditioning).
      selectedView === 'archived'
        ? ({
            label: multi ? `Unarchive ${targetIds.length} tracks` : 'Unarchive',
            separatorBefore: true,
            onSelect: () => unarchiveMutation.mutate(targetIds),
          } satisfies MenuItem)
        : ({
            label: multi ? `Archive ${targetIds.length} tracks` : 'Archive track',
            danger: true,
            separatorBefore: true,
            onSelect: () => void archiveTracks(targetIds),
          } satisfies MenuItem),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowMenu, mainSel.selection.ids, editLibSel.selection.ids, playlists, canRemoveFromPlaylist, selectedPlaylistId, selectedView]);

  const totalTracks = selectedView === 'playlist'
    ? playlistData?.tracks?.length || 0
    : allTracksData?.library_total || 0;

  // Embedded, double-click routes through the view's load policy (deck A)
  // instead of loading directly. Memoized — the rows are.
  const loadForTable = useMemo(
    () =>
      browseOnly && onLoadToDeck
        ? (t: Track) => onLoadToDeck('A', t)
        : loadTrack,
    [browseOnly, onLoadToDeck, loadTrack]
  );

  // Selection access for an embedding view's own keyboard hub (issue 04).
  useImperativeHandle(
    browseRef,
    () => ({
      navigate: mainSel.handleNavigate,
      getSelectedTrack: () => mainSel.selectedTrack,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mainSel]
  );

  // The same handle, registered module-level as the active browse surface
  // for the hardware Controller (midi-controller 05): encoder moves this
  // selection, LOAD A/B reads it and loads with the view's policy
  // (editor-midi 03). Registration is mount-scoped; handlers read the live
  // selection and policy through refs.
  const mainSelRef = useRef(mainSel);
  useEffect(() => {
    mainSelRef.current = mainSel;
  });
  useEffect(
    () =>
      registerBrowseSurface({
        navigate: (delta) => mainSelRef.current.handleNavigate(delta),
        getSelectedTrack: () => mainSelRef.current.selectedTrack,
        load: (deck, track) => loadWithViewPolicyRef.current(deck, track),
      }),
    []
  );

  return (
    <>
    {/* The library keyboard hub — only when this view owns the keyboard.
        Embedded (browseOnly), the Performance hub drives everything. */}
    {!browseOnly && (
      <LibraryHub
        selectedTrack={selectedTrack}
        onNavigate={activeSel.handleNavigate}
        onSelectAll={activeSel.handleSelectAll}
        onRemoveSelected={removeEnabled ? handleRemoveSelected : undefined}
        onSwitchPane={
          splitView
            ? () => setFocusedPane((p) => (p === 'playlist' ? 'library' : 'playlist'))
            : undefined
        }
        onLoadTrack={loadTrack}
        onNudgeBeatgrid={handleNudgeBeatgrid}
        onSetDownbeat={handleSetDownbeat}
        onEnterTagEditMode={() => tagEditorRef.current?.enterTagEditMode()}
        onEnterEnergyEditMode={() => tagEditorRef.current?.toggleEnergyEditMode()}
        isEnergyEditMode={isEnergyEditMode}
      />
    )}
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--mantle)'
    }}>
      {/* Waveform at top (full width), controls and editor below.
          Hidden in browseOnly mode (deck surface rendered by the host). */}
      {!browseOnly && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          borderBottom: '1px solid var(--surface0)'
        }}>
          <Player />
          <div style={{
            display: 'flex'
          }}>
            {/* Loaded-track authority (issue 23): the panel edits the
                loaded track; row selection only browses/loads. */}
            <TagEditor
              ref={tagEditorRef}
              track={editorTrack}
              onSave={(data) => mutation.mutateAsync(data)}
              onUpdate={handleFieldUpdate}
              onEnergyEditModeChange={setIsEnergyEditMode}
            />
          </div>
        </div>
      )}

      {/* Library section with sidebar */}
      <div style={{
        flex: 1,
        display: 'flex',
        overflow: 'hidden'
      }}>
        {/* Sidebar */}
        <PlaylistSidebar
          selectedView={selectedView}
          selectedPlaylistId={selectedPlaylistId}
          onSelectView={setSelectedView}
          onSelectPlaylist={(id) => {
            setSelectedView('playlist');
            setSelectedPlaylistId(id);
          }}
          onTrackDrop={handleTrackDrop}
        />

        {/* Main library area (filter + table; split panes when editing) */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}>
          {/* Playlist header strip: name + split-view toggle (playlist view only) */}
          {selectedView === 'playlist' && !browseOnly && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '4px 12px',
              borderBottom: '1px solid var(--surface0)',
              background: 'var(--crust)',
            }}>
              <span style={{ fontSize: '13px', color: 'var(--text)' }}>
                {playlistData?.name ?? 'Playlist'}
                <span style={{ color: 'var(--subtext0)', marginLeft: '8px' }}>
                  {playlistData?.tracks?.length ?? 0} tracks
                </span>
              </span>
              <button
                onClick={() => setIsSplitViewOpen((v) => !v)}
                style={{
                  padding: '2px 10px',
                  background: splitView ? 'var(--blue)' : 'var(--surface0)',
                  color: splitView ? 'var(--base)' : 'var(--text)',
                  border: '1px solid var(--surface1)',
                  borderRadius: '3px',
                  cursor: 'pointer',
                  fontSize: '12px',
                }}
              >
                Split view
              </button>
            </div>
          )}

          {splitView ? (
            <>
              {/* Playlist pane (Play order) */}
              <div
                ref={playlistPaneRef}
                onMouseDownCapture={() => setFocusedPane('playlist')}
                onDragOver={handlePlaylistPaneDragOver}
                onDragLeave={handlePlaylistPaneDragLeave}
                onDrop={handlePlaylistPaneDrop}
                style={{
                  position: 'relative',
                  flex: 1,
                  minHeight: 0,
                  overflow: 'auto',
                  outline: focusedPane === 'playlist' ? '1px solid var(--blue)' : '1px solid transparent',
                  outlineOffset: '-1px',
                }}
              >
                {dropIndicator && (
                  <div
                    style={{
                      position: 'absolute',
                      left: 0,
                      right: 0,
                      top: Math.max(0, dropIndicator.y - 1),
                      height: '2px',
                      background: 'var(--blue)',
                      pointerEvents: 'none',
                      zIndex: 10,
                    }}
                  />
                )}
                <TrackList
                  tracks={playlistTracks}
                  isLoading={isLoadingPlaylist}
                  error={playlistError}
                  selectedIds={mainSel.selectedIds}
                  onSelectTrack={mainSel.handleRowSelect}
                  getDragIds={mainSel.getDragIds}
                  onRowContextMenu={handleRowContextMenuMain}
                  playOrder={playOrder}
                  dragSource="playlist-pane"
                  onLoadTrack={loadForTable}
                  loadedTrackId={loadedTrack?.id ?? null}
                  onLoadToDeck={onLoadToDeck}
                  transitionMarksA={fromA}
                  transitionMarksB={fromB}
                  sortColumn={playlistSort.column}
                  sortDirection={playlistSort.direction}
                  onSort={handleSort}
                />
              </div>

              {/* Library pane (full FilterBar + table) */}
              <FilterBar
                totalTracks={allTracksData?.library_total || 0}
                filteredCount={libraryTracks.length}
                loadedA={decks.A.loadedTrack}
                loadedB={decks.B.loadedTrack}
              />
              <div
                onMouseDownCapture={() => setFocusedPane('library')}
                style={{
                  flex: 1,
                  minHeight: 0,
                  overflow: 'auto',
                  outline: focusedPane === 'library' ? '1px solid var(--blue)' : '1px solid transparent',
                  outlineOffset: '-1px',
                }}
              >
                <TrackList
                  tracks={libraryTracks}
                  isLoading={isLoadingAllTracks}
                  error={allTracksError}
                  selectedIds={editLibSel.selectedIds}
                  onSelectTrack={editLibSel.handleRowSelect}
                  getDragIds={editLibSel.getDragIds}
                  onRowContextMenu={handleRowContextMenuEditLib}
                  onLoadTrack={loadForTable}
                  loadedTrackId={loadedTrack?.id ?? null}
                  onLoadToDeck={onLoadToDeck}
                  transitionMarksA={fromA}
                  transitionMarksB={fromB}
                  sortColumn={filters.sortColumn}
                  sortDirection={filters.sortDirection}
                  onSort={handleSortLibrary}
                />
              </div>
            </>
          ) : (
            <>
              <FilterBar
                totalTracks={totalTracks}
                filteredCount={currentTracks.length}
                loadedA={decks.A.loadedTrack}
                loadedB={decks.B.loadedTrack}
              />

              {/* Track table. In playlist view it is the playlist pane:
                  drag-reordering works without opening the split. */}
              <div
                ref={selectedView === 'playlist' ? playlistPaneRef : undefined}
                onDragOver={selectedView === 'playlist' ? handlePlaylistPaneDragOver : undefined}
                onDragLeave={selectedView === 'playlist' ? handlePlaylistPaneDragLeave : undefined}
                onDrop={selectedView === 'playlist' ? handlePlaylistPaneDrop : undefined}
                style={{
                  position: 'relative',
                  flex: 1,
                  overflow: 'auto'
                }}
              >
                {selectedView === 'playlist' && dropIndicator && (
                  <div
                    style={{
                      position: 'absolute',
                      left: 0,
                      right: 0,
                      top: Math.max(0, dropIndicator.y - 1),
                      height: '2px',
                      background: 'var(--blue)',
                      pointerEvents: 'none',
                      zIndex: 10,
                    }}
                  />
                )}
                <TrackList
                  tracks={currentTracks}
                  isLoading={isLoading}
                  error={error}
                  selectedIds={mainSel.selectedIds}
                  onSelectTrack={mainSel.handleRowSelect}
                  getDragIds={mainSel.getDragIds}
                  onRowContextMenu={handleRowContextMenuMain}
                  playOrder={playOrder}
                  dragSource={selectedView === 'playlist' ? 'playlist-pane' : 'library'}
                  onLoadTrack={loadForTable}
                  loadedTrackId={loadedTrack?.id ?? null}
                  onLoadToDeck={onLoadToDeck}
                  transitionMarksA={fromA}
                  transitionMarksB={fromB}
                  sortColumn={selectedView === 'playlist' ? playlistSort.column : filters.sortColumn}
                  sortDirection={selectedView === 'playlist' ? playlistSort.direction : filters.sortDirection}
                  onSort={handleSort}
                />
              </div>
            </>
          )}
        </div>
      </div>

      {rowMenu && (
        <ContextMenu x={rowMenu.x} y={rowMenu.y} items={rowMenuItems} onClose={closeRowMenu} />
      )}
    </div>
    </>
  );
}

/**
 * The library keyboard hub as a mountable unit: hooks can't be called
 * conditionally, but a component can be conditionally rendered. Also owns
 * the hub's hot-cue wiring (deck-scoped, for the loaded Track — the same
 * implementation the Player's pads use).
 */
function LibraryHub({
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
  isEnergyEditMode,
}: {
  selectedTrack: Track | null;
  onNavigate: (delta: 1 | -1) => void;
  onSelectAll: () => void;
  onRemoveSelected?: () => void;
  onSwitchPane?: () => void;
  onLoadTrack: (track: Track) => void;
  onNudgeBeatgrid: (offsetMs: number) => void;
  onSetDownbeat: () => void;
  onEnterTagEditMode: () => void;
  onEnterEnergyEditMode: () => void;
  isEnergyEditMode: boolean;
}) {
  const { loadedTrack } = useDeck();
  const hotCueActions = useHotCueActions(loadedTrack?.id ?? null);

  useKeyboardShortcuts({
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
    onHotCueDown: hotCueActions.down,
    onHotCueUp: hotCueActions.up,
    onHotCueDelete: hotCueActions.remove,
    isEnergyEditMode,
  });

  return null;
}
