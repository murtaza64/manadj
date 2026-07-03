import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Classification, SourceItem, SourceItemState } from '../types';
import './Acquisition.css';

// Review-split layout (chosen via UI prototype, see
// .scratch/soundcloud-acquisition/PRD.md): sidebar (Refresh + state and
// classification filters) and the Source Item list. Detail panel and bottom
// action bar arrive with later slices (issues 04/06).

const STATES: SourceItemState[] = ['new', 'queued', 'fulfilled', 'ignored'];
const CLASSIFICATIONS: Classification[] = ['track', 'mix', 'clip', 'other'];
// Suspected mixes/clips are hidden by default; a Classification never
// auto-ignores anything (see CONTEXT.md: Classification).
const DEFAULT_CLASS_FILTER: Record<Classification, boolean> = {
  track: true,
  mix: false,
  clip: false,
  other: true,
};

function formatDuration(ms: number): string {
  const totalSecs = Math.round(ms / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function Acquisition() {
  const queryClient = useQueryClient();
  const [stateFilter, setStateFilter] = useState<SourceItemState | 'all'>('all');
  const [classFilter, setClassFilter] = useState<Record<Classification, boolean>>(DEFAULT_CLASS_FILTER);

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

  const classificationMutation = useMutation({
    mutationFn: ({ itemId, classification }: { itemId: number; classification: Classification }) =>
      api.acquisition.setClassification(itemId, classification),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['acquisitionItems'] });
    },
  });

  const cycleClassification = (item: SourceItem) => {
    const current = item.classification ?? 'track';
    const next = CLASSIFICATIONS[(CLASSIFICATIONS.indexOf(current) + 1) % CLASSIFICATIONS.length];
    classificationMutation.mutate({ itemId: item.id, classification: next });
  };

  const stateCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of STATES) counts[s] = 0;
    for (const item of items ?? []) counts[item.state] = (counts[item.state] ?? 0) + 1;
    return counts;
  }, [items]);

  const visible: SourceItem[] = useMemo(
    () =>
      (items ?? []).filter(
        i =>
          (stateFilter === 'all' || i.state === stateFilter) &&
          (i.classification === null || classFilter[i.classification]),
      ),
    [items, stateFilter, classFilter],
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
        <div className="acquisition-sidebar-heading">classification</div>
        {CLASSIFICATIONS.map(c => (
          <label key={c} className="acquisition-filter-row acquisition-class-filter">
            <input
              type="checkbox"
              checked={classFilter[c]}
              onChange={e => setClassFilter({ ...classFilter, [c]: e.target.checked })}
            />
            <span className={`acquisition-chip acquisition-chip-${c}`}>{c}</span>
            <span className="acquisition-count">
              {(items ?? []).filter(i => i.classification === c).length}
            </span>
          </label>
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
              <button
                className={`acquisition-chip acquisition-chip-${item.classification ?? 'none'}`}
                title="Click to override classification"
                onClick={() => cycleClassification(item)}
              >
                {item.classification ?? '?'}
              </button>
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
