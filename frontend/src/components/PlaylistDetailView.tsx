import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { UnifiedPlaylist, Track, SyncResult } from '../types';
import './PlaylistDetailView.css';

interface PlaylistDetailViewProps {
  playlist: UnifiedPlaylist;
  onBack: () => void;
  onClose: () => void;
}

export function PlaylistDetailView({ playlist, onBack, onClose }: PlaylistDetailViewProps) {
  const [syncResult, setSyncResult] = useState<SyncResult | SyncResult[] | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  // Collect all manadj track IDs
  const manadjTrackIds = (playlist.manadj || [])
    .map(entry => entry.track_id)
    .filter((id): id is number => typeof id === 'number');

  // Fetch all manadj tracks in parallel
  const trackQueries = useQuery({
    queryKey: ['playlistDetailTracks', playlist.name, manadjTrackIds],
    queryFn: async () => {
      if (manadjTrackIds.length === 0) return [];
      const results = await Promise.all(
        manadjTrackIds.map(id => api.tracks.getById(id))
      );
      return results;
    },
    enabled: manadjTrackIds.length > 0,
  });

  // Create map of track_id -> Track for quick lookup
  const trackMap = new Map<number, Track>();
  if (trackQueries.data) {
    trackQueries.data.forEach(track => {
      trackMap.set(track.id, track);
    });
  }

  // Calculate max length across all columns
  const maxLength = Math.max(
    playlist.manadj?.length || 0,
    playlist.engine?.length || 0,
    playlist.rekordbox?.length || 0
  );

  // Check if track exists in manadj
  const isInManadj = (filename: string): boolean => {
    return (playlist.manadj || []).some(entry => entry.filename === filename);
  };

  // Sync mutation
  const syncMutation = useMutation({
    mutationFn: async ({ source, ignoreMissing }: { source: string, ignoreMissing: boolean }) => {
      return api.playlistSync.sync(playlist.name, {
        source,
        target: null,  // Sync to all targets
        ignore_missing_tracks: ignoreMissing,
        dry_run: false,
      });
    },
    onSuccess: (data) => {
      setSyncResult(data);
      setSyncError(null);
      // Invalidate queries to refresh the playlist data
      queryClient.invalidateQueries({ queryKey: ['playlistSync'] });
    },
    onError: (error: Error) => {
      setSyncError(error.message);
      setSyncResult(null);
    },
  });

  const handleSync = (source: string) => {
    // Check if there might be missing tracks
    const hasUnmatched = Array.isArray(syncResult)
      ? syncResult.some(r => r.tracks_unmatched.length > 0)
      : syncResult?.tracks_unmatched?.length > 0;

    // If we already tried and there are unmatched, ask user to confirm
    if (hasUnmatched && !syncResult) {
      // First attempt - don't ignore missing
      syncMutation.mutate({ source, ignoreMissing: false });
    } else if (hasUnmatched && syncResult) {
      // Second attempt - user confirmed, ignore missing
      if (confirm('Some tracks could not be matched. Proceed with partial sync?')) {
        syncMutation.mutate({ source, ignoreMissing: true });
      }
    } else {
      // No unmatched tracks expected, proceed normally
      syncMutation.mutate({ source, ignoreMissing: false });
    }
  };

  // Determine which sources are available
  const hasManadj = playlist.manadj !== null;
  const hasEngine = playlist.engine !== null;
  const hasRekordbox = playlist.rekordbox !== null;

  return (
    <div className="playlist-detail-container">
      <div className="playlist-detail-header">
        <div className="playlist-detail-title">
          <button onClick={onBack} className="detail-back-button">
            ← Back
          </button>
          <h2>{playlist.name}</h2>
        </div>
        <div className="playlist-detail-actions">
          <div className="sync-buttons">
            <span className="sync-label">Sync from:</span>
            {hasManadj && (
              <button
                onClick={() => handleSync('manadj')}
                disabled={syncMutation.isPending}
                className="sync-button sync-button-manadj"
              >
                manadj
              </button>
            )}
            {hasEngine && (
              <button
                onClick={() => handleSync('engine')}
                disabled={syncMutation.isPending}
                className="sync-button sync-button-engine"
              >
                Engine DJ
              </button>
            )}
            {hasRekordbox && (
              <button
                onClick={() => handleSync('rekordbox')}
                disabled={syncMutation.isPending}
                className="sync-button sync-button-rekordbox"
              >
                Rekordbox
              </button>
            )}
          </div>
          <button onClick={onClose} className="detail-close-button">
            Close
          </button>
        </div>
      </div>

      {/* Sync status messages */}
      {syncMutation.isPending && (
        <div className="sync-status sync-status-loading">
          Syncing playlist...
        </div>
      )}
      {syncError && (
        <div className="sync-status sync-status-error">
          Error: {syncError}
        </div>
      )}
      {syncResult && !syncError && (
        <div className="sync-status sync-status-success">
          {Array.isArray(syncResult) ? (
            <>
              Synced to {syncResult.length} target(s).
              {syncResult.map(r => (
                <div key={r.target}>
                  {r.target}: {r.tracks_synced} tracks synced
                  {r.tracks_unmatched.length > 0 && ` (${r.tracks_unmatched.length} unmatched)`}
                  {r.created ? ' (created)' : ' (updated)'}
                </div>
              ))}
            </>
          ) : (
            <>
              Synced to {syncResult.target}: {syncResult.tracks_synced} tracks
              {syncResult.tracks_unmatched.length > 0 && ` (${syncResult.tracks_unmatched.length} unmatched)`}
              {syncResult.created ? ' (created)' : ' (updated)'}
            </>
          )}
        </div>
      )}

      <div className="playlist-detail-grid">
        {/* Headers */}
        <div className="detail-column-header">
          <h3>manadj ({playlist.manadj?.length || 0})</h3>
        </div>
        <div className="detail-column-header">
          <h3>Engine DJ ({playlist.engine?.length || 0})</h3>
        </div>
        <div className="detail-column-header">
          <h3>Rekordbox ({playlist.rekordbox?.length || 0})</h3>
        </div>

        {/* Track rows */}
        {Array.from({ length: maxLength }).map((_, idx) => {
          const manadjEntry = playlist.manadj?.[idx];
          const engineEntry = playlist.engine?.[idx];
          const rekordboxEntry = playlist.rekordbox?.[idx];

          const manadjTrack = manadjEntry?.track_id && typeof manadjEntry.track_id === 'number'
            ? trackMap.get(manadjEntry.track_id)
            : undefined;

          return (
            <>
              {/* ManAdj column - full detail */}
              <div key={`manadj-${idx}`} className="detail-track-cell detail-track-manadj">
                {manadjEntry ? (
                  trackQueries.isLoading ? (
                    <div className="detail-track-loading">Loading...</div>
                  ) : manadjTrack ? (
                    <div className="detail-track-full">
                      <div className="detail-track-main">
                        <div className="detail-track-title">{manadjTrack.title || manadjEntry.filename}</div>
                        <div className="detail-track-artist">{manadjTrack.artist || '—'}</div>
                      </div>
                      <div className="detail-track-meta">
                        <span className="detail-track-key">{manadjTrack.key_camelot || '—'}</span>
                        <span className="detail-track-bpm">{manadjTrack.bpm ? `${manadjTrack.bpm.toFixed(1)} BPM` : '—'}</span>
                        <span className="detail-track-energy">E{manadjTrack.energy || '—'}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="detail-track-simple">{manadjEntry.filename}</div>
                  )
                ) : (
                  <div className="detail-track-empty">—</div>
                )}
              </div>

              {/* Engine column - simple */}
              <div key={`engine-${idx}`} className="detail-track-cell">
                {engineEntry ? (
                  <div className="detail-track-simple">
                    {!isInManadj(engineEntry.filename) && (
                      <span className="detail-track-warning" title="Not in manadj">⚠</span>
                    )}
                    {engineEntry.filename}
                  </div>
                ) : (
                  <div className="detail-track-empty">—</div>
                )}
              </div>

              {/* Rekordbox column - simple */}
              <div key={`rekordbox-${idx}`} className="detail-track-cell">
                {rekordboxEntry ? (
                  <div className="detail-track-simple">
                    {!isInManadj(rekordboxEntry.filename) && (
                      <span className="detail-track-warning" title="Not in manadj">⚠</span>
                    )}
                    {rekordboxEntry.filename}
                  </div>
                ) : (
                  <div className="detail-track-empty">—</div>
                )}
              </div>
            </>
          );
        })}
      </div>
    </div>
  );
}
