import type { UnifiedPlaylist } from '../types';
import type { PlaylistStatus } from './PlaylistStatusBadge';


export function playlistStatus(playlist: UnifiedPlaylist): PlaylistStatus {
  const sources = [playlist.manadj, playlist.engine, playlist.rekordbox];
  if (sources.filter(source => source !== null).length === 1) return 'partial';
  return playlist.synced ? 'synced' : 'unsynced';
}
