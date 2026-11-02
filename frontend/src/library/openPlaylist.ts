import { updateBrowseSession } from '../components/browseStore';
import { selectSet } from '../sets/setStore';
import { selectSession } from '../sessions/openSession';

export const OPEN_LIBRARY_PLAYLIST_EVENT = 'manadj:open-library-playlist';
export interface LibraryPlaylistRequest { id: number; name: string; openExport: boolean }
let pending: LibraryPlaylistRequest | null = null;

export function requestLibraryPlaylist(request: LibraryPlaylistRequest): void {
  pending = request;
  selectSet(null);
  selectSession(null);
  updateBrowseSession({ view: 'playlist', playlistId: request.id });
  window.dispatchEvent(new CustomEvent(OPEN_LIBRARY_PLAYLIST_EVENT));
}

export function peekLibraryPlaylistRequest(): LibraryPlaylistRequest | null { return pending; }
export function clearLibraryPlaylistRequest(): void {
  pending = null;
  window.dispatchEvent(new CustomEvent(OPEN_LIBRARY_PLAYLIST_EVENT));
}
