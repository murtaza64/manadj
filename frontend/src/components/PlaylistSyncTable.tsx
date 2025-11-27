import type { UnifiedPlaylist } from '../types';
import { PlaylistSyncRow } from './PlaylistSyncRow';

interface PlaylistSyncTableProps {
  playlists: UnifiedPlaylist[];
  onPlaylistClick: (playlistName: string) => void;
}

export function PlaylistSyncTable({ playlists, onPlaylistClick }: PlaylistSyncTableProps) {
  return (
    <div className="playlist-sync-table-container">
      <table className="playlist-sync-table">
        <thead>
          <tr className="playlist-sync-header-row">
            <th>Playlist Name</th>
            <th>manadj</th>
            <th>Engine</th>
            <th>Rekordbox</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {playlists.map((playlist) => (
            <PlaylistSyncRow
              key={playlist.name}
              playlist={playlist}
              onClick={onPlaylistClick}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
