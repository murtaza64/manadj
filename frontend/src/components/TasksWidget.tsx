// Background tasks (gh#342 pass): the TopBar badge and its drawer.
//
// The badge has three states — idle (quiet TASKS), working (running count,
// a progress sliver for the current download, queued count) and attention
// (how many subjects need someone). "Attention" is the newest task per
// subject that failed and was not dismissed, not every failed row ever.
//
// The drawer is a worklist, not a log: Needs attention (one entry per
// subject, named, with its next step), Running (progress), Queued (by
// type), History (collapsed, dismissible). Raw ids never appear; every row
// is "Soulseek download · Hoax - Spark It".
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { TaskRow, TaskSummary } from '../types';
import { requestLibraryTrack } from '../library/openTrack';
import { requestSessionMoment } from '../sessions/openSession';
import { requestAcquisitionItem } from './acquisition/openAcquisition';
import { TASKS_ACTIVE_POLL_MS, taskSummaryPollMs } from './taskPolling';
import './TasksWidget.css';

const SUMMARY_KEY = ['tasks', 'summary'] as const;
const ATTENTION_KEY = ['tasks', 'attention'] as const;
const ACTIVE_KEY = ['tasks', 'active'] as const;
const HISTORY_KEY = ['tasks', 'history'] as const;

function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
  return `${Math.round(secs / 86400)}d ago`;
}

/** "Hoax - Spark It" / "Session · 2026-09-04" — never a raw id. */
function subjectLabel(t: TaskRow): string {
  const s = t.subject;
  if (!s) return t.ref ?? '';
  if (s.kind === 'session') return `Session${s.detail ? ` · ${new Date(s.detail).toLocaleString('sv').slice(0, 16)}` : ''}`;
  return s.detail ? `${s.detail} - ${s.label}` : s.label;
}

/** Jump to the thing the task is about. */
function openSubject(t: TaskRow): void {
  const s = t.subject;
  if (!s) return;
  if (s.kind === 'source_item') requestAcquisitionItem(Number(s.id), s.label);
  else if (s.kind === 'track') requestLibraryTrack(s.label);
  else if (s.kind === 'session') requestSessionMoment({ sessionUuid: s.id, atS: null });
}

function subjectVerb(t: TaskRow): string | null {
  switch (t.subject?.kind) {
    case 'source_item':
      return 'open in Acquisition';
    case 'track':
      return 'show in Library';
    case 'session':
      return 'open Session';
    default:
      return null;
  }
}

/** One short line that says what to do about a failure. */
function nextStep(t: TaskRow): string {
  if (t.fix === 'acquisition') {
    if (/drm/i.test(t.error ?? '')) return 'SoundCloud will never serve this (Go+). Get it from Soulseek or ignore it — in Acquisition.';
    if (/429|rate.?limit/i.test(t.error ?? '')) return 'Rate-limited by SoundCloud; it retries by itself. Nothing to do yet.';
    if (/not completed within|transfer failed|peer/i.test(t.error ?? '')) return 'The peer never delivered. Pick another candidate or ⚡ auto — in Acquisition.';
    return 'Choose where to get it from — in Acquisition.';
  }
  if (t.fix === 'retry') {
    if (t.type === 'analysis' && /grid|beat/i.test(t.error ?? '')) return 'Beat analysis bailed on this file. Retry, or set the grid by hand in the editor.';
    return 'Usually transient — retry. If it keeps failing, dismiss and look at the file.';
  }
  return 'Dismiss when seen.';
}

function Progress({ t }: { t: TaskRow }) {
  if (t.progress == null) return <span className="task-progress task-progress-indeterminate" aria-label="working" />;
  return (
    <span className="task-progress" title={t.progress_label ?? `${Math.round(t.progress * 100)}%`}>
      <span className="task-progress-fill" style={{ width: `${Math.round(t.progress * 100)}%` }} />
    </span>
  );
}

