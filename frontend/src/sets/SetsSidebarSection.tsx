/**
 * The sidebar's Sets section (sets 01): Sets are sidebar siblings of
 * Playlists — own section, own colors, "+ new set". Rendered by
 * PlaylistSidebar under the playlist list; selecting a Set swaps the
 * browse surface's main pane to the Set detail view.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { SetRowWire } from '../api/client';
import { isTrackDrag, readTrackDragPayload } from '../selection/trackDrag';
import ContextMenu, { useContextMenuState, type MenuItem } from '../components/ContextMenu';
import { useToast } from '../components/Toast';
import { addTracksToSet, dropSetLocalState } from './setStore';
import { createPlaylistFromSet } from './playlistFlows';

/** Same bright, fully saturated palette as playlists (repo preference). */
const SET_COLORS: Array<{ label: string; value: string }> = [
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

interface SetsSidebarSectionProps {
  selectedSetId: number | null;
  onSelectSet: (id: number) => void;
  /** The selected Set was deleted — eject the view (parent decides where). */
  onSelectedSetDeleted: () => void;
}

export default function SetsSidebarSection({
  selectedSetId,
  onSelectSet,
  onSelectedSetDeleted,
}: SetsSidebarSectionProps) {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [dragOverSetId, setDragOverSetId] = useState<number | null>(null);

  const { data: sets = [] } = useQuery({ queryKey: ['sets'], queryFn: api.sets.list });

  const createMutation = useMutation({
    mutationFn: (name: string) => api.sets.create({ name }),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['sets'] });
      setIsCreating(false);
      setNewName('');
      onSelectSet(created.id);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { name?: string; color?: string } }) =>
      api.sets.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sets'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: api.sets.delete,
    onSuccess: (_data, deletedId) => {
      queryClient.invalidateQueries({ queryKey: ['sets'] });
      const wasSelected = selectedSetId === deletedId;
      dropSetLocalState(deletedId);
      if (wasSelected) onSelectedSetDeleted();
    },
  });

  const commitCreate = () => {
    if (newName.trim()) createMutation.mutate(newName.trim());
  };

  const commitRename = (set: SetRowWire) => {
    const name = renameDraft.trim();
    if (name && name !== set.name) {
      updateMutation.mutate({ id: set.id, data: { name } });
    }
    setRenamingId(null);
  };

  const { menu, openMenu, closeMenu } = useContextMenuState<SetRowWire>();
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
          submenu: SET_COLORS.map((c) => ({
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
            if (confirm(`Delete set "${menu.context.name}"? Tracks and transitions stay.`)) {
              deleteMutation.mutate(menu.context.id);
            }
          },
        },
        // Sets 11: escape hatch to Export — one-time copy of the track
        // order into an ordinary Playlist (Sets themselves never Export).
        {
          label: 'Create playlist from set',
          separatorBefore: true,
          onSelect: () => {
            void createPlaylistFromSet(menu.context).then((playlist) => {
              queryClient.invalidateQueries({ queryKey: ['playlists'] });
              showToast(`Playlist "${playlist.name}" created from set`);
            });
          },
        },
      ]
    : [];

  // Tracks dropped on a Set row append (skips already-present tracks —
  // a Track appears at most once per Set).
  const handleRowDrop = async (e: React.DragEvent, setId: number) => {
    e.preventDefault();
    setDragOverSetId(null);
    const trackIds = readTrackDragPayload(e.dataTransfer);
    if (trackIds.length === 0) return;
    const skipped = await addTracksToSet(setId, trackIds);
    if (skipped > 0) {
      showToast(skipped === 1 ? '1 track already in set' : `${skipped} tracks already in set`);
    }
  };

  return (
    <>
      <div style={{ borderTop: '1px solid var(--surface0)' }}>
        <div
          style={{
            padding: '6px 12px 2px',
            fontSize: '11px',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: 'var(--subtext0)',
          }}
        >
          Sets
        </div>
        {sets.map((set) => (
          <div
            key={set.id}
            data-set-row
            onClick={() => onSelectSet(set.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              openMenu(e.clientX, e.clientY, set);
            }}
            onDragOver={(e) => {
              if (!isTrackDrag(e.dataTransfer)) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
              setDragOverSetId(set.id);
            }}
            onDragLeave={() => setDragOverSetId((cur) => (cur === set.id ? null : cur))}
            onDrop={(e) => void handleRowDrop(e, set.id)}
            style={{
              padding: '8px 12px',
              cursor: 'pointer',
              background:
                dragOverSetId === set.id
                  ? 'var(--surface1)'
                  : selectedSetId === set.id
                    ? 'var(--surface0)'
                    : 'transparent',
              color: 'var(--text)',
              borderLeft: set.color ? `3px solid ${set.color}` : 'none',
            }}
          >
            {renamingId === set.id ? (
              <input
                type="text"
                value={renameDraft}
                autoFocus
                onChange={(e) => setRenameDraft(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename(set);
                  if (e.key === 'Escape') setRenamingId(null);
                }}
                onBlur={() => commitRename(set)}
                style={{
                  width: '100%',
                  padding: '2px 6px',
                  background: 'var(--surface0)',
                  border: '1px solid var(--surface1)',
                  color: 'var(--text)',
                  fontSize: 'inherit',
                }}
              />
            ) : (
              <span>{set.name}</span>
            )}
          </div>
        ))}

        <div style={{ padding: '4px 8px 8px' }}>
          {isCreating ? (
            <div style={{ display: 'flex', gap: '4px' }}>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitCreate();
                  if (e.key === 'Escape') {
                    setIsCreating(false);
                    setNewName('');
                  }
                }}
                placeholder="Set name"
                autoFocus
                style={{
                  flex: 1,
                  minWidth: 0,
                  padding: '4px 8px',
                  background: 'var(--surface0)',
                  border: '1px solid var(--surface1)',
                  color: 'var(--text)',
                }}
              />
              <button
                onClick={commitCreate}
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
              + New Set
            </button>
          )}
        </div>
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={closeMenu} />}
    </>
  );
}
