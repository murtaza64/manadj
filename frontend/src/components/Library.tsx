import { useState, useRef, useEffect, useImperativeHandle, useMemo, useCallback } from 'react';
import type { Ref } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import TrackList from './TrackList';
import FilterBar from './FilterBar';
import TagEditor, { type TagEditorHandle } from './TagEditor';
import Player from './Player';
import PlaylistSidebar from './PlaylistSidebar';
import { useKeyboardShortcuts, scrollTrackIntoView } from '../hooks/useKeyboardShortcuts';
import { useSetBeatgridDownbeat, useNudgeBeatgrid } from '../hooks/useBeatgridData';
import { useHotCueActions } from '../hooks/useHotCueActions';
import type { Track } from '../types';
import type { ChannelId } from '../playback/mixer';
import { formatKeyDisplay } from '../utils/keyUtils';
import { useFilters } from '../contexts/FilterContext';
import { useDeck, useDeckReady, useDecks } from '../hooks/useDeck';
import { transitionsFrom, useTransitionIndex } from '../editor/transitionIndex';
import {
  EMPTY_SELECTION,
  click,
  navigate as navigateSelection,
  prune,
  rangeClick,
  selectAll,
  toggleClick,
  type Selection,
} from '../selection/selectionModel';
import type { SelectMods } from './TrackRow';
import ContextMenu, { useContextMenuState, type MenuItem } from './ContextMenu';
import { useToast } from './Toast';
import type { Playlist } from '../types';
import {
  PLAY_ORDER_SORT,
  nextPlaylistSort,
  sortPlaylistTracks,
  type PlaylistSort,
  type PlaylistSortColumn,
} from '../utils/trackSort';

// Find Compatible feature (né Find Related; internal keys unchanged) —
// types and constants
export interface RelatedTracksSettings {
  harmonicKeys: boolean;
  bpm: boolean;
  bpmThresholdPercent: number;
  tags: boolean;
  tagMatchMode: 'ANY' | 'ALL';
  energy: boolean;
  energyPreset: 'up' | 'down' | 'near' | 'equal';
  /** Which loaded deck's track the match runs from (transition-library
   * 03: loaded-deck reference model — the quick-apply arrow reuses it). */
  refDeck: 'A' | 'B';
}

const STORAGE_KEY = 'findRelatedTracksSettings';
export const DEFAULT_SETTINGS: RelatedTracksSettings = {
  harmonicKeys: true,
  bpm: true,
  bpmThresholdPercent: 5,
  tags: false,
  tagMatchMode: 'ANY',
  energy: false,
  energyPreset: 'near',
  refDeck: 'A',
};

// Related tracks feature - utility functions

/**
 * Get harmonically compatible keys in OpenKey notation.
 * Compatible keys: same key, ±1 (same mode), relative minor/major
 */
function getHarmonicKeys(keyId: number | null | undefined): string[] {
  if (keyId === null || keyId === undefined) return [];

  // Convert Engine DJ key ID to OpenKey notation
  const openKey = formatKeyDisplay(keyId);
  if (openKey === '-') return [];

  const results = new Set<string>();
  results.add(openKey);  // Same key

  const match = openKey.match(/^(\d+)(m|d)$/);
  if (!match) return Array.from(results);

  const num = parseInt(match[1]);
  const mode = match[2];

  // Adjacent keys (±1, same mode)
  const prev = num === 1 ? 12 : num - 1;
  const next = num === 12 ? 1 : num + 1;
  results.add(`${prev}${mode}`);
  results.add(`${next}${mode}`);

  // Relative minor/major (same number, opposite mode)
  const oppositeMode = mode === 'm' ? 'd' : 'm';
  results.add(`${num}${oppositeMode}`);

  return Array.from(results);
}

/**
 * Calculate energy range based on preset
 */
export function getEnergyRange(
  currentEnergy: number,
  preset: 'up' | 'down' | 'near' | 'equal'
): { min: number; max: number } {
  switch (preset) {
    case 'equal':
      return { min: currentEnergy, max: currentEnergy };
    case 'near':
      return {
        min: Math.max(1, currentEnergy - 1),
        max: Math.min(5, currentEnergy + 1),
      };
    case 'up':
      return { min: currentEnergy, max: 5 };
    case 'down':
      return { min: 1, max: currentEnergy };
  }
}

