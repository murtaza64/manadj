import type { UnifiedPlaylist } from '../types';
import { PlaylistStatusBadge } from './PlaylistStatusBadge';
import { playlistStatus } from './playlistStatus';
import './PlaylistSyncRow.css';

interface PlaylistSyncRowProps {
  playlist: UnifiedPlaylist;
  onClick: (playlistName: string) => void;
}

export function PlaylistSyncRow({ playlist, onClick }: PlaylistSyncRowProps) {
  const status = playlistStatus(playlist);

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
