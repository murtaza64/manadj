import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import TrackRow from './TrackRow';
import FilterBar from './FilterBar';
import TagEditor from './TagEditor';
import Player, { type PlayerHandle } from './Player';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import type { Track } from '../types';

export default function TrackList() {
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null);
  const queryClient = useQueryClient();
  const playerRef = useRef<PlayerHandle>(null);

  const [filters, setFilters] = useState({
    search: '',
    selectedTagIds: [] as number[],
    energyMin: 1,
    energyMax: 5,
    tagMatchMode: 'ANY' as 'ANY' | 'ALL',
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ['tracks', filters],
    queryFn: () => api.tracks.list(1, 1000, {
      tagIds: filters.selectedTagIds,
      search: filters.search,
      energyMin: filters.energyMin,
      energyMax: filters.energyMax,
      tagMatchMode: filters.tagMatchMode,
    }),
  });

  const mutation = useMutation({
    mutationFn: (data: { energy?: number; tag_ids?: number[] }) => {
      if (!selectedTrack) return Promise.reject();
      return api.tracks.update(selectedTrack.id, data);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['tracks'] });
      // Keep the track selected by re-fetching the updated track
      if (selectedTrack) {
        const updatedData = queryClient.getQueryData<{ items: Track[] }>(['tracks', filters]);
        const updatedTrack = updatedData?.items.find(t => t.id === selectedTrack.id);
        if (updatedTrack) {
          setSelectedTrack(updatedTrack);
        }
      }
    },
  });

  // Enable keyboard shortcuts
  useKeyboardShortcuts({
    tracks: data?.items || [],
    selectedTrack,
    onSelectTrack: setSelectedTrack,
    playerRef
  });

  const totalTracks = data?.total || 0;
  const filteredCount = data?.items?.length || 0;

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
          />
        </div>
      </div>
      <FilterBar
        onFilterChange={setFilters}
        totalTracks={totalTracks}
        filteredCount={filteredCount}
      />
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
                <th style={{ textAlign: 'left', padding: '6px 12px', width: '180px' }}>Title</th>
                <th style={{ textAlign: 'left', padding: '6px 12px', width: '180px' }}>Artist</th>
                <th style={{ textAlign: 'left', padding: '6px 12px', width: '40px' }}>Key</th>
                <th style={{ textAlign: 'left', padding: '6px 12px', width: '50px' }}>BPM</th>
                <th style={{ textAlign: 'left', padding: '6px 12px', width: '80px' }}>Energy</th>
                <th style={{ textAlign: 'left', padding: '6px 12px', width: '300px' }}>Tags</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((track: Track) => (
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
  );
}
