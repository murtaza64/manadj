import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { UnifiedPlaylist, Track, SyncResult } from '../types';
import { formatKeyDisplay } from '../utils/keyUtils';
import { PlaylistFullExportModal } from './PlaylistFullExportModal';
import { useExportEnabled } from '../settings/useAppConfig';
import './PlaylistDetailView.css';

interface PlaylistDetailViewProps {
  playlist: UnifiedPlaylist;
  onBack: () => void;
}

function SyncTargetResult({ result }: { result: SyncResult }) {
  const errors = result.track_errors ?? {};
  const failures = [...new Set([...result.tracks_unmatched, ...Object.keys(errors)])];
  const added = result.tracks_added ?? [];
  const failed = !result.success || !!result.error;
  return (
    <div className={`sync-status ${failed ? 'sync-status-error' : failures.length ? 'sync-status-warning' : 'sync-status-success'}`}>
      <div>
        {result.target}: {failed ? 'sync failed' : failures.length ? 'partially synced' : 'synced'}
        {' · '}{result.tracks_synced} tracks synced
        {!failed && (result.created ? ' (created)' : ' (updated)')}
      </div>
      {result.error && <p>{result.error}</p>}
      {added.length > 0 && (
        <div>
          Added {added.length} destination library record{added.length === 1 ? '' : 's'}:
          <ul>{added.map((filename, index) => <li key={`${filename}-${index}`}>{filename}</li>)}</ul>
        </div>
      )}
      {failures.length > 0 && (
        <div>
          {failures.length} unavailable / failed:
          <ul>{failures.map(filename => (
            <li key={filename}>{filename}: {errors[filename] || 'Audio unavailable or track could not be prepared'}</li>
          ))}</ul>
        </div>
      )}
    </div>
  );
}

export function PlaylistDetailView({ playlist, onBack }: PlaylistDetailViewProps) {
  const [syncResult, setSyncResult] = useState<SyncResult | SyncResult[] | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const queryClient = useQueryClient();
  // Export gate (ADR 0043): with export off, syncing only imports INTO
  // manadj (target pinned to 'manadj'); external-write verbs hide.
  const exportEnabled = useExportEnabled();
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
        // All targets when export is on; import-only into manadj otherwise.
        target: exportEnabled ? null : 'manadj',
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
      : (syncResult?.tracks_unmatched?.length ?? 0) > 0;

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
            <span className="sync-label">{exportEnabled ? 'Sync from:' : 'Import from:'}</span>
            {hasManadj && exportEnabled && (
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
            {hasManadj && exportEnabled && (
              <button
                onClick={() => setExportOpen(true)}
                className="sync-button playlist-full-export-button"
              >
                Export all data
              </button>
            )}
          </div>
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
        <div>
          {(Array.isArray(syncResult) ? syncResult : [syncResult]).map(result => (
            <SyncTargetResult key={result.target} result={result} />
          ))}
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
                        <span className="detail-track-key">{manadjTrack.key !== undefined ? formatKeyDisplay(manadjTrack.key) : '—'}</span>
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
      {exportOpen && (
        <PlaylistFullExportModal
          playlistName={playlist.name}
          onClose={() => setExportOpen(false)}
        />
      )}
    </div>
  );
}
