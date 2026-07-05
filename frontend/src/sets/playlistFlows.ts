/**
 * Playlist ↔ Set conveniences (sets 11) — both one-time copies, no live
 * link in either direction: later edits on either side never propagate.
 *
 * - New Set from Playlist: copies the Playlist's Play order into a new
 *   Set (entries unpinned — pins arrive via the auto-fill offer the Set
 *   view already presents for every adjacency with library Transitions).
 * - Create Playlist from Set: copies the Set's track order into a new
 *   ordinary Playlist — the escape hatch to Export (Sets never Export;
 *   external libraries have no transition concept).
 */
import { api, type SetRowWire } from '../api/client';
import type { Playlist, PlaylistWithTracks } from '../types';
import { ensureSetEntriesLoaded, getSetEntries, replaceSetEntries } from './setStore';

/** Copy a Playlist's Play order into a new Set (same name and color).
 * Returns the created Set row for selection. */
export async function createSetFromPlaylist(playlistId: number): Promise<SetRowWire> {
  const playlist: PlaylistWithTracks = await api.playlists.get(playlistId);
  const created = await api.sets.create({
    name: playlist.name,
    ...(playlist.color ? { color: playlist.color } : {}),
  });
  // Seed the store directly (client-authoritative, ADR 0011): the tracks
  // arrive in Play order; a Track appears at most once in a Playlist, so
  // the at-most-once Set invariant holds by construction.
  await ensureSetEntriesLoaded(created.id);
  replaceSetEntries(
    created.id,
    playlist.tracks.map((t) => ({ trackId: t.id, pin: null }))
  );
  return created;
}

/** Copy a Set's track order into a new ordinary Playlist (same name and
 * color), which Exports like any Playlist. Returns the created row. */
export async function createPlaylistFromSet(set: SetRowWire): Promise<Playlist> {
  await ensureSetEntriesLoaded(set.id);
  const entries = getSetEntries(set.id) ?? [];
  const created: Playlist = await api.playlists.create({
    name: set.name,
    ...(set.color ? { color: set.color } : {}),
  });
  // Sequential appends preserve the Set's order (position null = append).
  for (const entry of entries) {
    await api.playlists.addTrack(created.id, { track_id: entry.trackId });
  }
  return created;
}
