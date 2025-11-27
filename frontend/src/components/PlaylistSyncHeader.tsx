import type { PlaylistSyncStats } from '../types';

interface PlaylistSyncHeaderProps {
  stats: PlaylistSyncStats | undefined;
}

export function PlaylistSyncHeader({ stats }: PlaylistSyncHeaderProps) {
  if (!stats) return null;

  return (
    <div className="playlist-sync-header">
      <h1>Playlist Sync Status</h1>
      <div className="sync-stats">
        <div className="sync-stat">
          <span className="sync-stat-label">manadj:</span>
          <span className="sync-stat-value">{stats.manadj_playlists_loaded}</span>
        </div>
        <span className="sync-stat-divider">|</span>
        <div className="sync-stat">
          <span className="sync-stat-label">Engine DJ:</span>
          <span className="sync-stat-value">{stats.engine_playlists_loaded}</span>
        </div>
        <span className="sync-stat-divider">|</span>
        <div className="sync-stat">
          <span className="sync-stat-label">Rekordbox:</span>
          <span className="sync-stat-value">{stats.rekordbox_playlists_loaded}</span>
        </div>
        <span className="sync-stat-divider">|</span>
        <div className="sync-stat">
          <span className="sync-stat-label">Total:</span>
          <span className="sync-stat-value">{stats.playlists_matched}</span>
        </div>
      </div>
    </div>
  );
}
