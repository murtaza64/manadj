import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { TrackDiscrepancyTable } from './TrackDiscrepancyTable';
import type { TrackSyncResult } from '../types';
import './TrackSyncView.css';

interface TrackSyncViewProps {
  target: 'engine' | 'rekordbox';
}

export function TrackSyncView({ target }: TrackSyncViewProps) {
  const [validateFiles, setValidateFiles] = useState(false);

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

  if (isLoading) {
    return <div className="track-sync-loading">Loading track discrepancies...</div>;
  }

  if (error) {
    return <div className="track-sync-error">Error: {error instanceof Error ? error.message : 'Unknown error'}</div>;
  }

  if (!data) {
    return <div className="track-sync-empty">No data available</div>;
  }

  const targetLabel = target === 'engine' ? 'Engine DJ' : 'Rekordbox';

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
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={validateFiles}
            onChange={(e) => setValidateFiles(e.target.checked)}
          />
          <span>Validate files exist on disk</span>
        </label>
        <button onClick={() => refetch()} className="refresh-button">
          Refresh
        </button>
      </div>

      {/* Discrepancy Tables */}
      <TrackDiscrepancyTable
        exportCandidates={data.missing_in_target}
        importCandidates={data.missing_in_manadj}
        target={target}
      />
    </div>
  );
}
