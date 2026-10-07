import {
  useState,
  useRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useCallback,
  useSyncExternalStore,
} from 'react';
import type { ReactNode, Ref } from 'react';
import { BrowseActiveContext, useBrowseActive } from '../contexts/browseActive';
import { useViewActive } from '../contexts/viewActive';
import { DRAG_POINTER_STALE_MS, dragEdgeScrollDelta } from './dragScroll';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import TrackList from './TrackList';
import FilterBar, { type FilterBarHandle } from './FilterBar';
import TagEditor, { type TagEditorHandle } from './TagEditor';
import Player from './Player';
import PlaylistSidebar, { type ViewType } from './PlaylistSidebar';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import {
  BROWSE_PAGE_ROWS,
  browseAreas,
  cursorEnd,
  entryKey,
  moveBrowseArea,
  moveCursor,
  selectionEntryKey,
  sidebarEntries,
  type BrowseArea,
  type SidebarEntry,
} from './browseNav';
import { browseSession, restoredView, updateBrowseSession } from './browseStore';
import { setLibrarySubview } from '../tour/tourState';
import { isSidebarSectionCollapsed, subscribeSidebarSections } from './sidebarSectionsStore';
import { useSetBeatgridDownbeat, useNudgeBeatgrid } from '../hooks/useBeatgridData';
import { useHotCueActions } from '../hooks/useHotCueActions';
import { registerBrowseSurface } from '../midi/controlRegistry';
import type { Track } from '../types';
import type { ChannelId } from '../playback/mixer';
import { useFilters } from '../contexts/FilterContext';
import { useDeck, useDecks, deckReadyNow } from '../hooks/useDeck';
import { transitionsFrom, useTransitionIndex } from '../editor/transitionIndex';
import { useLinks } from '../links/linkStore';
import { useRankedFollow } from '../follow/useRankedFollow';
import { FollowTemperatureControls } from '../follow/FollowTemperatureControls';
import { EMPTY_SELECTION, click, menuTargets } from '../selection/selectionModel';
import { useTrackSelection } from '../selection/useTrackSelection';
import {
  applyReorder,
  indicatorY,
  insertionIndexFromPointer,
  splitByMembership,
  type RowRect,
} from '../selection/dropIndex';
import { isTrackDrag, readTrackDragPayload, readTrackDragSource } from '../selection/trackDrag';
import { ROW_HEIGHT } from './virtualRows';
import ContextMenu, { useContextMenuState } from './ContextMenu';
import { useToast } from './Toast';
import { useAddTracksToPlaylist, useTrackMenuItems } from './useTrackMenuItems';
import SetDetailPane from '../sets/SetDetailPane';
import { getSelectedSetId, selectSet } from '../sets/setStore';
import {
  OPEN_SESSION_EVENT,
  getSelectedSessionUuid,
  selectSession,
} from '../sessions/openSession';
import { SessionTimelinePane } from '../sessions/SessionTimelinePane';
import { SessionsListView } from '../sessions/SessionsListView';
import { NAVIGATE_SET_EVENT } from '../sets/navigateToSet';
import { PlaylistFullExportModal } from './PlaylistFullExportModal';
import { useExportEnabled } from '../settings/useAppConfig';
import { PlaylistStatusBadge } from './PlaylistStatusBadge';
import { playlistStatus } from './playlistStatus';
import { trackMatchesFilters } from './playlistFilter';
import { togglePlaylistFilter, usePlaylistFilterEnabled } from './playlistFilterStore';
import { FunnelIcon } from './icons';
import {
  PLAY_ORDER_SORT,
  isPlayOrderSort,
  nextPlaylistSort,
  sortPlaylistTracks,
  type PlaylistSort,
  type PlaylistSortColumn,
} from '../utils/trackSort';
import FileDropOverlay from '../dropImport/FileDropOverlay';
import {
  useFileDropImport, useFileDropTarget, useSuppressStrayFileDrops,
} from '../dropImport/useFileDropImport';

/** Which selection instance a row menu acts on. */
type MenuPane = 'main' | 'editLibrary';

/** Stable empty list for the dormant edit-pane selection instance. */
const EMPTY_TRACKS: Track[] = [];

/**
 * The browse surface, driven from outside (issue 04): in browseOnly mode
 * the library keyboard hub is NOT mounted — the Performance view and the
 * Transition editor own their keys outright and drive the table through
 * this handle (the shared one lives in BrowsePanel, gh#165).
 */
export interface LibraryBrowseHandle {
  /** Move the selection up (-1) / down (+1), scrolling it into view. */
  navigate: (delta: 1 | -1, extend?: boolean) => void;
  getSelectedTrack: () => Track | null;
  navigatePage: (direction: 1 | -1, half?: boolean) => void;
  navigateEnd: (direction: 1 | -1) => void;
  areaMove: (delta: 1 | -1) => void;
  activate: () => void;
  selectAll: () => void;
  focusSearch: () => void;
  openFollowParams: () => void;
}

interface LibraryProps {
  /** Replace only the lower browse body, retaining its mounted state. */
  replacement?: ReactNode;
  /** Render only the browse surface (sidebar/filter/table) without the
   * Player/TagEditor block — used when a deck surface is shown elsewhere
   * (performance/transition modes of the shared BrowsePanel). Implies: the
   * library keyboard hub is not mounted (each view owns its hub). Toggles
   * live on the ONE shared instance (gh#165) — all hooks here stay
   * unconditional so flipping it never remounts the browse surface. */
  browseOnly?: boolean;
  /** Per-row hover load-to-A–D buttons (Performance view). Double-click
   * also routes through this, so the view's load policy (and load lock)
   * applies to it too. */
  onLoadToDeck?: (deck: ChannelId, track: Track) => void;
  /** Replace ABCD row buttons with custom actions (#221 Mix editor). */
  rowActions?: import('./browseHost').BrowseRowAction[];
  /** Override row double-click (defaults to a deck load). */
  onRowDoubleClick?: (track: Track) => void;
  /** Which Deck an embedded double-click targets (issue 22). The
   * Performance view passes its focused left Deck so double-click follows
   * A↔C; absent, double-click uses Deck A (the standalone Library keeps its
   * stable audition player). Only meaningful with onLoadToDeck. */
  doubleClickDeck?: ChannelId;
  /** Selection access for the embedding view's keyboard hub. */
  browseRef?: Ref<LibraryBrowseHandle>;
}

