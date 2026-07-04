/**
 * Client-side, view-only sorting for playlist tables (playlist-editing 04).
 *
 * Play order is the playlist's persisted ordering; sorting here only
 * changes what is displayed and never rewrites it (CONTEXT.md: Play order).
 * 'position' sorts by the API's play order (the identity permutation, or
 * its reverse for desc).
 */

import type { Track } from '../types';

export type PlaylistSortColumn =
  | 'position'
  | 'key'
  | 'bpm'
  | 'energy'
  | 'title'
  | 'artist'
  | 'created_at'
  | 'bitrate_kbps'
  | 'filesize_bytes'
  | 'provenance';

export interface PlaylistSort {
  column: PlaylistSortColumn;
  direction: 'asc' | 'desc';
}

export const PLAY_ORDER_SORT: PlaylistSort = { column: 'position', direction: 'asc' };

/** True when the table is showing actual Play order — the only state in
 * which drag-reordering is meaningful. */
export function isPlayOrderSort(sort: PlaylistSort): boolean {
  return sort.column === 'position' && sort.direction === 'asc';
}

function sortValue(track: Track, column: PlaylistSortColumn): string | number | null {
  switch (column) {
    case 'position':
      return null; // handled by index
    case 'key':
      return track.key ?? null;
    case 'bpm':
      return track.bpm ?? null;
    case 'energy':
      return track.energy ?? null;
    case 'title':
      return track.title?.toLowerCase() ?? null;
    case 'artist':
      return track.artist?.toLowerCase() ?? null;
    case 'created_at':
      return track.created_at ?? null;
    case 'bitrate_kbps':
      return track.bitrate_kbps ?? null;
    case 'filesize_bytes':
      return track.filesize_bytes ?? null;
    case 'provenance':
      return track.provenance?.label?.toLowerCase() ?? null;
  }
}

/**
 * Return a sorted copy of `tracks` (given in play order). Nulls sort last
 * regardless of direction; ties keep play order (stable).
 */
export function sortPlaylistTracks(tracks: readonly Track[], sort: PlaylistSort): Track[] {
  if (sort.column === 'position') {
    return sort.direction === 'asc' ? [...tracks] : [...tracks].reverse();
  }
  const indexed = tracks.map((track, index) => ({ track, index }));
  const dir = sort.direction === 'asc' ? 1 : -1;
  indexed.sort((a, b) => {
    const va = sortValue(a.track, sort.column);
    const vb = sortValue(b.track, sort.column);
    if (va === null && vb === null) return a.index - b.index;
    if (va === null) return 1;
    if (vb === null) return -1;
    if (va < vb) return -dir;
    if (va > vb) return dir;
    return a.index - b.index;
  });
  return indexed.map((x) => x.track);
}

/** Header-click state machine: same column toggles, new column starts
 * fresh ('#' ascending — play order; value columns descending). */
export function nextPlaylistSort(current: PlaylistSort, column: PlaylistSortColumn): PlaylistSort {
  if (current.column === column) {
    return { column, direction: current.direction === 'asc' ? 'desc' : 'asc' };
  }
  return { column, direction: column === 'position' ? 'asc' : 'desc' };
}