function TaskLine({ t, children }: { t: TaskRow; children?: React.ReactNode }) {
  const verb = subjectVerb(t);
  return (
    <div className={`task-line task-line-${t.state === 'pending' && t.progress != null ? 'running' : t.state}${t.dismissed_at ? ' dismissed' : ''}${t.superseded ? ' superseded' : ''}`}>
      <div className="task-line-head">
        <span className="task-type">{t.type_label}</span>
        <span className="task-sep">·</span>
        {verb && t.subject ? (
          <button className="task-subject task-subject-link" onClick={() => openSubject(t)} title={verb}>
            {subjectLabel(t)}
          </button>
        ) : (
          <span className="task-subject">{subjectLabel(t)}</span>
        )}
        <span className="task-when">{timeAgo(t.finished_at ?? t.started_at ?? t.created_at)}</span>
      </div>
      {children}
    </div>
  );
}

function TaskDrawer({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [historyOpen, setHistoryOpen] = useState(false);
  const summary = useQuery({ queryKey: SUMMARY_KEY, queryFn: api.tasks.summary, refetchInterval: TASKS_ACTIVE_POLL_MS });
  const attention = useQuery({ queryKey: ATTENTION_KEY, queryFn: api.tasks.attention, refetchInterval: TASKS_ACTIVE_POLL_MS });
  const active = useQuery({ queryKey: ACTIVE_KEY, queryFn: api.tasks.active, refetchInterval: TASKS_ACTIVE_POLL_MS });
  const history = useQuery({
    queryKey: HISTORY_KEY,
    queryFn: () => api.tasks.list({ state: 'failed' }),
    enabled: historyOpen,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['tasks'] });
  const retry = useMutation({ mutationFn: api.tasks.retry, onSuccess: refresh });
  const dismiss = useMutation({ mutationFn: api.tasks.dismiss, onSuccess: refresh });
  const retryBulk = useMutation({ mutationFn: api.tasks.retryBulk, onSuccess: refresh });
  const dismissBulk = useMutation({ mutationFn: api.tasks.dismissBulk, onSuccess: refresh });
  const busy = retry.isPending || dismiss.isPending || retryBulk.isPending || dismissBulk.isPending;

  const needs = attention.data ?? [];
  // a polling download is "pending" between ticks but its bytes are moving
  const running = (active.data ?? []).filter(t => t.state === 'running' || t.progress != null);
  const queued = (active.data ?? []).filter(t => t.state === 'pending' && t.progress == null);
  const queuedByType = Object.entries(summary.data?.pending_by_type ?? {}).sort((a, b) => b[1] - a[1]);
  const retryable = needs.filter(t => t.fix === 'retry');
  const pastFailures = (history.data ?? []).filter(t => t.superseded || t.dismissed_at);

  return (
    <div className="tasks-drawer-scrim" role="presentation" onMouseDown={onClose}>
      <aside className="tasks-drawer" aria-label="Background tasks" onMouseDown={e => e.stopPropagation()}>
        <header className="tasks-drawer-header">
          <div>
            <span className="tasks-drawer-kicker">SYSTEM</span>
            <h2>Background tasks</h2>
          </div>
          <button className="tasks-drawer-close" onClick={onClose} aria-label="Close tasks">×</button>
        </header>

        <div className="tasks-sections">
          <section className={`tasks-section${needs.length ? ' hot' : ''}`}>
            <div className="tasks-section-head">
              <span>needs attention</span>
              <b>{needs.length}</b>
              <span className="tasks-spacer" />
              {retryable.length > 1 && (
                <button className="btn btn-mini" disabled={busy} onClick={() => retryBulk.mutate({ state: 'failed' })}>
                  retry {retryable.length}
                </button>
              )}
              {needs.length > 1 && (
                <button className="btn btn-mini" disabled={busy} onClick={() => dismissBulk.mutate({ state: 'failed' })} title="clear every failure from the worklist (the Acquisition rows keep their state)">
                  dismiss all
                </button>
              )}
            </div>
            {attention.isLoading && <p className="tasks-empty">Loading…</p>}
            {!attention.isLoading && needs.length === 0 && <p className="tasks-empty">Nothing needs you.</p>}
            {needs.map(t => (
              <TaskLine key={t.id} t={t}>
                {t.error && <div className="task-error" title={t.error}>{t.error}</div>}
                <div className="task-next">{nextStep(t)}</div>
                <div className="task-actions">
                  {t.fix === 'acquisition' && t.subject && (
                    <button className="btn btn-mini btn-primary" onClick={() => { openSubject(t); onClose(); }}>
                      open in Acquisition
                    </button>
                  )}
                  {t.fix === 'retry' && (
                    <button className="btn btn-mini btn-primary" disabled={busy} onClick={() => retry.mutate(t.id)}>
                      retry
                    </button>
                  )}
                  {t.fix === 'retry' && t.subject && subjectVerb(t) && (
                    <button className="btn btn-mini" onClick={() => { openSubject(t); onClose(); }}>
                      {subjectVerb(t)}
                    </button>
                  )}
                  <button className="btn btn-mini" disabled={busy} onClick={() => dismiss.mutate(t.id)} title="drop from this list">
                    dismiss
                  </button>
                </div>
              </TaskLine>
            ))}
          </section>

          <section className="tasks-section">
            <div className="tasks-section-head">
              <span>running</span>
              <b>{running.length}</b>
            </div>
            {running.length === 0 && <p className="tasks-empty">idle</p>}
            {running.map(t => (
              <TaskLine key={t.id} t={t}>
                <div className="task-progress-row">
                  <Progress t={t} />
                  <span className="task-progress-label">{t.progress_label ?? (t.progress != null ? `${Math.round(t.progress * 100)}%` : '')}</span>
                </div>
              </TaskLine>
            ))}
          </section>

          <section className="tasks-section">
            <div className="tasks-section-head">
              <span>queued</span>
              <b>{queued.length}</b>
              <span className="tasks-spacer" />
              {queuedByType.map(([label, n]) => (
                <span key={label} className="task-chip">
                  {label} <b>{n}</b>
                </span>
              ))}
            </div>
            {queued.slice(0, 8).map(t => (
              <TaskLine key={t.id} t={t}>
                {t.not_before && new Date(t.not_before) > new Date() && (
                  <div className="task-next">waits until {new Date(t.not_before).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} (rate-limit backoff)</div>
                )}
              </TaskLine>
            ))}
            {queued.length > 8 && <p className="tasks-empty">+{queued.length - 8} more in the queue</p>}
          </section>

          <section className="tasks-section">
            <button className="tasks-section-head tasks-section-toggle" onClick={() => setHistoryOpen(!historyOpen)}>
              <span>{historyOpen ? '▾' : '▸'} past failures</span>
              <span className="tasks-section-hint">superseded or dismissed — history, not work</span>
            </button>
            {historyOpen && history.isLoading && <p className="tasks-empty">Loading…</p>}
            {historyOpen && !history.isLoading && pastFailures.length === 0 && <p className="tasks-empty">none</p>}
            {historyOpen &&
              pastFailures.slice(0, 40).map(t => (
                <TaskLine key={t.id} t={t}>
                  {t.error && <div className="task-error" title={t.error}>{t.error}</div>}
                  <div className="task-next">{t.superseded ? 'a later attempt replaced this one' : 'dismissed'}</div>
                </TaskLine>
              ))}
          </section>
        </div>
      </aside>
    </div>
  );
}

export function TasksWidget() {
  const [open, setOpen] = useState(false);
  const { data } = useQuery<TaskSummary>({
    queryKey: SUMMARY_KEY,
    queryFn: api.tasks.summary,
    refetchInterval: query => taskSummaryPollMs(query.state.data),
  });
  const running = data?.counts.running ?? 0;
  const pending = data?.counts.pending ?? 0;
  const attention = data?.attention ?? 0;
  const active = running > 0 || pending > 0;
  const current = data?.running?.[0] ?? null;
  const label = active ? `${running} running${pending ? ` · ${pending} queued` : ''}` : 'TASKS';
  const title = current
    ? `${current.type_label}: ${subjectLabel(current)}${current.progress_label ? ` · ${current.progress_label}` : ''}`
    : attention
      ? `${attention} need attention`
      : 'Background tasks';

  return (
    <>
      <button
        className={`tasks-widget${active ? ' active' : ''}${attention ? ' attention' : ''}`}
        onClick={() => setOpen(true)}
        title={title}
      >
        {active && <span className="tasks-spinner" aria-hidden="true" />}
        <span>{label}</span>
        {current && current.progress != null && (
          <span className="tasks-sliver" aria-hidden="true">
            <span style={{ width: `${Math.round(current.progress * 100)}%` }} />
          </span>
        )}
        {attention > 0 && (
          <span className="tasks-attention-count" aria-label={`${attention} need attention`}>
            {attention}
          </span>
        )}
      </button>
      {open && <TaskDrawer onClose={() => setOpen(false)} />}
    </>
  );
}
