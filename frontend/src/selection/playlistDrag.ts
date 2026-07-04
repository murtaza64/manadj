/**
 * Playlist drag payload (playlist-editing 08): sidebar rows drag their
 * playlist for reordering. Distinct MIME from track drags so drop targets
 * can branch: playlist drag → insertion line; track drag → row highlight.
 */

export const PLAYLIST_MIME = 'application/x-manadj-playlist';

export function setPlaylistDragPayload(dt: DataTransfer, playlistId: number): void {
  dt.setData(PLAYLIST_MIME, String(playlistId));
  dt.effectAllowed = 'move';
}

/** Usable from dragover (payload data unreadable there). */
export function isPlaylistDrag(dt: DataTransfer): boolean {
  return dt.types.includes(PLAYLIST_MIME);
}

export function readPlaylistDragPayload(dt: DataTransfer): number | null {
  const id = parseInt(dt.getData(PLAYLIST_MIME), 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}
