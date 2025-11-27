import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { UnifiedTagView, TagSyncRequest } from '../types';
import { TagSyncTable } from './TagSyncTable';
import './TagSync.css';

export function TagSync() {
  const queryClient = useQueryClient();

  const { data: tags, isLoading, error } = useQuery({
    queryKey: ['tagSync'],
    queryFn: api.tagSync.getUnified,
    refetchInterval: 30000,
  });

  const { data: stats } = useQuery({
    queryKey: ['tagSyncStats'],
    queryFn: api.tagSync.getStats,
    refetchInterval: 30000,
  });

  // Group tags by category (only manadj tags, ignore Energy from rekordbox)
  const tagsByCategory = useMemo(() => {
    if (!tags) return {};
    return tags.reduce((acc, tag) => {
      // Only show tags that exist in manadj (source of truth)
      if (!tag.manadj) return acc;

      // Skip Energy category - it's not a manadj tag
      if (tag.category_name === 'Energy') return acc;

      if (!acc[tag.category_name]) acc[tag.category_name] = [];
      acc[tag.category_name].push(tag);
      return acc;
    }, {} as Record<string, UnifiedTagView[]>);
  }, [tags]);

  // Initialize expanded categories with all categories (will be empty on first render)
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  // Update expanded categories when tagsByCategory changes (expand all by default)
  useEffect(() => {
    setExpandedCategories(new Set(Object.keys(tagsByCategory)));
  }, [tagsByCategory]);

  const [syncTarget, setSyncTarget] = useState<'engine' | 'rekordbox'>('engine');
  const [dryRun, setDryRun] = useState(true);
  const [fresh, setFresh] = useState(false);
  const [includeEnergy, setIncludeEnergy] = useState(true);

  // Calculate per-target sync status breakdown
  const syncStatus = useMemo(() => {
    if (!tags) return { total: 0, engineSynced: 0, rekordboxSynced: 0 };

    const manadjTags = tags.filter(t => t.manadj && t.category_name !== 'Energy');
    const engineSyncedCount = manadjTags.filter(t =>
      t.engine?.track_count === t.manadj?.track_count
    ).length;
    const rekordboxSyncedCount = manadjTags.filter(t =>
      t.rekordbox?.track_count === t.manadj?.track_count
    ).length;

    return {
      total: manadjTags.length,
      engineSynced: engineSyncedCount,
      rekordboxSynced: rekordboxSyncedCount
    };
  }, [tags]);

  const syncMutation = useMutation({
    mutationFn: async () => {
      const request: TagSyncRequest = {
        target: syncTarget,
        dry_run: dryRun,
        fresh: syncTarget === 'engine' ? fresh : undefined,
        include_energy: syncTarget === 'rekordbox' ? includeEnergy : undefined,
      };

      if (syncTarget === 'engine') {
        return api.tagSync.syncToEngine(request);
      } else {
        return api.tagSync.syncToRekordbox(request);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tagSync'] });
      queryClient.invalidateQueries({ queryKey: ['tagSyncStats'] });
    },
  });

  const handleToggleCategory = (category: string) => {
    const newSet = new Set(expandedCategories);
    if (newSet.has(category)) {
      newSet.delete(category);
    } else {
      newSet.add(category);
    }
    setExpandedCategories(newSet);
  };

  if (isLoading) {
    return (
      <div className="tag-sync-content">
        <div className="tag-sync-stats-bar">
          <div className="tag-sync-header">
            <h1>Tag Sync Status</h1>
            <div className="sync-stats">
              <div className="sync-stat">
                <span className="sync-stat-label">manadj:</span>
                <span className="sync-stat-value">-</span>
              </div>
              <span className="sync-stat-divider">|</span>
              <div className="sync-stat">
                <span className="sync-stat-label">Engine DJ:</span>
                <span className="sync-stat-value">-</span>
              </div>
              <span className="sync-stat-divider">|</span>
              <div className="sync-stat">
                <span className="sync-stat-label">Rekordbox:</span>
                <span className="sync-stat-value">-</span>
              </div>
            </div>
          </div>
        </div>
        <div className="tag-sync-table-container">
          <div className="tag-sync-loading">Loading tag sync data...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="tag-sync-content">
        <div className="tag-sync-error">
          Error loading tags: {error instanceof Error ? error.message : 'Unknown error'}
        </div>
      </div>
    );
  }

  if (!tags) {
    return (
      <div className="tag-sync-content">
        <div className="tag-sync-loading">No tag data available</div>
      </div>
    );
  }

  return (
    <div className="tag-sync-content">
      <div className="tag-sync-stats-bar">
        <div className="tag-sync-header">
          <h1>Tag Sync Status</h1>
          <div className="sync-stats">
            <div className="sync-stat">
              <span className="sync-stat-label">Total:</span>
              <span className="sync-stat-value">{syncStatus.total} tags</span>
            </div>
            <span className="sync-stat-divider">|</span>
            <div className="sync-stat">
              <span className="sync-stat-label">Engine DJ:</span>
              <span className={`sync-stat-value ${syncStatus.engineSynced === syncStatus.total ? 'sync-status-synced' : 'sync-status-unsynced'}`}>
                {syncStatus.engineSynced} / {syncStatus.total}
              </span>
            </div>
            <span className="sync-stat-divider">|</span>
            <div className="sync-stat">
              <span className="sync-stat-label">Rekordbox:</span>
              <span className={`sync-stat-value ${syncStatus.rekordboxSynced === syncStatus.total ? 'sync-status-synced' : 'sync-status-unsynced'}`}>
                {syncStatus.rekordboxSynced} / {syncStatus.total}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="tag-sync-actions-bar">
        <div className="sync-action-group">
          <label className="sync-action-label">Target:</label>
          <select
            className="sync-action-select"
            value={syncTarget}
            onChange={(e) => setSyncTarget(e.target.value as 'engine' | 'rekordbox')}
            disabled={syncMutation.isPending}
          >
            <option value="engine">Engine DJ</option>
            <option value="rekordbox">Rekordbox</option>
          </select>
        </div>

        <div className="sync-action-group">
          <label className="sync-action-checkbox">
            <input
              type="checkbox"
              checked={dryRun}
              onChange={(e) => setDryRun(e.target.checked)}
              disabled={syncMutation.isPending}
            />
            <span>Dry Run</span>
          </label>
        </div>

        {syncTarget === 'engine' && (
          <div className="sync-action-group">
            <label className="sync-action-checkbox">
              <input
                type="checkbox"
                checked={fresh}
                onChange={(e) => setFresh(e.target.checked)}
                disabled={syncMutation.isPending}
              />
              <span>Fresh Sync</span>
            </label>
          </div>
        )}

        {syncTarget === 'rekordbox' && (
          <div className="sync-action-group">
            <label className="sync-action-checkbox">
              <input
                type="checkbox"
                checked={includeEnergy}
                onChange={(e) => setIncludeEnergy(e.target.checked)}
                disabled={syncMutation.isPending}
              />
              <span>Include Energy</span>
            </label>
          </div>
        )}

        <button
          className="sync-action-button"
          onClick={() => syncMutation.mutate()}
          disabled={syncMutation.isPending}
        >
          {syncMutation.isPending ? 'Syncing...' : 'Sync'}
        </button>

        {syncMutation.isError && (
          <div className="sync-result sync-result-error">
            Error: {syncMutation.error instanceof Error ? syncMutation.error.message : 'Unknown error'}
          </div>
        )}

        {syncMutation.isSuccess && syncMutation.data && (
          <div className="sync-result sync-result-success">
            {dryRun ? 'Dry run complete' : 'Sync complete'}: {syncMutation.data.tags_created} created, {syncMutation.data.tags_updated} updated
          </div>
        )}
      </div>

      <TagSyncTable
        tagsByCategory={tagsByCategory}
        expandedCategories={expandedCategories}
        onToggleCategory={handleToggleCategory}
      />
    </div>
  );
}
