import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { SourceItem, SourceItemState } from '../types';
import './Acquisition.css';

// Review-split layout skeleton (chosen via UI prototype, see
// .scratch/soundcloud-acquisition/PRD.md): sidebar (Refresh + state filters)
// and the Source Item list. Detail panel and bottom action bar arrive with
// later slices (issues 04/06).

const STATES: SourceItemState[] = ['new', 'queued', 'fulfilled', 'ignored'];

function formatDuration(ms: number): string {
  const totalSecs = Math.round(ms / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function Acquisition() {
  const queryClient = useQueryClient();
  const [stateFilter, setStateFilter] = useState<SourceItemState | 'all'>('all');

  const { data: items, isLoading, error } = useQuery({
    queryKey: ['acquisitionItems'],
    queryFn: api.acquisition.getItems,
  });

  const refreshMutation = useMutation({
    mutationFn: api.acquisition.refresh,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['acquisitionItems'] });
    },
  });

  const stateCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of STATES) counts[s] = 0;
    for (const item of items ?? []) counts[item.state] = (counts[item.state] ?? 0) + 1;
    return counts;
  }, [items]);

  const visible: SourceItem[] = useMemo(
    () => (items ?? []).filter(i => stateFilter === 'all' || i.state === stateFilter),
    [items, stateFilter],
  );

  return (
    <div className="acquisition-container">
      <div className="acquisition-sidebar">
        <button
          className="acquisition-refresh-button"
          onClick={() => refreshMutation.mutate()}
          disabled={refreshMutation.isPending}
        >
          {refreshMutation.isPending ? 'Refreshing…' : '↻ Refresh likes'}
        </button>
        {refreshMutation.isSuccess && (
          <div className="acquisition-refresh-result">
            +{refreshMutation.data.added} new · {refreshMutation.data.total_local} total
          </div>
        )}
        {refreshMutation.isError && (
          <div className="acquisition-error">{(refreshMutation.error as Error).message}</div>
        )}
        <div className="acquisition-sidebar-heading">state</div>
        <button
          className={`acquisition-filter-row ${stateFilter === 'all' ? 'active' : ''}`}
          onClick={() => setStateFilter('all')}
        >
          all <span className="acquisition-count">{items?.length ?? 0}</span>
        </button>
        {STATES.map(s => (
          <button
            key={s}
            className={`acquisition-filter-row ${stateFilter === s ? 'active' : ''}`}
            onClick={() => setStateFilter(s)}
          >
            <span className={`acquisition-state acquisition-state-${s}`}>{s}</span>
            <span className="acquisition-count">{stateCounts[s]}</span>
          </button>
        ))}
      </div>
      <div className="acquisition-main">
        {isLoading && <div className="acquisition-empty">Loading…</div>}
        {error != null && <div className="acquisition-error">{(error as Error).message}</div>}
        {!isLoading && !error && visible.length === 0 && (
          <div className="acquisition-empty">
            No source items{items?.length === 0 ? ' — hit Refresh to fetch your likes' : ''}
          </div>
        )}
        <div className="acquisition-list">
          {visible.map(item => (
            <div key={item.id} className="acquisition-list-row">
              <span className="acquisition-item-title" title={item.title}>{item.title}</span>
              <span className="acquisition-item-sub">
                {item.uploader} · {formatDuration(item.duration_ms)}
              </span>
              <span className={`acquisition-state acquisition-state-${item.state}`}>
                {item.state}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