export default function Library({
  browseOnly = false,
  onLoadToDeck,
  rowActions,
  onRowDoubleClick,
  doubleClickDeck = 'A',
  browseRef,
  replacement,
}: LibraryProps) {
  const viewActive = useViewActive();
  const parentBrowseActive = useBrowseActive();
  const hasReplacement = replacement != null;
  const browseActive = parentBrowseActive && !hasReplacement;
  // Set-view state lives in the set store (sets 01) and view/playlist
  // selection seeds from the browse-session store (issue 27). Since gh#165
  // there is ONE Library instance (BrowsePanel) that never remounts on
  // mode switches — the stores seed that single mount (and any future
  // remount); local view changes write back through the handlers below.
  // A selected Set wins the seed (setStore is the Set authority).
  const [selectedView, setSelectedView] = useState<ViewType>(() =>
    restoredView(getSelectedSetId() !== null, getSelectedSessionUuid() !== null)
  );
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<number | null>(
    () => browseSession().playlistId
  );
  const [playlistExportOpen, setPlaylistExportOpen] = useState(false);
  // Export gate (ADR 0043): the playlist Sync/Export modal only writes
  // external libraries, so it hides until the Settings toggle is on.
  const exportEnabled = useExportEnabled();
  const [selectedSetId, setSelectedSetId] = useState<number | null>(() => getSelectedSetId());
  const [selectedSessionUuid, setSelectedSessionUuid] = useState<string | null>(() =>
    getSelectedSessionUuid()
  );
  const [isEnergyEditMode, setIsEnergyEditMode] = useState(false);
  // Cross-view set navigation (sets 40, TopBar ownership chip): the store
  // already carries the selection; this nudges an ALREADY-mounted browse
  // instance (whose view state is local, seeded on mount) to show it.
  useEffect(() => {
    const onNavigateSet = () => {
      const id = getSelectedSetId();
      if (id === null) return;
      setSelectedView('set');
      setSelectedSetId(id);
    };
    window.addEventListener(NAVIGATE_SET_EVENT, onNavigateSet);
    return () => window.removeEventListener(NAVIGATE_SET_EVENT, onNavigateSet);
  }, []);
  // Tour activity (feature-tour #282): Sets and Sessions are tour
  // sections of their own, living inside the Library — announce which
  // inner pane is up so their coach marks fire on first entry.
  useEffect(() => {
    setLibrarySubview(
      selectedView === 'set' ? 'sets' : selectedView === 'session' ? 'sessions' : null
    );
  }, [selectedView]);
  // Session deep-link (sessions 04): same two-part shape as Sets — the
  // store carries the selection; this nudges a mounted instance.
  useEffect(() => {
    const onOpenSession = () => {
      const uuid = getSelectedSessionUuid();
      if (uuid === null) return;
      setSelectedView('session');
      setSelectedSessionUuid(uuid);
      selectSet(null);
    };
    window.addEventListener(OPEN_SESSION_EVENT, onOpenSession);
    return () => window.removeEventListener(OPEN_SESSION_EVENT, onOpenSession);
  }, []);
  const queryClient = useQueryClient();
  const tagEditorRef = useRef<TagEditorHandle | null>(null);
  const { filters, setFilters } = useFilters();
  // The shared Deck: performance actions target the loaded Track, not the
  // selection. Narrow snapshot selector so transport events don't re-render
  // the (large) library tree.
  const { engine, loadedTrack, loadTrack } = useDeck();
  const showToast = useToast();

  // Transition-library discovery (transition-library 02; A–D per
  // four-deck-performance 21): per-row marks for tracks with a saved
  // Transition FROM any loaded Deck, starred when the pair is Preferred.
  // Index rebuilds live on editor save events.
  const decks = useDecks();
  const transitionIndex = useTransitionIndex();
  const links = useLinks();
  const transitionMarks = {
    A: transitionsFrom(transitionIndex, decks.A.loadedTrack?.id),
    B: transitionsFrom(transitionIndex, decks.B.loadedTrack?.id),
    C: transitionsFrom(transitionIndex, decks.C.loadedTrack?.id),
    D: transitionsFrom(transitionIndex, decks.D.loadedTrack?.id),
  };
  const deckIds = {
    A: decks.A.loadedTrack?.id ?? null,
    B: decks.B.loadedTrack?.id ?? null,
    C: decks.C.loadedTrack?.id ?? null,
    D: decks.D.loadedTrack?.id ?? null,
  };

  const follow = useRankedFollow({
    A: decks.A.loadedTrack, B: decks.B.loadedTrack,
    C: decks.C.loadedTrack, D: decks.D.loadedTrack,
  }, transitionIndex, links, selectedView === 'archived');

  // Beatgrid mutation hooks
  const setDownbeat = useSetBeatgridDownbeat();
  const nudgeGrid = useNudgeBeatgrid();

  // ── Split view (playlist-editing 05) ───────────────────────────────────
  // The split stacks two panes: the playlist (Play order) on top, the full
  // library with its FilterBar below. Closed, the playlist view is exactly
  // the single-table layout (which still supports drag-reordering).
  const [isSplitViewOpen, setIsSplitViewOpen] = useState(() => browseSession().splitViewOpen);
  const splitView =
    !browseOnly && selectedView === 'playlist' && selectedPlaylistId !== null && isSplitViewOpen;
  // Leaving the playlist (or the view) closes the split — adjust-during-
  // render (not an effect: react.dev "you might not need an effect").
  const [prevSplitCtx, setPrevSplitCtx] = useState<[ViewType, number | null]>([
    selectedView,
    selectedPlaylistId,
  ]);
  if (prevSplitCtx[0] !== selectedView || prevSplitCtx[1] !== selectedPlaylistId) {
    setPrevSplitCtx([selectedView, selectedPlaylistId]);
    setIsSplitViewOpen(false);
  }

  // Focus model (four-deck-performance 24): one focused browse AREA —
  // the sidebar or a track pane. Click focuses, Tab/Shift+Tab (and the
  // hardware tilt, issue 25) walk the ring; keyboard routes to it.
  // Opening/closing the split resets focus to its first track pane.
  const [focusedArea, setFocusedArea] = useState<BrowseArea>(() => browseSession().focusedArea);
  const [prevSplitView, setPrevSplitView] = useState(splitView);
  if (prevSplitView !== splitView) {
    setPrevSplitView(splitView);
    setFocusedArea(splitView ? 'playlist' : 'main');
  }
  const sidebarFocused = focusedArea === 'sidebar';
  /** The split-pane projection of the focused area (legacy pane logic). */
  const focusedPane: 'playlist' | 'library' = focusedArea === 'library' ? 'library' : 'playlist';

  // The sidebar cursor: a highlight that walks rows without opening them
  // (rekordbox tree semantics); Enter/press opens. Seeded from the current
  // selection when the sidebar gains focus.
  const [sidebarCursor, setSidebarCursor] = useState<string | null>(
    () => browseSession().sidebarCursor
  );
  const { data: sidebarPlaylists = [] } = useQuery({
    queryKey: ['playlists'],
    queryFn: api.playlists.list,
  });
  const { data: sidebarSets = [] } = useQuery({ queryKey: ['sets'], queryFn: api.sets.list });
  // Collapsed sections (gh#174) hide their rows, so they leave the walk.
  const tracksCollapsed = useSyncExternalStore(subscribeSidebarSections, () =>
    isSidebarSectionCollapsed('tracks')
  );
  const playlistsCollapsed = useSyncExternalStore(subscribeSidebarSections, () =>
    isSidebarSectionCollapsed('playlists')
  );
  const setsCollapsed = useSyncExternalStore(subscribeSidebarSections, () =>
    isSidebarSectionCollapsed('sets')
  );
  const sidebarNavEntries = useMemo(
    () =>
      sidebarEntries(
        sidebarPlaylists.map((p: { id: number }) => p.id),
        sidebarSets.map((s: { id: number }) => s.id),
        { tracks: tracksCollapsed, playlists: playlistsCollapsed, sets: setsCollapsed }
      ),
    [sidebarPlaylists, sidebarSets, tracksCollapsed, playlistsCollapsed, setsCollapsed]
  );

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
      needsAttention: selectedView === 'needs-attention' ? true : undefined,
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
  const { data: unifiedPlaylists } = useQuery({
    queryKey: ['playlistSync'],
    queryFn: api.playlistSync.getUnified,
    enabled: selectedView === 'playlist' && selectedPlaylistId !== null,
  });
  const unifiedPlaylist = unifiedPlaylists?.find(
    playlist => playlist.name === playlistData?.name
  );

  // Per-playlist filter toggle (playlist-editing 09): a playlist is a
  // curated order, so it shows unfiltered by default; this playlist's
  // toggle opts it into the GLOBAL filter params (client-side thinning —
  // the playlist query fetches the full order regardless).
  const playlistFilterOn = usePlaylistFilterEnabled(
    selectedView === 'playlist' ? selectedPlaylistId : null
  );

  // Playlist-view sort (playlist-editing 04): client-side and view-only —
  // it never rewrites Play order. Default (and reset on playlist switch)
  // is the # column ascending, i.e. Play order itself.
  const [playlistSort, setPlaylistSort] = useState<PlaylistSort>(PLAY_ORDER_SORT);
  /** Follow sort mode (match-score PRD): score is the default order of
   * the heuristic stratum; a column-header click hands the within-strata
   * order to that column (Known stays pinned regardless); the score
   * header hands it back. */
  const [followScoreSort, setFollowScoreSort] = useState(true);
  const [prevSortPlaylistId, setPrevSortPlaylistId] = useState(selectedPlaylistId);
  if (prevSortPlaylistId !== selectedPlaylistId) {
    setPrevSortPlaylistId(selectedPlaylistId);
    setPlaylistSort(PLAY_ORDER_SORT);
  }

  /** Play order by track id (from the API's position-ordered response). */
  const playOrder = useMemo(() => {
    if (selectedView !== 'playlist') return undefined;
    return new Map<number, number>(
      (playlistData?.tracks ?? []).map((t: Track, i: number) => [t.id, i])
    );
  }, [selectedView, playlistData]);

  // Add tracks to playlist (sidebar drops) — the same sequential-append
  // mutation the track menu uses (sets 17: one home, no drift).
  const addToPlaylistMutation = useAddTracksToPlaylist();

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
    // A column sort takes over the within-strata order while following.
    setFollowScoreSort(false);
    // Playlist table: local, view-only sort (Play order untouched).
    if (selectedView === 'playlist') {
      setPlaylistSort((prev) => nextPlaylistSort(prev, column));
      return;
    }
    handleSortLibrary(column);
  };

  // Beatgrid edits are playhead-dependent, so they act on the loaded Track
  const handleNudgeBeatgrid = (offsetMs: number) => {
    if (!loadedTrack || !deckReadyNow(engine, loadedTrack.id)) return;
    nudgeGrid.mutate({ trackId: loadedTrack.id, offsetMs });
  };

  const handleSetDownbeat = () => {
    if (!loadedTrack || !deckReadyNow(engine, loadedTrack.id)) return;
    setDownbeat.mutate({
      trackId: loadedTrack.id,
      downbeatTime: engine.getPlayhead(),
    });
  };

  // ── Track lists per pane ───────────────────────────────────────────────
  // Library list ('all'/'unprocessed' views and the edit-mode library pane),
  // with the Follow candidate set composed client-side (follow-mode 01/03).
  const libraryTracks = follow.project(allTracksData?.items ?? EMPTY_TRACKS, followScoreSort);

  // Playlist list, in the view-only playlist sort. The Follow filter
  // applies only outside edit mode — in the split, the FilterBar belongs
  // to the library pane — and only while the per-playlist filter toggle
  // shows the FilterBar (#156): Follow's controls live there, so a hidden
  // bar must not leave the list silently match-reordered.
  const filteredPlaylistTracks = useMemo(() => {
    const sorted = sortPlaylistTracks(playlistData?.tracks ?? EMPTY_TRACKS, playlistSort);
    return playlistFilterOn ? sorted.filter(t => trackMatchesFilters(t, filters)) : sorted;
  }, [playlistData?.tracks, playlistSort, playlistFilterOn, filters]);
  // The per-playlist toggle applies the global params (playlist-editing
  // 09); thinning is tracked so positional reorders can refuse — a drop
  // index against a thinned list doesn't address the full Play order.
  const playlistThinned =
    playlistFilterOn && filteredPlaylistTracks.length !== (playlistData?.tracks?.length ?? 0);
  const playlistTracks = !splitView && playlistFilterOn
    ? follow.project(filteredPlaylistTracks, followScoreSort) : filteredPlaylistTracks;

  /** Section headers (follow-mode 08, match-score PRD): the Known strata
   * keep their headers and marks; the heuristic stratum is one
   * 'Compatible' section, temperature-ordered when enabled. Only while Follow
   * filters — manual browsing stays a flat table. */
  const followGroupLabel = follow.groupLabelFor;
  const followGroupControls = (label: string) => label === 'Compatible' ? (
    <FollowTemperatureControls active={followScoreSort} />
  ) : null;
  /** Why-did-this-match dimming: rows grey the key/tags that earned
   * nothing toward the score. */
  const followMatchSignals = follow.matchSignalsFor;
  /** Match-score column (match-score PRD): visible while Follow filters.
   * Known rows show their evidence marks, not a score (null = blank). */
  const followScoreFor = follow.scoreFor;

  // Follow decorations ride the same gate as the ordering (#156): the main
  // table in playlist view drops them while the FilterBar (and with it the
  // Follow controls) is hidden. Library views always decorate.
  const followInMain = selectedView !== 'playlist' || playlistFilterOn;

  // ── Selection machinery: one instance per pane ─────────────────────────
  // 'main' is the single always-present table (playlist or library,
  // depending on the view; the top pane in the split). 'editLibrary' only
  // exists while editing.
  const currentTracks = selectedView === 'playlist' ? playlistTracks : libraryTracks;
  const mainSel = useTrackSelection(currentTracks, browseSession().mainSelection);
  const editLibSel = useTrackSelection(splitView ? libraryTracks : EMPTY_TRACKS);

  /** The pane keyboard input acts on. */
  const activeSel = splitView && focusedPane === 'library' ? editLibSel : mainSel;
  const selectedTrack = activeSel.selectedTrack;

  // Switching views/playlists clears the main selection outright (prune
  // would do most of it; this also covers same-id coincidences). The MOUNT
  // run is exempt: a fresh instance restoring the browse session (issue 27)
  // hasn't switched anything — clearing there wiped the restored selection.
  const resetMainSelection = mainSel.setSelection;
  const prevViewCtxRef = useRef<[ViewType, number | null] | null>(null);
  useEffect(() => {
    const prev = prevViewCtxRef.current;
    prevViewCtxRef.current = [selectedView, selectedPlaylistId];
    if (prev === null) return;
    if (prev[0] === selectedView && prev[1] === selectedPlaylistId) return;
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
  const canPositionDrops = isPlayOrderSort(playlistSort) && !playlistThinned;
  const playlistMemberIds = useMemo(
    () => new Set<number>((playlistData?.tracks ?? []).map((t: Track) => t.id)),
    [playlistData]
  );

  /** Uniform row rectangles from index geometry, not a DOM scan
   * (track-table-virtualization 01): the table virtualizes, so off-screen
   * rows have no rectangle to query. Rows are ROW_HEIGHT tall and start
   * below the sticky header; the playlist pane has no tier headers, so the
   * row index equals the track index. */
  const paneRowRects = (pane: HTMLDivElement, rowCount: number): RowRect[] => {
    const headHeight = (pane.querySelector('thead') as HTMLElement | null)?.offsetHeight ?? 0;
    return Array.from({ length: rowCount }, (_unused, i) => ({
      top: headHeight + i * ROW_HEIGHT,
      height: ROW_HEIGHT,
    }));
  };

  /** Drop indicator from a pointer position (viewport Y), against the
   * pane's CURRENT scrollTop — called from dragover and from the edge
   * scroll loop (the index under a stationary pointer changes while
   * content slides beneath it). */
  const updateDropIndicator = (clientY: number) => {
    const pane = playlistPaneRef.current;
    if (!pane) return;
    const rects = paneRowRects(pane, playlistTracks.length);
    const pointerY = clientY - pane.getBoundingClientRect().top + pane.scrollTop;
    const index = canPositionDrops ? insertionIndexFromPointer(pointerY, rects) : rects.length;
    setDropIndicator({ index, y: indicatorY(index, rects) });
  };

  // ── Edge auto-scroll (dragScroll.ts) ───────────────────────────────────
  // A rAF loop driven by the LAST KNOWN drag pointer, not by dragover
  // cadence: stationary dragover refires only ~every 350ms (a hand held at
  // the edge barely scrolled), and once the pointer overshoots the pane the
  // pane gets no dragover at all. A window-level dragover keeps the pointer
  // fresh anywhere in the app, so dragging PAST the edge keeps scrolling
  // (faster, per the overshoot ramp).
  const dragPointerRef = useRef<{ x: number; y: number } | null>(null);
  /** Last pointer-update timestamp: the loop self-terminates when dragover
   * goes quiet (drag ended off-window, missed dragend, …). */
  const dragPointerTsRef = useRef(0);
  const edgeScrollRafRef = useRef<number | null>(null);
  const edgeScrollPrevTsRef = useRef(0);
  /** Latest-render frame body (the rAF chain must see fresh closures). */
  const edgeScrollFrameRef = useRef<(ts: number) => void>(() => {});

  const onWindowDragOver = useCallback((e: DragEvent) => {
    dragPointerRef.current = { x: e.clientX, y: e.clientY };
    dragPointerTsRef.current = e.timeStamp;
  }, []);

  const stopEdgeScroll = useCallback(() => {
    if (edgeScrollRafRef.current !== null) cancelAnimationFrame(edgeScrollRafRef.current);
    edgeScrollRafRef.current = null;
    dragPointerRef.current = null;
    window.removeEventListener('dragover', onWindowDragOver);
    window.removeEventListener('drop', stopEdgeScroll);
    window.removeEventListener('dragend', stopEdgeScroll);
  }, [onWindowDragOver]);
  useEffect(() => stopEdgeScroll, [stopEdgeScroll]);

  edgeScrollFrameRef.current = (ts: number) => {
    const pane = playlistPaneRef.current;
    const pt = dragPointerRef.current;
    if (!pane || !pt || ts - dragPointerTsRef.current > DRAG_POINTER_STALE_MS) {
      stopEdgeScroll();
      return;
    }
    const elapsedMs = ts - edgeScrollPrevTsRef.current;
    edgeScrollPrevTsRef.current = ts;
    const rect = pane.getBoundingClientRect();
    // Only while horizontally over the pane: in the split, the library
    // pane sits beside it and must not drive its scroll.
    const withinX = pt.x >= rect.left && pt.x <= rect.right;
    const delta = withinX ? dragEdgeScrollDelta(pt.y, rect.top, rect.bottom, elapsedMs) : 0;
    if (delta !== 0) {
      pane.scrollTop += delta;
      // Indicator only while a drop here is actually possible (pointer
      // inside the pane); past the edge, dragleave has cleared it.
      if (pt.y >= rect.top && pt.y <= rect.bottom) updateDropIndicator(pt.y);
    }
    edgeScrollRafRef.current = requestAnimationFrame((t) => edgeScrollFrameRef.current(t));
  };

  const ensureEdgeScrollLoop = () => {
    if (edgeScrollRafRef.current !== null) return;
    edgeScrollPrevTsRef.current = performance.now();
    window.addEventListener('dragover', onWindowDragOver);
    window.addEventListener('drop', stopEdgeScroll);
    window.addEventListener('dragend', stopEdgeScroll);
    edgeScrollRafRef.current = requestAnimationFrame((t) => edgeScrollFrameRef.current(t));
  };

  const handlePlaylistPaneDragOver = (e: React.DragEvent) => {
    if (!isTrackDrag(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    dragPointerRef.current = { x: e.clientX, y: e.clientY };
    dragPointerTsRef.current = e.timeStamp;
    ensureEdgeScrollLoop();
    updateDropIndicator(e.clientY);
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
        showToast(playlistThinned ? 'Clear filters to reorder' : 'Sort by # to reorder');
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

  // ── Drop import (#297): OS files dropped onto the track table import in
  // place; in playlist view they are also appended to that playlist.
  const importDroppedFiles = useFileDropImport();
  const tableDropPlaylistId = selectedView === 'playlist' ? selectedPlaylistId : null;
  const handleTableFiles = useCallback(
    (dt: DataTransfer) => { void importDroppedFiles(dt, tableDropPlaylistId); },
    [importDroppedFiles, tableDropPlaylistId],
  );
  const tableFileDrop = useFileDropTarget(handleTableFiles);
  useSuppressStrayFileDrops();
  const handleSidebarFileDrop = useCallback(
    (playlistId: number, dt: DataTransfer) => { void importDroppedFiles(dt, playlistId); },
    [importDroppedFiles],
  );

  // ── Track-row context menu (playlist-editing 03) ───────────────────────
  const { menu: rowMenu, openMenu: openRowMenu, closeMenu: closeRowMenu } =
    useContextMenuState<{ track: Track; pane: MenuPane }>();

  const selForPane = (pane: MenuPane) => (pane === 'editLibrary' ? editLibSel : mainSel);

  // Ref-backed + stable per pane: these land on every memoized row.
  const menuDepsRef = useRef({ mainSel, editLibSel, splitView });
  useEffect(() => {
    menuDepsRef.current = { mainSel, editLibSel, splitView };
  });

  const rowContextMenu = useCallback(
    (pane: MenuPane, track: Track, pos: { x: number; y: number }) => {
      const deps = menuDepsRef.current;
      const sel = pane === 'editLibrary' ? deps.editLibSel : deps.mainSel;
      // Standard behavior: right-clicking outside the selection selects the row.
      if (!sel.selection.ids.includes(track.id)) {
        sel.setSelection(click(sel.selection, track.id));
      }
      if (deps.splitView) setFocusedArea(pane === 'editLibrary' ? 'library' : 'playlist');
      openRowMenu(pos.x, pos.y, { track, pane });
    },
    // setFocusedArea is a stable setState — listed for the compiler lint.
    [openRowMenu, setFocusedArea]
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

  // The universal track menu (sets 17): shared core + hook own the
  // items (per-track Archive↔Unarchive replaced the old view-level
  // switch — the Archived view still gets Load/Add for auditioning);
  // this surface contributes only its targets and Remove from playlist.
  // Targets = the selection if the clicked row is in it, else the
  // clicked row, resolved to Track rows in selection order.
  const rowMenuTargets: Track[] = (() => {
    if (!rowMenu) return EMPTY_TRACKS;
    const { track: menuTrack, pane } = rowMenu.context;
    const paneTracks = pane === 'editLibrary' ? libraryTracks : currentTracks;
    const byId = new Map<number, Track>(paneTracks.map((t: Track) => [t.id, t]));
    return menuTargets(selForPane(pane).selection, menuTrack, (id) => byId.get(id));
  })();
  const menuInViewedPlaylist = canRemoveFromPlaylist && rowMenu?.context.pane === 'main';
  const rowMenuItems = useTrackMenuItems({
    tracks: rowMenuTargets,
    // The viewed playlist never lists itself under Add to playlist ▸.
    excludePlaylistId: menuInViewedPlaylist ? selectedPlaylistId ?? undefined : undefined,
    loadToDeck: loadWithViewPolicy,
    surfaceItems: menuInViewedPlaylist
      ? [
          {
            label:
              rowMenuTargets.length > 1
                ? `Remove ${rowMenuTargets.length} from playlist`
                : 'Remove from playlist',
            danger: true,
            onSelect: () => removeTracksFromViewedPlaylist(rowMenuTargets.map((t) => t.id)),
          },
        ]
      : [],
  });

  const totalTracks = selectedView === 'playlist'
    ? playlistData?.tracks?.length || 0
    : allTracksData?.library_total || 0;

  // Empty-table guidance (feature-tour #283): what to do next depends on
  // WHY the table is empty — a fresh Library reads differently from an
  // empty playlist, an all-clear worklist, or filters with no hits.
  const libraryEmpty = (allTracksData?.library_total ?? 0) === 0;
  const emptyTableMessage =
    selectedView === 'playlist'
      ? 'Empty playlist — drag tracks here from All tracks.'
      : libraryEmpty
        ? 'No tracks yet — import your library (rekordbox or a folder of audio files) from the SYNC view, and your music lands here.'
        : selectedView === 'unprocessed'
          ? 'Nothing unprocessed — every track has been analyzed.'
          : selectedView === 'needs-attention'
            ? 'Nothing needs attention — no tracks are waiting on a beatgrid.'
            : selectedView === 'archived'
              ? 'No archived tracks — Archive in a row\u2019s context menu tucks tracks away here.'
              : 'No tracks match these filters — clear or loosen them above.';

  // Embedded, double-click routes through the view's load policy (and its
  // load lock) instead of loading directly, targeting the embedding view's
  // double-click Deck (issue 22: the Performance focused left Deck; Deck A
  // otherwise). Standalone, it loads onto this Library's own Deck A scope.
  // Memoized — the rows are.
  const loadForTable = useMemo(
    () =>
      onRowDoubleClick ??
      (browseOnly && onLoadToDeck ? (t: Track) => onLoadToDeck(doubleClickDeck, t) : loadTrack),
    [browseOnly, onLoadToDeck, doubleClickDeck, loadTrack, onRowDoubleClick]
  );

  // The same handle, registered module-level as the active browse surface
  // for the hardware Controller (midi-controller 05): encoder moves this
  // selection, the LOAD controls read it and load with the view's policy
  // (editor-midi 03) onto the Deck the mapping targets. Registration is
  // mount-scoped; handlers read the live selection and policy through refs.
  //
  // While a Set is the visible browse list, the LIBRARY YIELDS (sets 33):
  // the SetDetailPane registers its own surface, and gating here (rather
  // than trusting stack order) keeps that true on fresh mounts too —
  // child effects run before parent effects, so on a mode switch with a
  // Set open the pane registers FIRST; an ungated Library registration
  // would land on top and hand the encoder the hidden, stale track list.
  const mainSelRef = useRef(mainSel);
  useEffect(() => {
    mainSelRef.current = mainSel;
  });
  const viewingSet = selectedView === 'set' && selectedSetId !== null;
  const viewingSessionPane = selectedView === 'session';

  // ── Area/sidebar navigation routing (four-deck-performance 24) ─────────
  // One router serves the keyboard hub and the hardware surface: the
  // focused area owns navigation. Sidebar focused, motion walks the
  // cursor; otherwise it drives the focused pane's selection.
  const openSidebarEntry = (entry: SidebarEntry) => {
    setFocusedArea('main');
    if (entry.kind === 'view') {
      setSelectedView(entry.view);
      selectSet(null);
      // The Sessions ENTRY shows the list; re-clicking it while a
      // timeline is open acts as "back to the list".
      setSelectedSessionUuid(null);
      selectSession(null);
    } else if (entry.kind === 'playlist') {
      setSelectedView('playlist');
      setSelectedPlaylistId(entry.id);
      selectSet(null);
      selectSession(null);
    } else {
      setSelectedView('set');
      setSelectedSetId(entry.id);
      selectSet(entry.id);
      selectSession(null);
    }
  };
  /** Focus the sidebar, seeding the cursor where the selection lives. */
  const enterSidebar = () => {
    if (!sidebarFocused) {
      setSidebarCursor(
        (cur) =>
          cur ??
          selectionEntryKey(selectedView, selectedPlaylistId, selectedSetId) ??
          (sidebarNavEntries.length > 0 ? entryKey(sidebarNavEntries[0]) : null)
      );
    }
    setFocusedArea('sidebar');
  };
  const handleAreaMove = (delta: 1 | -1) => {
    const next = moveBrowseArea(browseAreas(splitView), focusedArea, delta);
    if (next === 'sidebar') {
      enterSidebar();
      return;
    }
    setFocusedArea(next);
  };
  const moveSidebarCursor = (delta: number) => {
    const next = moveCursor(sidebarNavEntries, sidebarCursor, delta);
    if (next) setSidebarCursor(entryKey(next));
  };
  const handleNavigateArea = (delta: 1 | -1) =>
    sidebarFocused ? moveSidebarCursor(delta) : activeSel.handleNavigate(delta);
  const handleNavigatePageArea = (direction: 1 | -1) =>
    sidebarFocused
      ? moveSidebarCursor(direction * BROWSE_PAGE_ROWS)
      : activeSel.handleNavigatePage(direction);
  const handleNavigateEndArea = (direction: 1 | -1) => {
    if (!sidebarFocused) {
      activeSel.handleNavigateEnd(direction);
      return;
    }
    const next = cursorEnd(sidebarNavEntries, direction);
    if (next) setSidebarCursor(entryKey(next));
  };
  const activateSidebarCursor = () => {
    const entry = sidebarNavEntries.find((e) => entryKey(e) === sidebarCursor);
    if (!entry) return;
    openSidebarEntry(entry);
  };
  const splitViewAvailable = !browseOnly && selectedView === 'playlist' && selectedPlaylistId !== null;

  const filterBarRef = useRef<FilterBarHandle>(null);
  const tableVisible = !viewingSet && !viewingSessionPane;
  useImperativeHandle(browseRef, () => ({
    navigate: (delta, extend) => {
      if (!viewActive || !browseActive) return;
      if (sidebarFocused) moveSidebarCursor(delta);
      else if (tableVisible) activeSel.handleNavigate(delta, extend);
    },
    getSelectedTrack: () => viewActive && browseActive && tableVisible && !sidebarFocused ? activeSel.selectedTrack : null,
    navigatePage: (direction, half) => {
      if (!viewActive || !browseActive) return;
      if (sidebarFocused) moveSidebarCursor(direction * (half ? Math.ceil(BROWSE_PAGE_ROWS / 2) : BROWSE_PAGE_ROWS));
      else if (tableVisible) {
        if (half) activeSel.handleNavigateHalfPage(direction);
        else activeSel.handleNavigatePage(direction);
      }
    },
    navigateEnd: (direction) => { if (viewActive && browseActive && (sidebarFocused || tableVisible)) handleNavigateEndArea(direction); },
    areaMove: (direction) => { if (viewActive && browseActive) handleAreaMove(direction); },
    activate: () => { if (viewActive && browseActive && sidebarFocused) activateSidebarCursor(); },
    selectAll: () => { if (viewActive && browseActive && tableVisible && !sidebarFocused) activeSel.handleSelectAll(); },
    focusSearch: () => {
      if (!viewActive || !browseActive) return;
      if (!filterBarRef.current) { showToast('Search requires a filtered track list'); return; }
      setFocusedArea(splitView ? 'library' : 'main');
      filterBarRef.current.focusSearch();
    },
    openFollowParams: () => {
      if (!viewActive || !browseActive) return;
      if (!filterBarRef.current) { showToast('Follow parameters require a filtered track list'); return; }
      filterBarRef.current.openFollowParams();
    },
  }));

  // ── Session write-back (issue 27) ───────────────────────────────────────
  // The next Library mount (any mode's instance) seeds from the store.
  useEffect(() => {
    updateBrowseSession({
      view: selectedView,
      playlistId: selectedPlaylistId,
      splitViewOpen: isSplitViewOpen,
      focusedArea,
      sidebarCursor,
    });
  }, [selectedView, selectedPlaylistId, isSplitViewOpen, focusedArea, sidebarCursor]);
  useEffect(() => {
    updateBrowseSession({ mainSelection: mainSel.selection });
  }, [mainSel.selection]);

  // Main-table scroll position: restored once rows exist (query cache
  // makes that the first paint after a mode flip), saved on unmount.
  const browseScrollRef = useRef<HTMLDivElement | null>(null);
  const scrollRestoredRef = useRef(false);
  useEffect(() => {
    if (scrollRestoredRef.current) return;
    const el = browseScrollRef.current;
    if (!el || currentTracks.length === 0) return;
    el.scrollTop = browseSession().scrollTop;
    scrollRestoredRef.current = true;
  }, [currentTracks.length]);
  // Saved on every scroll, not at unmount: React nulls callback refs
  // before passive cleanups run, so an unmount-time read sees nothing.
  const handleBrowseScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (scrollRestoredRef.current) updateBrowseSession({ scrollTop: e.currentTarget.scrollTop });
  };

  // The hardware surface routes through the same area-aware handlers,
  // ref-backed so the mount-scoped registration reads live state.
  const currentBrowseNav = () => ({
    navigate: handleNavigateArea,
    navigatePage: handleNavigatePageArea,
    navigateEnd: handleNavigateEndArea,
    areaMove: handleAreaMove,
    activate: () => {
      // Table focused, press is a no-op: LOAD owns loading (design doc).
      if (sidebarFocused) activateSidebarCursor();
    },
    focusSidebar: enterSidebar,
    toggleSplitView: splitViewAvailable ? () => setIsSplitViewOpen((v) => !v) : () => {},
  });
  const browseNavRef = useRef(currentBrowseNav());
  useEffect(() => {
    browseNavRef.current = currentBrowseNav();
  });

  useEffect(() => {
    if (!viewActive || !browseActive) return;
    if (viewingSet) return; // the Set pane owns the browse surface
    if (viewingSessionPane) return; // sessions own the main area; no hidden list grabs
    return registerBrowseSurface({
      navigate: (delta) => browseNavRef.current.navigate(delta),
      getSelectedTrack: () => mainSelRef.current.selectedTrack,
      load: (deck, track) => loadWithViewPolicyRef.current(deck, track),
      navigatePage: (direction) => browseNavRef.current.navigatePage(direction),
      navigateEnd: (direction) => browseNavRef.current.navigateEnd(direction),
      areaMove: (delta) => browseNavRef.current.areaMove(delta),
      activate: () => browseNavRef.current.activate(),
      focusSidebar: () => browseNavRef.current.focusSidebar(),
      toggleSplitView: () => browseNavRef.current.toggleSplitView(),
    });
  }, [viewingSet, viewingSessionPane, viewActive, browseActive]);

  return (
    <BrowseActiveContext.Provider value={browseActive}>
    {/* The library keyboard hub — only when this view owns the keyboard.
        Embedded (browseOnly), the Performance hub drives everything. */}
    {!browseOnly && (
      <LibraryHub
        selectedTrack={selectedTrack}
        onNavigate={handleNavigateArea}
        onSelectAll={activeSel.handleSelectAll}
        onRemoveSelected={removeEnabled && !sidebarFocused ? handleRemoveSelected : undefined}
        onAreaMove={handleAreaMove}
        onNavigatePage={handleNavigatePageArea}
        onNavigateEnd={handleNavigateEndArea}
        onActivate={sidebarFocused ? activateSidebarCursor : undefined}
        onToggleSplitView={
          splitViewAvailable ? () => setIsSplitViewOpen((v) => !v) : undefined
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
      minHeight: 0,
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--crust)'
    }}>
      {/* Waveform at top (full width), controls and editor below.
          Hidden in browseOnly mode (deck surface rendered by the host). */}
      {!browseOnly && (
        <div data-tour="library.player" style={{
          display: 'flex',
          flexDirection: 'column',
          borderBottom: '1px solid var(--surface0)'
        }}>
          <Player />
          {/* Session pane open: the metadata editor hides entirely — its
              content is readable from the deck rows, and the timeline
              needs the vertical room (sessions 04 integration). */}
          <div style={{ display: viewingSessionPane ? 'none' : 'flex' }}>
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
      <div className="Library" style={{
        flex: 1,
        minHeight: 0,
        display: hasReplacement ? 'none' : 'flex',
        overflow: 'hidden'
      }}>
        {/* Sidebar */}
        <PlaylistSidebar
          selectedView={selectedView}
          selectedPlaylistId={selectedPlaylistId}
          onSelectView={(view) => {
            // Sidebar rows only send the special views; playlist/set rows
            // use their dedicated callbacks below.
            if (view === 'playlist' || view === 'set') return;
            openSidebarEntry({ kind: 'view', view });
          }}
          onSelectPlaylist={(id) => openSidebarEntry({ kind: 'playlist', id })}
          onTrackDrop={handleTrackDrop}
          onFileDrop={handleSidebarFileDrop}
          selectedSetId={selectedSetId}
          onSelectSet={(id) => openSidebarEntry({ kind: 'set', id })}
          focused={sidebarFocused}
          cursorKey={sidebarFocused ? sidebarCursor : null}
        />

        {/* Main library area (filter + table; split panes when editing) */}
        <div data-browse-area="tracks" data-tour="library.table" data-browse-focused={!sidebarFocused} onMouseDownCapture={() => { if (!splitView) setFocusedArea('main'); }} style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}>
          {/* Playlist header strip: name + split-view toggle (playlist view only) */}
          {selectedView === 'playlist' && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '4px 12px',
              borderBottom: '1px solid var(--surface0)',
              background: 'var(--crust)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                {/* Per-playlist filter toggle (playlist-editing 09):
                    curated order shows whole by default; ON applies the
                    global filter params and shows the FilterBar here.
                    Square toggle in the app's engaged-fill vocabulary
                    (topbar-quantize / FilterBar buttons): transparent
                    rest with a quiet border, solid accent fill when on. */}
                {selectedPlaylistId !== null && (
                  <button
                    onClick={() => togglePlaylistFilter(selectedPlaylistId)}
                    aria-label="Toggle playlist filters"
                    title="Filter this playlist with the global filters"
                    style={{
                      width: '22px',
                      height: '22px',
                      padding: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: playlistFilterOn ? 'var(--accent)' : 'transparent',
                      color: playlistFilterOn ? 'var(--base)' : 'var(--text)',
                      border: playlistFilterOn
                        ? '1px solid var(--accent)'
                        : '1px solid var(--surface1)',
                      cursor: 'pointer',
                    }}
                  >
                    <FunnelIcon width={14} height={14} opacity={1} />
                  </button>
                )}
                <span style={{ fontSize: '13px', color: 'var(--text)' }}>
                  {playlistData?.name ?? 'Playlist'}
                </span>
                <span style={{ color: 'var(--subtext0)', marginLeft: '8px' }}>
                  {playlistData?.tracks?.length ?? 0} tracks
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {unifiedPlaylist && (
                  <PlaylistStatusBadge status={playlistStatus(unifiedPlaylist)} />
                )}
                {exportEnabled && (
                  <button
                    className="playlist-export-submit"
                    onClick={() => setPlaylistExportOpen(true)}
                    disabled={!playlistData?.name}
                    aria-label="Open playlist sync and export"
                    style={{ padding: '2px 10px' }}
                  >
                    Sync / Export
                  </button>
                )}
                {!browseOnly && (
                  <button
                    onClick={() => setIsSplitViewOpen((v) => !v)}
                    style={{
                      padding: '2px 10px',
                      background: splitView ? 'var(--accent)' : 'var(--surface0)',
                      color: splitView ? 'var(--base)' : 'var(--text)',
                      border: '1px solid var(--surface1)',
                      borderRadius: '3px',
                      cursor: 'pointer',
                      fontSize: '12px',
                    }}
                  >
                    Split view
                  </button>
                )}
              </div>
            </div>
          )}

          {selectedView === 'session' ? (
            /* Sessions (sessions 04): the list in place of the track
               table; a selected session swaps to its timeline. */
            selectedSessionUuid !== null ? (
              <SessionTimelinePane
                sessionUuid={selectedSessionUuid}
                onBack={() => {
                  setSelectedSessionUuid(null);
                  selectSession(null);
                }}
              />
            ) : (
              <SessionsListView
                onOpen={(uuid) => {
                  setSelectedSessionUuid(uuid);
                  selectSession(uuid);
                }}
              />
            )
          ) : selectedView === 'set' && selectedSetId !== null ? (
            /* Set detail view (sets 01): replaces the track table. */
            <SetDetailPane key={selectedSetId} setId={selectedSetId} onLoadToDeck={loadWithViewPolicy} />
          ) : splitView ? (
            <>
              {/* Playlist pane (Play order) */}
              <div
                ref={playlistPaneRef}
                onMouseDownCapture={() => setFocusedArea('playlist')}
                onDragOver={handlePlaylistPaneDragOver}
                onDragLeave={handlePlaylistPaneDragLeave}
                onDrop={handlePlaylistPaneDrop}
                style={{
                  position: 'relative',
                  flex: 1,
                  minHeight: 0,
                  overflow: 'auto',
                  outline: focusedArea === 'playlist' ? '1px solid var(--accent)' : '1px solid transparent',
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
                      background: 'var(--accent)',
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
                  onLoadToDeck={onLoadToDeck}
                  rowActions={rowActions}
                  transitionMarks={transitionMarks}
                  links={links}
                  deckIds={deckIds}
                  sortColumn={playlistSort.column}
                  sortDirection={playlistSort.direction}
                  onSort={handleSort}
                />
              </div>

              {/* Library pane (full FilterBar + table) */}
              <FilterBar
                ref={filterBarRef}
                totalTracks={allTracksData?.library_total || 0}
                filteredCount={libraryTracks.length}
                loadedByDeck={{
                  A: decks.A.loadedTrack,
                  B: decks.B.loadedTrack,
                  C: decks.C.loadedTrack,
                  D: decks.D.loadedTrack,
                }}
              />
              <div
                onMouseDownCapture={() => setFocusedArea('library')}
                style={{
                  flex: 1,
                  minHeight: 0,
                  overflow: 'auto',
                  outline: focusedArea === 'library' ? '1px solid var(--accent)' : '1px solid transparent',
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
                  onLoadToDeck={onLoadToDeck}
                  rowActions={rowActions}
                  transitionMarks={transitionMarks}
                  links={links}
                  deckIds={deckIds}
                  groupLabelFor={followGroupLabel}
                  groupControlsFor={followGroupControls}
                  scoreFor={followScoreFor}
                  scoreSorted={followScoreSort}
                  onScoreSort={() => setFollowScoreSort(true)}
                  matchSignalsFor={followMatchSignals}
                  sortColumn={filters.sortColumn}
                  sortDirection={filters.sortDirection}
                  onSort={handleSortLibrary}
                />
              </div>
            </>
          ) : (
            <>
              {/* In playlist view the FilterBar rides the per-playlist
                  toggle (playlist-editing 09) — hidden while filtering
                  is off there. Other views always filter. */}
              {(selectedView !== 'playlist' || playlistFilterOn) && (
                <FilterBar
                  ref={filterBarRef}
                  totalTracks={totalTracks}
                  filteredCount={currentTracks.length}
                  loadedByDeck={{
                    A: decks.A.loadedTrack,
                    B: decks.B.loadedTrack,
                    C: decks.C.loadedTrack,
                    D: decks.D.loadedTrack,
                  }}
                />
              )}

              {/* Track table. In playlist view it is the playlist pane:
                  drag-reordering works without opening the split. */}
              <div
                ref={(el) => {
                  // Session scroll target (issue 27) + the playlist pane's
                  // drag-reorder geometry when this table IS the playlist.
                  browseScrollRef.current = el;
                  playlistPaneRef.current = selectedView === 'playlist' ? el : null;
                }}
                onScroll={handleBrowseScroll}
                onDragOver={(e) => {
                  if (tableFileDrop.onDragOver(e)) return;
                  if (selectedView === 'playlist') handlePlaylistPaneDragOver(e);
                }}
                onDragLeave={(e) => {
                  tableFileDrop.onDragLeave(e);
                  if (selectedView === 'playlist') handlePlaylistPaneDragLeave(e);
                }}
                onDrop={(e) => {
                  if (tableFileDrop.onDrop(e)) return;
                  if (selectedView === 'playlist') handlePlaylistPaneDrop(e);
                }}
                style={{
                  position: 'relative',
                  flex: 1,
                  overflow: 'auto'
                }}
              >
                <FileDropOverlay
                  rect={tableFileDrop.rect}
                  label={tableDropPlaylistId !== null ? 'Drop to import and add to playlist' : 'Drop to import'}
                />
                {selectedView === 'playlist' && dropIndicator && (
                  <div
                    style={{
                      position: 'absolute',
                      left: 0,
                      right: 0,
                      top: Math.max(0, dropIndicator.y - 1),
                      height: '2px',
                      background: 'var(--accent)',
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
                  onLoadToDeck={onLoadToDeck}
                  rowActions={rowActions}
                  transitionMarks={transitionMarks}
                  links={links}
                  deckIds={deckIds}
                  groupLabelFor={followInMain ? followGroupLabel : undefined}
                  groupControlsFor={followInMain ? followGroupControls : undefined}
                  scoreFor={followInMain ? followScoreFor : undefined}
                  scoreSorted={followScoreSort}
                  onScoreSort={() => setFollowScoreSort(true)}
                  matchSignalsFor={followInMain ? followMatchSignals : undefined}
                  sortColumn={selectedView === 'playlist' ? playlistSort.column : filters.sortColumn}
                  sortDirection={selectedView === 'playlist' ? playlistSort.direction : filters.sortDirection}
                  onSort={handleSort}
                  emptyMessage={emptyTableMessage}
                />
              </div>
            </>
          )}
        </div>
      </div>

      {hasReplacement && (
        <div className="Library-replacement" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          {replacement}
        </div>
      )}

      {rowMenu && (
        <ContextMenu x={rowMenu.x} y={rowMenu.y} items={rowMenuItems} onClose={closeRowMenu} />
      )}
      {playlistExportOpen && playlistData?.name && (
        <PlaylistFullExportModal
          playlistName={playlistData.name}
          onClose={() => setPlaylistExportOpen(false)}
        />
      )}
    </div>
    </BrowseActiveContext.Provider>
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
  onAreaMove,
  onNavigatePage,
  onNavigateEnd,
  onActivate,
  onToggleSplitView,
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
  onAreaMove?: (delta: 1 | -1) => void;
  onNavigatePage?: (direction: 1 | -1) => void;
  onNavigateEnd?: (direction: 1 | -1) => void;
  onActivate?: () => void;
  onToggleSplitView?: () => void;
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
    onAreaMove,
    onNavigatePage,
    onNavigateEnd,
    onActivate,
    onToggleSplitView,
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
