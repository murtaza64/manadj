import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { PlaylistSyncHeader } from './PlaylistSyncHeader';
import { PlaylistSyncTable } from './PlaylistSyncTable';
import { PlaylistDetailView } from './PlaylistDetailView';
import './PlaylistSync.css';

interface PlaylistSyncProps {
  onClose: () => void;
}

export function PlaylistSync({ onClose }: PlaylistSyncProps) {
  const [selectedPlaylistName, setSelectedPlaylistName] = useState<string | null>(null);
  const { data: playlists, isLoading, error } = useQuery({
    queryKey: ['playlistSync'],
    queryFn: api.playlistSync.getUnified,
    refetchInterval: 30000, // Auto-refresh every 30s
  });

  const { data: stats } = useQuery({
    queryKey: ['playlistSyncStats'],
    queryFn: api.playlistSync.getStats,
    refetchInterval: 30000,
  });

  if (isLoading) {
    return (
      <div className="playlist-sync-content">
        <div className="playlist-sync-stats-bar">
          <PlaylistSyncHeader stats={undefined} />
        </div>
        <div className="playlist-sync-table-container">
          <div className="playlist-sync-loading">Loading playlist sync data...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="playlist-sync-content">
        <div className="playlist-sync-error">
          Error loading playlists: {error instanceof Error ? error.message : 'Unknown error'}
        </div>
      </div>
    );
  }

  if (!playlists) {
    return (
      <div className="playlist-sync-content">
        <div className="playlist-sync-loading">No playlist data available</div>
      </div>
    );
  }

  // Find selected playlist
  const selectedPlaylist = selectedPlaylistName
    ? playlists.find(p => p.name === selectedPlaylistName)
    : null;

  // Show detail view if playlist selected
  if (selectedPlaylist) {
    return (
      <PlaylistDetailView
        playlist={selectedPlaylist}
        onBack={() => setSelectedPlaylistName(null)}
        onClose={onClose}
      />
    );
  }

  return (
    <div className="playlist-sync-content">
      <div className="playlist-sync-stats-bar">
        <PlaylistSyncHeader stats={stats} />
      </div>
      <PlaylistSyncTable
        playlists={playlists}
        onPlaylistClick={setSelectedPlaylistName}
      />
    </div>
  );
}
