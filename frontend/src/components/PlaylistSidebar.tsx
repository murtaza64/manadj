import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Playlist } from '../types';

interface PlaylistSidebarProps {
  selectedPlaylistId: number | null;
  onSelectPlaylist: (playlistId: number | null) => void;
  onTrackDrop: (playlistId: number, trackId: number) => void;
}

export default function PlaylistSidebar({
  selectedPlaylistId,
  onSelectPlaylist,
  onTrackDrop,
}: PlaylistSidebarProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const queryClient = useQueryClient();

  const { data: playlists = [], isLoading } = useQuery({
    queryKey: ['playlists'],
    queryFn: api.playlists.list,
  });

  const createMutation = useMutation({
    mutationFn: (name: string) => api.playlists.create({ name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['playlists'] });
      setIsCreating(false);
      setNewPlaylistName('');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: api.playlists.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['playlists'] });
      if (selectedPlaylistId) {
        onSelectPlaylist(null);
      }
    },
  });

  const handleCreateClick = () => {
    if (newPlaylistName.trim()) {
      createMutation.mutate(newPlaylistName.trim());
    }
  };

  const handleDelete = (e: React.MouseEvent, playlistId: number) => {
    e.stopPropagation();
    if (confirm('Delete this playlist?')) {
      deleteMutation.mutate(playlistId);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleDrop = (e: React.DragEvent, playlistId: number) => {
    e.preventDefault();
    const trackId = parseInt(e.dataTransfer.getData('trackId'), 10);
    if (trackId) {
      onTrackDrop(playlistId, trackId);
    }
  };

  return (
    <div style={{
      width: '200px',
      background: 'var(--crust)',
      borderRight: '1px solid var(--surface0)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '12px',
        borderBottom: '1px solid var(--surface0)',
        fontWeight: 'bold',
        color: 'var(--text)',
      }}>
        Playlists
      </div>

      {/* "All tracks" special view */}
      <div
        onClick={() => onSelectPlaylist(null)}
        style={{
          padding: '8px 12px',
          cursor: 'pointer',
          background: selectedPlaylistId === null ? 'var(--surface0)' : 'transparent',
          color: 'var(--text)',
          borderBottom: '1px solid var(--surface0)',
        }}
      >
        All tracks
      </div>

      {/* Playlist list */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {isLoading ? (
          <div style={{ padding: '8px 12px', color: 'var(--subtext1)' }}>Loading...</div>
        ) : (
          playlists.map((playlist: Playlist) => (
            <div
              key={playlist.id}
              onClick={() => onSelectPlaylist(playlist.id)}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, playlist.id)}
              style={{
                padding: '8px 12px',
                cursor: 'pointer',
                background: selectedPlaylistId === playlist.id ? 'var(--surface0)' : 'transparent',
                color: 'var(--text)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                borderLeft: playlist.color ? `3px solid ${playlist.color}` : 'none',
              }}
            >
              <span>{playlist.name}</span>
              <button
                onClick={(e) => handleDelete(e, playlist.id)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--red)',
                  cursor: 'pointer',
                  padding: '2px 6px',
                }}
              >
                ×
              </button>
            </div>
          ))
        )}
      </div>

      {/* Create new playlist */}
      <div style={{
        padding: '8px',
        borderTop: '1px solid var(--surface0)',
      }}>
        {isCreating ? (
          <div style={{ display: 'flex', gap: '4px' }}>
            <input
              type="text"
              value={newPlaylistName}
              onChange={(e) => setNewPlaylistName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateClick()}
              placeholder="Playlist name"
              autoFocus
              style={{
                flex: 1,
                padding: '4px 8px',
                background: 'var(--surface0)',
                border: '1px solid var(--surface1)',
                color: 'var(--text)',
              }}
            />
            <button
              onClick={handleCreateClick}
              style={{
                padding: '4px 8px',
                background: 'var(--green)',
                color: 'var(--base)',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              ✓
            </button>
            <button
              onClick={() => {
                setIsCreating(false);
                setNewPlaylistName('');
              }}
              style={{
                padding: '4px 8px',
                background: 'var(--red)',
                color: 'var(--base)',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              ✗
            </button>
          </div>
        ) : (
          <button
            onClick={() => setIsCreating(true)}
            style={{
              width: '100%',
              padding: '6px',
              background: 'var(--surface0)',
              border: '1px solid var(--surface1)',
              color: 'var(--text)',
              cursor: 'pointer',
            }}
          >
            + New Playlist
          </button>
        )}
      </div>
    </div>
  );
}
