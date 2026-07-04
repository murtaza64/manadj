import { useState, useRef, useEffect, useImperativeHandle, useMemo } from 'react';
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
import { transitionsFrom, useTransitionIndex } from '../prototype/transitionIndex';

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
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null);
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

  // Add track to playlist mutation
  const addToPlaylistMutation = useMutation({
    mutationFn: ({ playlistId, trackId }: { playlistId: number; trackId: number }) =>
      api.playlists.addTrack(playlistId, { track_id: trackId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['playlist'] });
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

  const handleTrackDrop = (playlistId: number, trackId: number) => {
    addToPlaylistMutation.mutate({ playlistId, trackId });
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

  const handleSort = (column: 'key' | 'bpm' | 'energy' | 'title' | 'artist' | 'created_at' | 'bitrate_kbps' | 'filesize_bytes' | 'provenance') => {
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
    ? playlistData?.tracks || []
    : allTracksData?.items || [];

  // Keep selected track in list at its original position even if it no longer matches filter
  // (e.g., in Unprocessed view after tagging)
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
      navigate: (delta: 1 | -1) => {
        if (currentTracks.length === 0) return;
        const currentIndex = selectedTrack
          ? currentTracks.findIndex((t: Track) => t.id === selectedTrack.id)
          : -1;
        const nextIndex =
          currentIndex === -1
            ? 0
            : Math.max(0, Math.min(currentTracks.length - 1, currentIndex + delta));
        const next = currentTracks[nextIndex];
        setSelectedTrack(next);
        scrollTrackIntoView(next.id);
      },
      getSelectedTrack: () => selectedTrack,
    }),
    [currentTracks, selectedTrack]
  );

  return (
    <>
    {/* The library keyboard hub — only when this view owns the keyboard.
        Embedded (browseOnly), the Performance hub drives everything. */}
    {!browseOnly && (
      <LibraryHub
        tracks={currentTracks}
        selectedTrack={selectedTrack}
        onSelectTrack={setSelectedTrack}
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
              selectedTrack={selectedTrack}
              onSelectTrack={setSelectedTrack}
              onLoadTrack={loadForTable}
              loadedTrackId={loadedTrack?.id ?? null}
              onLoadToDeck={onLoadToDeck}
              transitionMarksA={fromA}
              transitionMarksB={fromB}
              sortColumn={filters.sortColumn}
              sortDirection={filters.sortDirection}
              onSort={handleSort}
            />
          </div>
        </div>
      </div>
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
  tracks,
  selectedTrack,
  onSelectTrack,
  onLoadTrack,
  onNudgeBeatgrid,
  onSetDownbeat,
  onEnterTagEditMode,
  onEnterEnergyEditMode,
  isEnergyEditMode,
}: {
  tracks: Track[];
  selectedTrack: Track | null;
  onSelectTrack: (track: Track | null) => void;
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
    tracks,
    selectedTrack,
    onSelectTrack,
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
