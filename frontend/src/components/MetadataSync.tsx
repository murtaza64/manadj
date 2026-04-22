import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { MetadataComparisonTable } from './MetadataComparisonTable';
import type { MetadataComparisonResult, MetadataSyncRequest } from '../types';
import './MetadataSync.css';

export const MetadataSync: React.FC = () => {
  const queryClient = useQueryClient();
  const [selectedTracks, setSelectedTracks] = useState<Set<number>>(new Set());
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set(['title', 'artist', 'bpm', 'key']));

  const { data: comparisonResult, isLoading, error, refetch } = useQuery<MetadataComparisonResult>({
    queryKey: ['metadata-comparison'],
    queryFn: api.tracks.compareMetadata,
  });

  const syncMutation = useMutation({
    mutationFn: (request: MetadataSyncRequest) => api.tracks.syncMetadata(request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['metadata-comparison'] });
      queryClient.invalidateQueries({ queryKey: ['tracks'] });
      setSelectedTracks(new Set());
    },
  });

  const writeToFilesMutation = useMutation({
    mutationFn: (request: MetadataSyncRequest) => api.tracks.writeMetadataToFiles(request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['metadata-comparison'] });
      setSelectedTracks(new Set());
    },
  });

  const handleToggleTrack = (trackId: number) => {
    const newSelected = new Set(selectedTracks);
    if (newSelected.has(trackId)) {
      newSelected.delete(trackId);
    } else {
      newSelected.add(trackId);
    }
    setSelectedTracks(newSelected);
  };

  const handleToggleAll = () => {
    if (!comparisonResult) return;

    const filtered = comparisonResult.comparisons.filter(c =>
      c.differences.some(d => selectedFields.has(d))
    );

    if (selectedTracks.size === filtered.length) {
      setSelectedTracks(new Set());
    } else {
      setSelectedTracks(new Set(filtered.map(c => c.track_id)));
    }
  };

  const handleToggleField = (field: string) => {
    const newFields = new Set(selectedFields);
    if (newFields.has(field)) {
      newFields.delete(field);
    } else {
      newFields.add(field);
    }
    setSelectedFields(newFields);
  };

  const handleApply = (dryRun: boolean) => {
    if (!comparisonResult) return;

    const updates = comparisonResult.comparisons
      .filter(c => selectedTracks.has(c.track_id))
      .map(c => ({
        track_id: c.track_id,
        fields: Object.fromEntries(
          c.differences
            .filter(field => selectedFields.has(field))
            .map(field => [field, c.file[field as keyof typeof c.file]])
        ),
      }));

    syncMutation.mutate({ updates, dry_run: dryRun });
  };

  const handleWriteToFiles = (dryRun: boolean) => {
    if (!comparisonResult) return;

    const updates = comparisonResult.comparisons
      .filter(c => selectedTracks.has(c.track_id))
      .map(c => ({
        track_id: c.track_id,
        fields: Object.fromEntries(
          c.differences
            .filter(field => selectedFields.has(field))
            .map(field => [field, c.current[field as keyof typeof c.current]])
        ),
      }));

    writeToFilesMutation.mutate({ updates, dry_run: dryRun });
  };

  if (isLoading) {
    return <div className="metadata-sync loading">Loading metadata comparison...</div>;
  }

  if (error) {
    return (
      <div className="metadata-sync error">
        <p>Error loading metadata comparison: {String(error)}</p>
        <button onClick={() => refetch()}>Retry</button>
      </div>
    );
  }

  if (!comparisonResult) {
    return <div className="metadata-sync">No data available</div>;
  }

  const filteredComparisons = comparisonResult.comparisons.filter(c =>
    c.differences.some(d => selectedFields.has(d))
  );

  return (
    <div className="metadata-sync">
      <div className="sync-header">
        <h2>Metadata Sync</h2>
        <button onClick={() => refetch()} disabled={isLoading}>
          Refresh
        </button>
      </div>

      <div className="sync-stats">
        <div className="stat">
          <span className="stat-label">Total Tracks:</span>
          <span className="stat-value">{comparisonResult.stats.total_tracks}</span>
        </div>
        <div className="stat">
          <span className="stat-label">With Changes:</span>
          <span className="stat-value">{comparisonResult.stats.tracks_with_changes}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Conflicts:</span>
          <span className="stat-value">{comparisonResult.stats.tracks_with_conflicts}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Missing Files:</span>
          <span className="stat-value">{comparisonResult.stats.missing_files}</span>
        </div>
      </div>

      <div className="field-filters">
        <span className="filter-label">Fields to sync:</span>
        {['title', 'artist', 'bpm', 'key'].map(field => (
          <label key={field} className="field-checkbox">
            <input
              type="checkbox"
              checked={selectedFields.has(field)}
              onChange={() => handleToggleField(field)}
            />
            <span>{field.charAt(0).toUpperCase() + field.slice(1)}</span>
          </label>
        ))}
      </div>

      {syncMutation.data && (
        <div className={`sync-result ${syncMutation.data.dry_run ? 'dry-run' : 'applied'}`}>
          <h3>{syncMutation.data.dry_run ? 'File → DB Preview' : 'File → DB Results'}</h3>
          <div className="result-stats">
            <div>Total Requested: {syncMutation.data.stats.total_requested}</div>
            <div>Updated: {syncMutation.data.stats.updated}</div>
            <div>Skipped: {syncMutation.data.stats.skipped}</div>
            <div>Errors: {syncMutation.data.stats.errors}</div>
          </div>
          {syncMutation.data.stats.error_messages.length > 0 && (
            <div className="error-messages">
              <h4>Errors:</h4>
              <ul>
                {syncMutation.data.stats.error_messages.map((msg: string, idx: number) => (
                  <li key={idx}>{msg}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {writeToFilesMutation.data && (
        <div className={`sync-result ${writeToFilesMutation.data.dry_run ? 'dry-run' : 'applied'}`}>
          <h3>{writeToFilesMutation.data.dry_run ? 'DB → File Preview' : 'DB → File Results'}</h3>
          <div className="result-stats">
            <div>Total Requested: {writeToFilesMutation.data.stats.total_requested}</div>
            <div>Updated: {writeToFilesMutation.data.stats.updated}</div>
            <div>Skipped: {writeToFilesMutation.data.stats.skipped}</div>
            <div>Errors: {writeToFilesMutation.data.stats.errors}</div>
          </div>
          {writeToFilesMutation.data.stats.error_messages.length > 0 && (
            <div className="error-messages">
              <h4>Errors:</h4>
              <ul>
                {writeToFilesMutation.data.stats.error_messages.map((msg: string, idx: number) => (
                  <li key={idx}>{msg}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="sync-actions">
        <div className="sync-direction-group">
          <span className="direction-label">File → DB:</span>
          <button
            onClick={() => handleApply(true)}
            disabled={selectedTracks.size === 0 || syncMutation.isPending}
          >
            Preview ({selectedTracks.size} selected)
          </button>
          <button
            onClick={() => handleApply(false)}
            disabled={selectedTracks.size === 0 || syncMutation.isPending}
            className="apply-button"
          >
            Apply to DB
          </button>
        </div>
        <div className="sync-direction-group">
          <span className="direction-label">DB → File:</span>
          <button
            onClick={() => handleWriteToFiles(true)}
            disabled={selectedTracks.size === 0 || writeToFilesMutation.isPending}
          >
            Preview ({selectedTracks.size} selected)
          </button>
          <button
            onClick={() => handleWriteToFiles(false)}
            disabled={selectedTracks.size === 0 || writeToFilesMutation.isPending}
            className="apply-button"
          >
            Write to Files
          </button>
        </div>
      </div>

      {filteredComparisons.length > 0 ? (
        <MetadataComparisonTable
          comparisons={filteredComparisons}
          selectedTracks={selectedTracks}
          selectedFields={selectedFields}
          onToggleTrack={handleToggleTrack}
          onToggleAll={handleToggleAll}
        />
      ) : (
        <div className="no-changes">
          No metadata differences found for selected fields.
        </div>
      )}
    </div>
  );
};
