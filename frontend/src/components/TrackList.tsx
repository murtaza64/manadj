import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import TrackRow from './TrackRow';
import FilterBar from './FilterBar';
import TagEditor from './TagEditor';
import GlobalControls from './GlobalControls';
import Player, { type PlayerHandle } from './Player';
import PlaylistSidebar from './PlaylistSidebar';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { MusicIcon, PersonIcon, KeyIcon, SpeedIcon, EnergyIcon, TagIcon } from './icons';
import type { Track } from '../types';
import { formatKeyDisplay } from '../utils/keyUtils';
import { useFilters } from '../contexts/FilterContext';

// Related tracks feature - types and constants
export interface RelatedTracksSettings {
  harmonicKeys: boolean;
  bpm: boolean;
  bpmThresholdPercent: number;
  tags: boolean;
  tagMatchMode: 'ANY' | 'ALL';
  energy: boolean;
  energyPreset: 'up' | 'down' | 'near' | 'equal';
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

export default function TrackList() {
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<number | null>(null);
  const queryClient = useQueryClient();
  const playerRef = useRef<PlayerHandle>(null);
  const { filters, setFilters } = useFilters();

  // Fetch all tracks (when no playlist selected)
  const { data: allTracksData, isLoading: isLoadingAllTracks, error: allTracksError } = useQuery({
    queryKey: ['tracks', filters],
    queryFn: () => api.tracks.list(1, 1000, {
      tagIds: filters.selectedTagIds,
      search: filters.search,
      energyMin: filters.energyMin,
      energyMax: filters.energyMax,
      tagMatchMode: filters.tagMatchMode,
      bpmCenter: filters.bpmCenter,
      bpmThresholdPercent: filters.bpmCenter !== null ? filters.bpmThresholdPercent : null,
      keyCamelotIds: filters.selectedKeyCamelotIds,
    }),
    enabled: selectedPlaylistId === null,
  });

  // Fetch playlist tracks (when playlist selected)
  const { data: playlistData, isLoading: isLoadingPlaylist, error: playlistError } = useQuery({
    queryKey: ['playlist', selectedPlaylistId],
    queryFn: () => api.playlists.get(selectedPlaylistId!),
    enabled: selectedPlaylistId !== null,
  });

  // Add track to playlist mutation
  const addToPlaylistMutation = useMutation({
    mutationFn: ({ playlistId, trackId }: { playlistId: number; trackId: number }) =>
      api.playlists.addTrack(playlistId, { track_id: trackId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['playlist'] });
    },
  });

