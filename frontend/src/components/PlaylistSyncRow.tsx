import type { UnifiedPlaylist } from '../types';
import type { PlaylistStatus } from './PlaylistStatusBadge';
import { PlaylistStatusBadge } from './PlaylistStatusBadge';
import './PlaylistSyncRow.css';

interface PlaylistSyncRowProps {
  playlist: UnifiedPlaylist;
  onClick: (playlistName: string) => void;
}

function getPlaylistStatus(playlist: UnifiedPlaylist): PlaylistStatus {
  const sources = [playlist.manadj, playlist.engine, playlist.rekordbox];
  const nonNullSources = sources.filter(s => s !== null);

  // Only one source = partial
  if (nonNullSources.length === 1) return 'partial';

  // Multiple sources - check if synced
  return playlist.synced ? 'synced' : 'unsynced';
}

export function PlaylistSyncRow({ playlist, onClick }: PlaylistSyncRowProps) {
  const status = getPlaylistStatus(playlist);

  return (
    <tr
      className="playlist-sync-row playlist-sync-row-clickable"
      onClick={() => onClick(playlist.name)}
      style={{ cursor: 'pointer' }}
    >
      <td className="playlist-sync-cell playlist-name-cell">
        <span className="playlist-name-text">{playlist.name}</span>
      </td>
      <td className="playlist-sync-cell track-count-cell">
        {playlist.manadj ? playlist.manadj.length : '-'}
      </td>
      <td className="playlist-sync-cell track-count-cell">
        {playlist.engine ? playlist.engine.length : '-'}
      </td>
      <td className="playlist-sync-cell track-count-cell">
        {playlist.rekordbox ? playlist.rekordbox.length : '-'}
      </td>
      <td className="playlist-sync-cell status-cell">
        <PlaylistStatusBadge status={status} />
      </td>
    </tr>
  );
}
