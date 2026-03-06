import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { TrackDiscrepancyTable } from './TrackDiscrepancyTable';
import type {
  EngineRBXMLSyncRequest,
  EngineRBXMLSyncResult,
  RekordboxTrackSyncRequest,
  RekordboxTrackSyncResult,
} from '../types';
import './TrackSyncView.css';

interface TrackSyncViewProps {
  target: 'engine' | 'rekordbox';
}

export function TrackSyncView({ target }: TrackSyncViewProps) {
  const [validateFiles, setValidateFiles] = useState(false);
  const [playlistName, setPlaylistName] = useState('');
  const [outputPath, setOutputPath] = useState('');
  const [dryRun, setDryRun] = useState(true);
  const [skipExport, setSkipExport] = useState(false);
  const [skipImport, setSkipImport] = useState(true);

  const [engineResult, setEngineResult] = useState<EngineRBXMLSyncResult | null>(null);
  const [rekordboxResult, setRekordboxResult] = useState<RekordboxTrackSyncResult | null>(null);

  const isEngine = target === 'engine';

  const engineSyncMutation = useMutation({
    mutationFn: (request: EngineRBXMLSyncRequest) => api.trackSync.syncEngineRBXML(request),
    onSuccess: (result) => {
      setEngineResult(result);
      refetch();
    },
  });

  const rekordboxSyncMutation = useMutation({
    mutationFn: (request: RekordboxTrackSyncRequest) => api.trackSync.syncRekordbox(request),
    onSuccess: (result) => {
      setRekordboxResult(result);
      refetch();
    },
  });

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['trackSync', target, validateFiles],
    queryFn: () => {
      if (target === 'engine') {
        return api.trackSync.getEngineDiscrepancies(validateFiles);
      } else {
        return api.trackSync.getRekordboxDiscrepancies(validateFiles);
      }
    },
  });

  useEffect(() => {
    setSkipImport(true);
    setSkipExport(false);
    setDryRun(true);
    setEngineResult(null);
    setRekordboxResult(null);
  }, [isEngine]);

  if (isLoading) {
    return <div className="track-sync-loading">Loading track discrepancies...</div>;
  }

  if (error) {
    return <div className="track-sync-error">Error: {error instanceof Error ? error.message : 'Unknown error'}</div>;
  }

  if (!data) {
    return <div className="track-sync-empty">No data available</div>;
  }

  const targetLabel = isEngine ? 'Engine DJ' : 'Rekordbox';

  const handleRunSync = () => {
    if (isEngine) {
      setSkipImport(true);
      engineSyncMutation.mutate({
        validate_files: validateFiles,
        playlist_name: playlistName.trim() || undefined,
        output_path: outputPath.trim() || undefined,
        skip_import: true,
      });
      return;
    }

    rekordboxSyncMutation.mutate({
      dry_run: dryRun,
      skip_export: skipExport,
      skip_import: skipImport,
      validate_files: validateFiles,
      playlist_name: playlistName.trim() || undefined,
    });
  };

  const isSyncing = engineSyncMutation.isPending || rekordboxSyncMutation.isPending;

  return (
    <div className="track-sync-view">
      {/* Stats Summary */}
      <div className="track-sync-stats">
        <div className="stat-card">
          <div className="stat-label">manadj Tracks</div>
          <div className="stat-value">{data.stats.manadj_total}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">{targetLabel} Tracks</div>
          <div className="stat-value">{data.stats.target_total}</div>
        </div>
        <div className="stat-card stat-export">
          <div className="stat-label">Missing in {targetLabel}</div>
          <div className="stat-value">{data.stats.missing_in_target_count}</div>
          <div className="stat-sublabel">Export candidates</div>
        </div>
        <div className="stat-card stat-import">
          <div className="stat-label">Missing in manadj</div>
          <div className="stat-value">{data.stats.missing_in_manadj_count}</div>
          <div className="stat-sublabel">Import candidates</div>
        </div>
        {data.stats.skipped_file_not_found > 0 && (
          <div className="stat-card stat-warning">
            <div className="stat-label">Files Not Found</div>
            <div className="stat-value">{data.stats.skipped_file_not_found}</div>
            <div className="stat-sublabel">Skipped (file missing)</div>
          </div>
        )}
      </div>

      {/* Options */}
      <div className="track-sync-options">
        <div className="track-sync-controls">
          {!isEngine && (
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={dryRun}
                onChange={(e) => setDryRun(e.target.checked)}
              />
              <span>Dry run</span>
            </label>
          )}

          {!isEngine && (
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={skipExport}
                onChange={(e) => setSkipExport(e.target.checked)}
              />
              <span>Skip export</span>
            </label>
          )}

          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={skipImport}
              disabled={isEngine}
              onChange={(e) => setSkipImport(e.target.checked)}
            />
            <span>Skip import</span>
          </label>

          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={validateFiles}
              onChange={(e) => setValidateFiles(e.target.checked)}
            />
            <span>Validate files</span>
          </label>

          <input
            className="track-sync-input"
            placeholder="Playlist name (optional)"
            value={playlistName}
            onChange={(e) => setPlaylistName(e.target.value)}
          />

          {isEngine && (
            <input
              className="track-sync-input"
              placeholder="Output XML path (optional)"
              value={outputPath}
              onChange={(e) => setOutputPath(e.target.value)}
            />
          )}
        </div>

        <div className="track-sync-actions">
          <button
            onClick={handleRunSync}
            className="run-sync-button"
            disabled={isSyncing}
          >
            {isSyncing ? 'Running...' : isEngine ? 'Generate RBXML' : 'Run Sync'}
          </button>
          <button onClick={() => refetch()} className="refresh-button" disabled={isSyncing}>
            Refresh
          </button>
        </div>
      </div>

      {engineSyncMutation.isError && (
        <div className="track-sync-action-result track-sync-action-error">
          {engineSyncMutation.error instanceof Error ? engineSyncMutation.error.message : 'Engine sync failed'}
        </div>
      )}

      {rekordboxSyncMutation.isError && (
        <div className="track-sync-action-result track-sync-action-error">
          {rekordboxSyncMutation.error instanceof Error ? rekordboxSyncMutation.error.message : 'Rekordbox sync failed'}
        </div>
      )}

      {engineResult && (
        <div className="track-sync-action-result track-sync-action-success">
          Exported {engineResult.exported_to_target} tracks to RBXML at {engineResult.output_path}
        </div>
      )}

      {rekordboxResult && (
        <div className="track-sync-action-result track-sync-action-success">
          {rekordboxResult.dry_run
            ? `Dry run: ${rekordboxResult.missing_in_target_count} export candidates, ${rekordboxResult.missing_in_manadj_count} import candidates`
            : `Applied: exported ${rekordboxResult.exported_to_target}, imported ${rekordboxResult.imported_to_manadj}`}
        </div>
      )}

      {/* Discrepancy Tables */}
      <TrackDiscrepancyTable
        exportCandidates={data.missing_in_target}
        importCandidates={data.missing_in_manadj}
        target={target}
      />
    </div>
  );
}