  const mutation = useMutation({
    mutationFn: (data: { energy?: number; tag_ids?: number[] }) => {
      if (!selectedTrack) return Promise.reject();
      return api.tracks.update(selectedTrack.id, data);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['tracks'] });
      await queryClient.invalidateQueries({ queryKey: ['playlist'] });

      if (selectedTrack) {
        const currentData = selectedPlaylistId === null ? allTracksData : playlistData;
        const items = selectedPlaylistId === null ? currentData?.items : currentData?.tracks;
        const updatedTrack = items?.find((t: Track) => t.id === selectedTrack.id);
        if (updatedTrack) {
          setSelectedTrack(updatedTrack);
        }
      }
    },
  });

  const handleTrackDrop = (playlistId: number, trackId: number) => {
    addToPlaylistMutation.mutate({ playlistId, trackId });
  };

  const handleFieldUpdate = async (trackId: number, field: 'title' | 'artist', value: string) => {
    try {
      // Optimistically update selectedTrack immediately
      if (selectedTrack && selectedTrack.id === trackId) {
        setSelectedTrack({
          ...selectedTrack,
          [field]: value
        });
      }

      await api.tracks.update(trackId, { [field]: value });
      await queryClient.invalidateQueries({ queryKey: ['tracks'] });
      await queryClient.invalidateQueries({ queryKey: ['playlist'] });
    } catch (error) {
      console.error('Failed to update track:', error);
      // Revert optimistic update on error by refetching
      queryClient.invalidateQueries({ queryKey: ['tracks'] });
      queryClient.invalidateQueries({ queryKey: ['playlist'] });
    }
  };

  const handleFindRelated = () => {
    if (!selectedTrack) return;

    const settings = loadSettings();
    const newFilters = deriveRelatedFilters(selectedTrack, settings);

    // REPLACE all filters
    setFilters(newFilters);
  };

  const handleApplySettings = (settings: RelatedTracksSettings) => {
    if (!selectedTrack) return;

    // Save settings and apply filters
    saveSettings(settings);
    const newFilters = deriveRelatedFilters(selectedTrack, settings);
    setFilters(newFilters);
  };

  // Determine current tracks and loading state
  const isLoading = selectedPlaylistId === null ? isLoadingAllTracks : isLoadingPlaylist;
  const error = selectedPlaylistId === null ? allTracksError : playlistError;
  const currentTracks = selectedPlaylistId === null
    ? allTracksData?.items || []
    : playlistData?.tracks || [];
  const totalTracks = selectedPlaylistId === null ? allTracksData?.total || 0 : playlistData?.tracks?.length || 0;

  // Enable keyboard shortcuts
  useKeyboardShortcuts({
    tracks: currentTracks,
    selectedTrack,
    onSelectTrack: setSelectedTrack,
    playerRef
  });

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--mantle)'
    }}>
      {/* Waveform at top (full width), controls and editor below */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        borderBottom: '1px solid var(--surface0)'
      }}>
        <Player ref={playerRef} track={selectedTrack} />
        <div style={{
          display: 'flex'
        }}>
          <TagEditor
            track={selectedTrack}
            onSave={mutation.mutate}
            onUpdate={handleFieldUpdate}
          />
        </div>
      </div>
      <GlobalControls
        selectedTrack={selectedTrack}
        onFindRelated={handleFindRelated}
        onApplySettings={handleApplySettings}
      />

      {/* Library section with sidebar */}
      <div style={{
        flex: 1,
        display: 'flex',
        overflow: 'hidden'
      }}>
        {/* Sidebar */}
        <PlaylistSidebar
          selectedPlaylistId={selectedPlaylistId}
          onSelectPlaylist={setSelectedPlaylistId}
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
          />

          {/* Track table */}
          <div style={{
            flex: 1,
            overflow: 'auto'
          }}>
          {isLoading ? (
            <div style={{ padding: '20px', color: 'var(--subtext1)' }}>Loading tracks...</div>
          ) : error ? (
            <div style={{ padding: '20px', color: 'var(--red)' }}>Error loading tracks</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
              <thead style={{ borderBottom: '1px solid var(--surface0)', position: 'sticky', top: 0, background: 'var(--mantle)' }}>
                <tr>
                  <th style={{ textAlign: 'right', padding: '6px 12px', width: '35px' }}><KeyIcon /></th>
                  <th style={{ textAlign: 'left', padding: '6px 12px', width: '35px' }}><SpeedIcon /></th>
                  <th style={{ textAlign: 'left', padding: '6px 4px', width: '20px' }}><EnergyIcon /></th>
                  <th style={{ textAlign: 'left', padding: '6px 12px', width: '180px' }}><MusicIcon /></th>
                  <th style={{ textAlign: 'left', padding: '6px 12px', width: '180px' }}><PersonIcon /></th>
                  <th style={{ textAlign: 'left', padding: '6px 12px', width: '300px' }}><TagIcon /></th>
                </tr>
              </thead>
              <tbody>
                {currentTracks.map((track: Track) => (
                  <TrackRow
                    key={track.id}
                    track={track}
                    isSelected={selectedTrack?.id === track.id}
                    onSelect={setSelectedTrack}
                  />
                ))}
              </tbody>
            </table>
          )}
          </div>
        </div>
      </div>
    </div>
  );
}