/**
 * Load settings from localStorage with validation
 */
function loadSettings(): RelatedTracksSettings {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return DEFAULT_SETTINGS;

    const parsed = JSON.parse(saved);

    // Validate and merge with defaults
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      bpmThresholdPercent: Math.max(0, Math.min(15, parsed.bpmThresholdPercent ?? 5)),
    };
  } catch (error) {
    console.error('Failed to load settings:', error);
    return DEFAULT_SETTINGS;
  }
}

/**
 * Save settings to localStorage
 */
export function saveSettings(settings: RelatedTracksSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

/**
 * Derive filter state from track and settings
 */
function deriveRelatedFilters(
  track: Track,
  settings: RelatedTracksSettings
): {
  search: string;
  selectedTagIds: number[];
  energyMin: number;
  energyMax: number;
  tagMatchMode: 'ANY' | 'ALL';
  bpmCenter: number | null;
  bpmThresholdPercent: number;
  selectedKeyCamelotIds: string[];
  sortColumn: 'key' | 'bpm' | 'energy' | 'title' | 'artist' | 'created_at' | 'bitrate_kbps' | 'filesize_bytes' | 'provenance' | null;
  sortDirection: 'asc' | 'desc';
} {
  const filters = {
    search: '',
    selectedTagIds: [] as number[],
    energyMin: 1,
    energyMax: 5,
    tagMatchMode: 'ANY' as 'ANY' | 'ALL',
    bpmCenter: null as number | null,
    bpmThresholdPercent: 5,
    selectedKeyCamelotIds: [] as string[],
    sortColumn: 'created_at' as 'key' | 'bpm' | 'energy' | 'title' | 'artist' | 'created_at' | 'bitrate_kbps' | 'filesize_bytes' | 'provenance' | null,
    sortDirection: 'desc' as 'asc' | 'desc',
  };

  // 1. Harmonic Keys
  if (settings.harmonicKeys && track.key) {
    filters.selectedKeyCamelotIds = getHarmonicKeys(track.key);
  }

  // 2. BPM
  if (settings.bpm && track.bpm) {
    filters.bpmCenter = track.bpm;
    filters.bpmThresholdPercent = settings.bpmThresholdPercent;
  }

  // 3. Tags
  if (settings.tags && track.tags.length > 0) {
    filters.selectedTagIds = track.tags.map(t => t.id);
    filters.tagMatchMode = settings.tagMatchMode;
  }

  // 4. Energy (with presets)
  if (settings.energy && track.energy !== undefined) {
    const { min, max } = getEnergyRange(track.energy, settings.energyPreset);
    filters.energyMin = min;
    filters.energyMax = max;
  }

  return filters;
}

type ViewType = 'all' | 'unprocessed' | 'playlist';

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
  // Multi-selection (playlist-editing 02): ordered ids + anchor. The
  // anchor's Track object is cached so it can stay visible (and loadable)
  // after it stops matching the active filters.
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);
  const [anchorTrackCache, setAnchorTrackCache] = useState<Track | null>(null);
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

  // Beatgrid mutation hooks
  const setDownbeat = useSetBeatgridDownbeat();
  const nudgeGrid = useNudgeBeatgrid();

  // Fetch all tracks (when 'all' or 'unprocessed' view selected)
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
      sortColumn: filters.sortColumn,
      sortDirection: filters.sortDirection,
    }),
    enabled: selectedView === 'all' || selectedView === 'unprocessed',
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

  const handleSort = (column: PlaylistSortColumn) => {
    // Playlist view: local, view-only sort (Play order untouched).
    if (selectedView === 'playlist') {
      setPlaylistSort((prev) => nextPlaylistSort(prev, column));
      return;
    }
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

  /** The match reference under the loaded-deck model: the chosen deck's
   * track, falling back to the other loaded deck (selection is retired). */
  const referenceFor = (refDeck: 'A' | 'B'): Track | null =>
    decks[refDeck].loadedTrack ?? decks[refDeck === 'A' ? 'B' : 'A'].loadedTrack;

  const handleFindRelated = () => {
    // Quick apply: last settings + last chosen deck.
    const settings = loadSettings();
    const reference = referenceFor(settings.refDeck);
    if (!reference) return;

    const newFilters = deriveRelatedFilters(reference, settings);

    // Replace the four heuristic criteria; the transition axis survives
    // (transition-library composition rule).
    setFilters((f) => ({ ...newFilters, hasTransitionFromDecks: f.hasTransitionFromDecks }));
  };

  const handleApplySettings = (settings: RelatedTracksSettings) => {
    const reference = referenceFor(settings.refDeck);
    if (!reference) return;

    // Save settings and apply filters
    saveSettings(settings);
    const newFilters = deriveRelatedFilters(reference, settings);
    setFilters((f) => ({ ...newFilters, hasTransitionFromDecks: f.hasTransitionFromDecks }));
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

  // Determine current tracks and loading state
  const isLoading = selectedView === 'playlist' ? isLoadingPlaylist : isLoadingAllTracks;
  const error = selectedView === 'playlist' ? playlistError : allTracksError;
  let currentTracks = selectedView === 'playlist'
    ? sortPlaylistTracks(playlistData?.tracks || [], playlistSort)
    : allTracksData?.items || [];

  // The anchor's Track object: from the visible list, falling back to the
  // cached copy (so it survives leaving the active filter).
  const selectedTrack =
    currentTracks.find((t: Track) => t.id === selection.anchorId) ??
    (anchorTrackCache && anchorTrackCache.id === selection.anchorId ? anchorTrackCache : null);

  // Keep the anchor in the list at its original position even if it no
  // longer matches the filter (e.g., in Unprocessed view after tagging)
  const [selectedTrackPosition, setSelectedTrackPosition] = useState<number | null>(null);

  useEffect(() => {
    if (selectedTrack) {
      const index = currentTracks.findIndex((t: Track) => t.id === selectedTrack.id);
      if (index !== -1) {
        setSelectedTrackPosition(index);
      }
    }
  }, [selectedTrack, currentTracks]);

  if (selectedTrack && !currentTracks.find((t: Track) => t.id === selectedTrack.id) && selectedTrackPosition !== null) {
    const newTracks = [...currentTracks];
    newTracks.splice(selectedTrackPosition, 0, selectedTrack);
    currentTracks = newTracks;
  }

  // Proven-tier filter (transition-library 02): composes CLIENT-side over
  // the server-filtered list — transition knowledge lives in localStorage,
  // not the backend.
  if (filters.hasTransitionFromDecks) {
    currentTracks = currentTracks.filter(
      (t: Track) => fromA.has(t.id) || fromB.has(t.id)
    );
  }

  // ── Selection machinery over the displayed list ────────────────────────
  const displayedIds = currentTracks.map((t: Track) => t.id);
  const displayedIdsKey = displayedIds.join(',');

  // Cache the anchor's Track object while it is visible.
  useEffect(() => {
    if (selection.anchorId === null) {
      setAnchorTrackCache(null);
      return;
    }
    const anchorTrack = currentTracks.find((t: Track) => t.id === selection.anchorId);
    if (anchorTrack) setAnchorTrackCache(anchorTrack);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection.anchorId, displayedIdsKey]);

  // Reconcile the selection when the visible list changes (filters, sort,
  // view switches): selected rows that vanished are dropped.
  useEffect(() => {
    setSelection((prev) => prune(prev, displayedIds));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayedIdsKey]);

  const handleRowSelect = (track: Track, mods: SelectMods) => {
    setSelection((prev) =>
      mods.shift
        ? rangeClick(prev, track.id, displayedIds)
        : mods.toggle
          ? toggleClick(prev, track.id)
          : click(prev, track.id)
    );
  };

  const handleNavigate = (delta: 1 | -1) => {
    const next = navigateSelection(selection, delta, displayedIds);
    if (next.anchorId !== null) scrollTrackIntoView(next.anchorId);
    setSelection(next);
  };

  const handleSelectAll = () => {
    setSelection((prev) => selectAll(prev, displayedIds));
  };

  // Delete/Backspace and the context-menu Remove item (playlist views only).
  const canRemoveFromPlaylist = selectedView === 'playlist' && selectedPlaylistId !== null;
  const removeTracksFromViewedPlaylist = (trackIds: number[]) => {
    if (!canRemoveFromPlaylist || trackIds.length === 0) return;
    removeFromPlaylistMutation.mutate({ playlistId: selectedPlaylistId!, trackIds });
  };
  const handleRemoveSelected = () => removeTracksFromViewedPlaylist([...selection.ids]);

  // Drag payload: the whole selection when the dragged row is in it, else
  // just that row. Ref-backed so the callback identity is stable and row
  // memoization survives selection churn.
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const getDragIds = useCallback((trackId: number) => {
    const sel = selectionRef.current;
    return sel.ids.includes(trackId) ? [...sel.ids] : [trackId];
  }, []);

  const selectedIds = useMemo(() => new Set(selection.ids), [selection.ids]);

  // ── Track-row context menu (playlist-editing 03) ───────────────────────
  const { menu: rowMenu, openMenu: openRowMenu, closeMenu: closeRowMenu } = useContextMenuState<Track>();

  const handleRowContextMenu = (track: Track, pos: { x: number; y: number }) => {
    // Standard behavior: right-clicking outside the selection selects the row.
    if (!selection.ids.includes(track.id)) {
      setSelection(click(selection, track.id));
    }
    openRowMenu(pos.x, pos.y, track);
  };

  /** Load target for menu items: route through the embedding view's load
   * policy when present (Performance view), else the shared Decks. */
  const loadToDeckFromMenu = (deck: ChannelId, track: Track) => {
    if (onLoadToDeck) onLoadToDeck(deck, track);
    else decks[deck].loadTrack(track);
  };

  const rowMenuItems: MenuItem[] = useMemo(() => {
    if (!rowMenu) return [];
    const targetIds = selection.ids.includes(rowMenu.context.id) ? [...selection.ids] : [rowMenu.context.id];
    const multi = targetIds.length > 1;
    const loadDisabledTitle = multi ? 'Load acts on a single track' : undefined;
    return [
      {
        label: 'Load to Deck A',
        disabled: multi,
        title: loadDisabledTitle,
        onSelect: () => loadToDeckFromMenu('A', rowMenu.context),
      },
      {
        label: 'Load to Deck B',
        disabled: multi,
        title: loadDisabledTitle,
        onSelect: () => loadToDeckFromMenu('B', rowMenu.context),
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
      ...(canRemoveFromPlaylist
        ? [
            {
              label: multi ? `Remove ${targetIds.length} from playlist` : 'Remove from playlist',
              danger: true,
              onSelect: () => removeTracksFromViewedPlaylist(targetIds),
            } satisfies MenuItem,
          ]
        : []),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowMenu, selection.ids, playlists, canRemoveFromPlaylist, selectedPlaylistId]);

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
      navigate: handleNavigate,
      getSelectedTrack: () => selectedTrack,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [displayedIdsKey, selection, selectedTrack]
  );

  return (
    <>
    {/* The library keyboard hub — only when this view owns the keyboard.
        Embedded (browseOnly), the Performance hub drives everything. */}
    {!browseOnly && (
      <LibraryHub
        selectedTrack={selectedTrack}
        onNavigate={handleNavigate}
        onSelectAll={handleSelectAll}
        onRemoveSelected={canRemoveFromPlaylist ? handleRemoveSelected : undefined}
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

        {/* Main library area (filter + table) */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}>
          <FilterBar
            totalTracks={totalTracks}
            filteredCount={currentTracks.length}
            loadedA={decks.A.loadedTrack}
            loadedB={decks.B.loadedTrack}
            onFindRelated={handleFindRelated}
            onApplySettings={handleApplySettings}
          />

          {/* Track table */}
          <div style={{
            flex: 1,
            overflow: 'auto'
          }}>
            <TrackList
              tracks={currentTracks}
              isLoading={isLoading}
              error={error}
              selectedIds={selectedIds}
              onSelectTrack={handleRowSelect}
              getDragIds={getDragIds}
              onRowContextMenu={handleRowContextMenu}
              playOrder={playOrder}
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
