import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Classification, SourceItem, SourceItemState, Track } from '../types';
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
  // default view = needs-download: new items, mixes/clips hidden
  // 'failed' is a pseudo-filter: queued items whose latest download task failed
  const [stateFilter, setStateFilter] = useState<SourceItemState | 'all' | 'failed'>('new');
  const [classFilter, setClassFilter] = useState<Record<Classification, boolean>>(DEFAULT_CLASS_FILTER);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  // checkbox multi-selection for bulk actions (independent of the detail-panel focus)
  const [checkedIds, setCheckedIds] = useState<Set<number>>(new Set());

  const { data: items, isLoading, error } = useQuery({
    queryKey: ['acquisitionItems'],
    queryFn: api.acquisition.getItems,
    // poll while downloads are in flight so task states stay live
    refetchInterval: query =>
      (query.state.data ?? []).some(
        i => i.download && (i.download.task_state === 'pending' || i.download.task_state === 'running'),
      )
        ? 3000
        : false,
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

  const isFailed = (i: SourceItem) => i.state === 'queued' && i.download?.task_state === 'failed';

  const visible: SourceItem[] = useMemo(() => {
    const filtered = (items ?? []).filter(
      i =>
        (stateFilter === 'all' ||
          (stateFilter === 'failed' ? isFailed(i) : i.state === stateFilter)) &&
        (i.classification === null || classFilter[i.classification]),
    );
    if (stateFilter === 'fulfilled') {
      // acquired-by-date first (recorded or asserted), then matched items by liked date
      const acq = (i: SourceItem) => i.provenance?.acquired_at ?? null;
      return [...filtered].sort((a, b) => {
        const ad = acq(a), bd = acq(b);
        if (ad && bd) return bd.localeCompare(ad);
        if (ad) return -1;
        if (bd) return 1;
        return (b.liked_at ?? '').localeCompare(a.liked_at ?? '');
      });
    }
    return filtered;
  }, [items, stateFilter, classFilter]);

  const failedCount = useMemo(() => (items ?? []).filter(isFailed).length, [items]);
  const queueable = useMemo(
    () => visible.filter(i => i.state === 'new' && !i.correspondence),
    [visible],
  );

  const bulkQueueMutation = useMutation({
    mutationFn: (ids: number[]) => api.acquisition.queueBulk(ids),
    onSuccess: () => {
      setCheckedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ['acquisitionItems'] });
    },
  });

  const toggleChecked = (id: number) => {
    setCheckedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const visibleChecked = useMemo(
    () => visible.filter(i => checkedIds.has(i.id)),
    [visible, checkedIds],
  );
  const allVisibleChecked = visible.length > 0 && visibleChecked.length === visible.length;

  const toggleAllVisible = () => {
    setCheckedIds(prev => {
      const next = new Set(prev);
      if (allVisibleChecked) visible.forEach(i => next.delete(i.id));
      else visible.forEach(i => next.add(i.id));
      return next;
    });
  };

  const selected = useMemo(
    () => (items ?? []).find(i => i.id === selectedId) ?? null,
    [items, selectedId],
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
        <button
          className={`acquisition-filter-row ${stateFilter === 'failed' ? 'active' : ''}`}
          onClick={() => setStateFilter('failed')}
        >
          <span className="acquisition-state acquisition-task-failed">failed</span>
          <span className="acquisition-count">{failedCount}</span>
        </button>
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
            <div
              key={item.id}
              className={`acquisition-list-row ${selectedId === item.id ? 'selected' : ''}`}
              onClick={() => setSelectedId(item.id)}
            >
              <input
                type="checkbox"
                className="acquisition-row-check"
                checked={checkedIds.has(item.id)}
                onChange={() => toggleChecked(item.id)}
                onClick={e => e.stopPropagation()}
              />
              <span className="acquisition-item-title" title={item.title}>{item.title}</span>
              {item.correspondence?.status === 'proposed' && (
                <span className="acquisition-score">
                  match {Math.round((item.correspondence.score ?? 0) * 100)}%
                </span>
              )}
              <span className="acquisition-item-sub">
                {item.uploader} · {formatDuration(item.duration_ms)}
                {item.provenance?.acquired_at &&
                  ` · ${item.provenance.asserted ? `via ${item.provenance.label}` : 'dl'} ${item.provenance.acquired_at.slice(0, 10)}`}
              </span>
              <button
                className={`acquisition-chip acquisition-chip-${item.classification ?? 'none'}`}
                title="Click to override classification"
                onClick={e => { e.stopPropagation(); cycleClassification(item); }}
              >
                {item.classification ?? '?'}
              </button>
              {item.state === 'queued' && item.download ? (
                <span className={`acquisition-state acquisition-task-${item.download.task_state}`}>
                  {item.download.task_state === 'done' ? 'queued' : item.download.task_state}
                </span>
              ) : (
                <span className={`acquisition-state acquisition-state-${item.state}`}>
                  {item.state}
                </span>
              )}
            </div>
          ))}
        </div>
        {selected && <ItemDetail item={selected} onClose={() => setSelectedId(null)} />}
        <div className="acquisition-bottom-bar">
          <label className="acquisition-check">
            <input type="checkbox" checked={allVisibleChecked} onChange={toggleAllVisible} />
            {checkedIds.size > 0 ? `${visibleChecked.length} selected` : 'select all'}
          </label>
          <span>{visible.length} visible</span>
          {bulkQueueMutation.isSuccess && (
            <span className="acquisition-bulk-result">
              queued {bulkQueueMutation.data.queued}, skipped {bulkQueueMutation.data.skipped}
            </span>
          )}
          <div className="acquisition-bottom-spacer" />
          {visibleChecked.length > 0 ? (
            <button
              className="acquisition-action-button acquisition-action-queue"
              disabled={bulkQueueMutation.isPending}
              onClick={() => bulkQueueMutation.mutate(visibleChecked.map(i => i.id))}
            >
              ⇣ queue selected ({visibleChecked.length})
            </button>
          ) : (
            <button
              className="acquisition-action-button acquisition-action-queue"
              disabled={queueable.length === 0 || bulkQueueMutation.isPending}
              onClick={() => bulkQueueMutation.mutate(queueable.map(i => i.id))}
            >
              ⇣ queue all visible ({queueable.length})
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ProvenanceEditor({ item }: { item: SourceItem }) {
  const queryClient = useQueryClient();
  const [audioFrom, setAudioFrom] = useState(
    item.provenance?.url ?? item.provenance?.label ?? '',
  );
  const mutation = useMutation({
    mutationFn: () => api.acquisition.setProvenance(item.id, audioFrom.trim()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['acquisitionItems'] }),
  });
  return (
    <div className="acquisition-provenance-editor">
      <input
        className="acquisition-link-input"
        placeholder="audio from: paste a URL, or a label like cd-rip…"
        value={audioFrom}
        onChange={e => setAudioFrom(e.target.value)}
      />
      <button
        className="acquisition-action-button"
        disabled={!audioFrom.trim() || mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        {item.provenance ? 'update' : 'set'}
      </button>
      {mutation.isError && (
        <span className="acquisition-error">{(mutation.error as Error).message}</span>
      )}
    </div>
  );
}

function ItemDetail({ item, onClose }: { item: SourceItem; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [linkSearch, setLinkSearch] = useState('');
  const [audioFrom, setAudioFrom] = useState('');
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['acquisitionItems'] });

  const acceptMutation = useMutation({
    mutationFn: () => api.acquisition.acceptMatch(item.id),
    onSuccess: invalidate,
  });
  const rejectMutation = useMutation({
    mutationFn: () => api.acquisition.rejectMatch(item.id),
    onSuccess: invalidate,
  });
  const linkMutation = useMutation({
    mutationFn: (trackId: number) => api.acquisition.linkToTrack(item.id, trackId, audioFrom.trim() || undefined),
    onSuccess: () => { setLinkSearch(''); setAudioFrom(''); invalidate(); },
  });
  const queueMutation = useMutation({
    mutationFn: () => api.acquisition.queueDownload(item.id),
    onSuccess: invalidate,
  });
  const ignoreMutation = useMutation({
    mutationFn: () => api.acquisition.ignoreItem(item.id),
    onSuccess: invalidate,
  });
  const restoreMutation = useMutation({
    mutationFn: () => api.acquisition.restoreItem(item.id),
    onSuccess: invalidate,
  });

  const { data: searchResults } = useQuery({
    queryKey: ['acquisitionLinkSearch', linkSearch],
    queryFn: () => api.tracks.list(1, 20, { search: linkSearch }),
    enabled: linkSearch.length >= 2,
  });

  const corr = item.correspondence;
  return (
    <div className="acquisition-detail">
      <div className="acquisition-detail-header">
        <span className="acquisition-detail-title">{item.title}</span>
        <button className="acquisition-detail-close" onClick={onClose}>✕</button>
      </div>
      <div className="acquisition-item-sub">
        {item.uploader} · {formatDuration(item.duration_ms)} ·{' '}
        <a href={item.permalink_url} target="_blank" rel="noreferrer">soundcloud ↗</a>
      </div>

      {corr?.status === 'proposed' && (
        <>
          <div className="acquisition-compare">
            <div className="acquisition-compare-col">
              <div className="acquisition-sidebar-heading">soundcloud</div>
              <div>{item.title}</div>
              <div className="acquisition-item-sub">{item.uploader}</div>
              <div className="acquisition-item-sub">{formatDuration(item.duration_ms)}</div>
            </div>
            <div className="acquisition-compare-col">
              <div className="acquisition-sidebar-heading">library track</div>
              <div>{corr.track_artist} - {corr.track_title}</div>
              <div className="acquisition-item-sub">
                {corr.track_duration_secs != null
                  ? formatDuration(corr.track_duration_secs * 1000)
                  : 'unknown duration'}
              </div>
              <div className="acquisition-score">
                similarity {Math.round((corr.score ?? 0) * 100)}%
              </div>
            </div>
          </div>
          <div className="acquisition-detail-actions">
            <button
              className="acquisition-action-button acquisition-action-accept"
              onClick={() => acceptMutation.mutate()}
            >
              accept match
            </button>
            <button
              className="acquisition-action-button"
              onClick={() => rejectMutation.mutate()}
            >
              reject
            </button>
          </div>
        </>
      )}

      {corr?.status === 'confirmed' && (
        <div className="acquisition-detail-linked">
          ✓ corresponds to <b>{corr.track_artist} - {corr.track_title}</b>
          {item.provenance && (
            <span className="acquisition-item-sub">
              {' · audio '}
              {item.provenance.asserted ? `via ${item.provenance.label}` : `downloaded by manadj`}
              {item.provenance.url && (
                <> (<a href={item.provenance.url} target="_blank" rel="noreferrer">link</a>)</>
              )}
            </span>
          )}
          {/* asserted (or missing) provenance stays editable; recorded is ground truth */}
          {(!item.provenance || item.provenance.asserted) && (
            <ProvenanceEditor item={item} />
          )}
        </div>
      )}

      {item.download?.error && (
        <div className="acquisition-error">
          download failed: {item.download.error}
          {/drm/i.test(item.download.error) && (
            <div className="acquisition-drm-hint">
              DRM-protected (SoundCloud Go+) tracks can never be downloaded — ignore this item,
              or acquire the audio elsewhere and link it manually.
            </div>
          )}
        </div>
      )}

      {(item.state === 'new' || (item.state === 'queued' && item.download?.task_state === 'failed')) && (
        <div className="acquisition-detail-actions">
          <button
            className="acquisition-action-button acquisition-action-queue"
            onClick={() => queueMutation.mutate()}
            disabled={queueMutation.isPending}
          >
            ⇣ {item.download?.task_state === 'failed' ? 'retry download' : 'queue download'}
          </button>
          <button
            className="acquisition-action-button"
            onClick={() => ignoreMutation.mutate()}
            disabled={ignoreMutation.isPending}
          >
            ignore
          </button>
        </div>
      )}

      {item.state === 'ignored' && (
        <div className="acquisition-detail-actions">
          <button
            className="acquisition-action-button"
            onClick={() => restoreMutation.mutate()}
            disabled={restoreMutation.isPending}
          >
            restore to new
          </button>
        </div>
      )}

      {corr?.status !== 'confirmed' && (
        <div className="acquisition-manual-link">
          <div className="acquisition-sidebar-heading">
            {corr?.status === 'proposed' ? 'or link a different library track' : 'manual link'}
          </div>
          <input
            className="acquisition-link-input"
            placeholder="search library tracks by title, artist, or filename…"
            value={linkSearch}
            onChange={e => setLinkSearch(e.target.value)}
          />
          <input
            className="acquisition-link-input acquisition-audio-from"
            placeholder="audio from (optional): paste a URL, or a label like cd-rip…"
            title="Asserts Audio Provenance: where this Track's audio actually came from"
            value={audioFrom}
            onChange={e => setAudioFrom(e.target.value)}
          />
          {(searchResults?.items ?? []).slice(0, 8).map((track: Track) => (
            <button
              key={track.id}
              className="acquisition-link-result"
              onClick={() => linkMutation.mutate(track.id)}
            >
              {track.artist ?? '?'} - {track.title ?? track.filename}
              {track.duration_secs != null && (
                <span className="acquisition-link-duration">
                  {' · '}{formatDuration(track.duration_secs * 1000)}
                </span>
              )}
            </button>
          ))}
          {linkSearch.length >= 2 && searchResults && searchResults.items.length === 0 && (
            <div className="acquisition-item-sub">no library tracks match</div>
          )}
        </div>
      )}
    </div>
  );
}
