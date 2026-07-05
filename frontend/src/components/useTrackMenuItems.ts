/**
 * The universal track menu as a hook (sets 17): wraps the pure core
 * (`trackMenuItems`) with the playlist/set queries, add actions with
 * their skip toasts, and the archive/unarchive mutations — including
 * the playlist-membership confirm and the full invalidation set
 * (['tracks'], ['playlist'], ['sets'] — sets 12: a Set containing an
 * archived Track is flagged, not altered). Deliberately thin: all
 * menu-shape logic lives in the core, which carries the vitest suite.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { addTracksToSet } from '../sets/setStore';
import type { MenuItem } from './ContextMenu';
import { useToast } from './Toast';
import { trackMenuItems, type TrackMenuInput } from './trackMenu';

export type UseTrackMenuItemsOpts = Pick<
  TrackMenuInput,
  'tracks' | 'excludeSetId' | 'excludePlaylistId' | 'loadToDeck' | 'surfaceItems'
>;

/** Append tracks to a playlist — sequential appends in selection order;
 * duplicates are idempotent no-ops server-side (entry identity),
 * reported with a toast. Shared by the menu and Library's drag-drops. */
export function useAddTracksToPlaylist() {
  const queryClient = useQueryClient();
  const showToast = useToast();
  return useMutation({
    mutationFn: async ({ playlistId, trackIds }: { playlistId: number; trackIds: number[] }) => {
      let skipped = 0;
      for (const trackId of trackIds) {
        const result = await api.playlists.addTrack(playlistId, { track_id: trackId });
        if (result.skipped) skipped += 1;
      }
      return skipped;
    },
    onSuccess: (skipped) => {
      queryClient.invalidateQueries({ queryKey: ['playlist'] });
      if (skipped > 0) {
        showToast(
          skipped === 1 ? '1 track already in playlist' : `${skipped} tracks already in playlist`
        );
      }
    },
  });
}

export function useTrackMenuItems(opts: UseTrackMenuItemsOpts): MenuItem[] {
  const queryClient = useQueryClient();
  const showToast = useToast();

  // Shares the sidebar's caches (sets 01).
  const { data: playlists = [] } = useQuery({
    queryKey: ['playlists'],
    queryFn: api.playlists.list,
  });
  const { data: sets = [] } = useQuery({ queryKey: ['sets'], queryFn: api.sets.list });

  const addToPlaylistMutation = useAddTracksToPlaylist();

  const addToSetWithToast = (setId: number, trackIds: number[]) => {
    void addTracksToSet(setId, trackIds).then((skipped) => {
      if (skipped > 0) {
        showToast(skipped === 1 ? '1 track already in set' : `${skipped} tracks already in set`);
      }
    });
  };

  // ── Archive / Unarchive (track-archival 01) ──────────────────────────
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
      queryClient.invalidateQueries({ queryKey: ['sets'] });
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
      queryClient.invalidateQueries({ queryKey: ['playlist'] });
      queryClient.invalidateQueries({ queryKey: ['sets'] });
    },
  });

  const archiveWithConfirm = async (trackIds: number[]) => {
    const memberships = (
      await Promise.all(trackIds.map((id) => api.tracks.getPlaylists(id)))
    ).reduce((n, memberOf) => n + memberOf.length, 0);
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

  return trackMenuItems({
    tracks: opts.tracks,
    playlists,
    sets,
    excludeSetId: opts.excludeSetId,
    excludePlaylistId: opts.excludePlaylistId,
    loadToDeck: opts.loadToDeck,
    surfaceItems: opts.surfaceItems,
    addToPlaylist: (playlistId, trackIds) => addToPlaylistMutation.mutate({ playlistId, trackIds }),
    addToSet: addToSetWithToast,
    archive: (trackIds) => void archiveWithConfirm(trackIds),
    unarchive: (trackIds) => unarchiveMutation.mutate(trackIds),
  });
}
