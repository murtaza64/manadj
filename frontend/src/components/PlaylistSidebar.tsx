import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { readTrackDragPayload } from '../selection/trackDrag';
import ContextMenu, { useContextMenuState, type MenuItem } from './ContextMenu';
import type { Playlist } from '../types';

type ViewType = 'all' | 'unprocessed' | 'playlist';

/** Palette for "Change color ▸" — bright, fully saturated (repo preference). */
const PLAYLIST_COLORS: Array<{ label: string; value: string }> = [
  { label: 'Red', value: '#ff0000' },
  { label: 'Orange', value: '#ff8000' },
  { label: 'Yellow', value: '#ffee00' },
  { label: 'Green', value: '#00e600' },
  { label: 'Teal', value: '#00e6b8' },
  { label: 'Cyan', value: '#00d0ff' },
  { label: 'Blue', value: '#0055ff' },
  { label: 'Purple', value: '#9500ff' },
  { label: 'Magenta', value: '#ff00ff' },
  { label: 'Pink', value: '#ff0080' },
];

interface PlaylistSidebarProps {
  selectedView: ViewType;
  selectedPlaylistId: number | null;
  onSelectView: (view: ViewType) => void;
  onSelectPlaylist: (playlistId: number) => void;
  /** Tracks dropped onto a playlist row (whole selection, selection order). */
  onTrackDrop: (playlistId: number, trackIds: number[]) => void;
}

export default function PlaylistSidebar({
  selectedView,
  selectedPlaylistId,
  onSelectView,
  onSelectPlaylist,
  onTrackDrop,
}: PlaylistSidebarProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  // Inline rename (playlist-editing 07): which row is being renamed + draft.
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
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

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { name?: string; color?: string } }) =>
      api.playlists.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['playlists'] });
      queryClient.invalidateQueries({ queryKey: ['playlist'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: api.playlists.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['playlists'] });
      if (selectedView === 'playlist') {
        onSelectView('all');
      }
    },
  });

  const handleCreateClick = () => {
    if (newPlaylistName.trim()) {
      createMutation.mutate(newPlaylistName.trim());
    }
  };

  // ── Playlist row context menu (playlist-editing 07) ────────────────────
  const { menu, openMenu, closeMenu } = useContextMenuState<Playlist>();

  const commitRename = (playlist: Playlist) => {
    const name = renameDraft.trim();
    if (name && name !== playlist.name) {
      updateMutation.mutate({ id: playlist.id, data: { name } });
    }
    setRenamingId(null);
  };

  const menuItems: MenuItem[] = menu
    ? [
        {
          label: 'Rename',
          onSelect: () => {
            setRenameDraft(menu.context.name);
            setRenamingId(menu.context.id);
          },
        },
        {
          label: 'Change color',
          submenu: PLAYLIST_COLORS.map((c) => ({
            label: c.label,
            swatch: c.value,
            onSelect: () => updateMutation.mutate({ id: menu.context.id, data: { color: c.value } }),
          })),
        },
        {
          label: 'Delete',
          danger: true,
          separatorBefore: true,
          onSelect: () => {
            if (confirm(`Delete playlist "${menu.context.name}"?`)) {
              deleteMutation.mutate(menu.context.id);
            }
          },
        },
      ]
    : [];

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleDrop = (e: React.DragEvent, playlistId: number) => {
    e.preventDefault();
    const trackIds = readTrackDragPayload(e.dataTransfer);
    if (trackIds.length > 0) {
      onTrackDrop(playlistId, trackIds);
    }
  };

  return (
    <>
      <div style={{
        width: '200px',
        background: 'var(--crust)',
        borderRight: '1px solid var(--surface0)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
      {/* "All tracks" special view (brand/sync/mode switch live in the TopBar) */}
      <div
        onClick={() => onSelectView('all')}
        style={{
          padding: '8px 12px',
          cursor: 'pointer',
          background: selectedView === 'all' ? 'var(--surface0)' : 'transparent',
          color: 'var(--text)',
          borderBottom: '1px solid var(--surface0)',
        }}
      >
        All tracks
      </div>

      {/* "Unprocessed" special view */}
      <div
        onClick={() => onSelectView('unprocessed')}
        style={{
          padding: '8px 12px',
          cursor: 'pointer',
          background: selectedView === 'unprocessed' ? 'var(--surface0)' : 'transparent',
          color: 'var(--text)',
          borderBottom: '1px solid var(--surface0)',
        }}
      >
        Unprocessed
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
              onContextMenu={(e) => {
                e.preventDefault();
                openMenu(e.clientX, e.clientY, playlist);
              }}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, playlist.id)}
              style={{
                padding: '8px 12px',
                cursor: 'pointer',
                background: selectedView === 'playlist' && selectedPlaylistId === playlist.id ? 'var(--surface0)' : 'transparent',
                color: 'var(--text)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                borderLeft: playlist.color ? `3px solid ${playlist.color}` : 'none',
              }}
            >
              {renamingId === playlist.id ? (
                <input
                  type="text"
                  value={renameDraft}
                  autoFocus
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename(playlist);
                    if (e.key === 'Escape') setRenamingId(null);
                  }}
                  onBlur={() => commitRename(playlist)}
                  style={{
                    flex: 1,
                    padding: '2px 6px',
                    background: 'var(--surface0)',
                    border: '1px solid var(--surface1)',
                    color: 'var(--text)',
                    fontSize: 'inherit',
                  }}
                />
              ) : (
                <span>{playlist.name}</span>
              )}
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

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={closeMenu} />}
    </>
  );
}
