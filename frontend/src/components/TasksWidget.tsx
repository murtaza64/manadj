import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { TaskRow, TaskState, TaskSummary } from '../types';
import { TASKS_ACTIVE_POLL_MS, taskSummaryPollMs } from './taskPolling';
import './TasksWidget.css';

const SUMMARY_KEY = ['tasks', 'summary'] as const;

function ageLabel(value: string | null): string {
  if (!value) return 'unknown';
  return new Date(value).toLocaleString();
}

function TaskDrawer({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<TaskState | ''>('');
  const [type, setType] = useState('');
  const filters = { state: state || undefined, type: type.trim() || undefined };
  const queryKey = ['tasks', 'rows', filters.state ?? '', filters.type ?? ''] as const;
  const { data = [], isLoading, isError } = useQuery({
    queryKey,
    queryFn: () => api.tasks.list(filters),
    refetchInterval: TASKS_ACTIVE_POLL_MS,
  });
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['tasks', 'rows'] }),
      queryClient.invalidateQueries({ queryKey: SUMMARY_KEY }),
    ]);
  };
  const retry = useMutation({ mutationFn: api.tasks.retry, onSuccess: refresh });
  const dismiss = useMutation({ mutationFn: api.tasks.dismiss, onSuccess: refresh });
  const retryBulk = useMutation({
    mutationFn: api.tasks.retryBulk,
    onSuccess: refresh,
  });
  const dismissBulk = useMutation({
    mutationFn: api.tasks.dismissBulk,
    onSuccess: refresh,
  });
  const busy = retry.isPending || dismiss.isPending || retryBulk.isPending || dismissBulk.isPending;

  return (
    <div className="tasks-drawer-scrim" role="presentation" onMouseDown={onClose}>
      <aside
        className="tasks-drawer"
        aria-label="Background tasks"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="tasks-drawer-header">
          <div>
            <span className="tasks-drawer-kicker">SYSTEM</span>
            <h2>Background tasks</h2>
          </div>
          <button className="tasks-drawer-close" onClick={onClose} aria-label="Close tasks">×</button>
        </header>

        <div className="tasks-filters">
          <label>
            STATE
            <select value={state} onChange={(event) => setState(event.target.value as TaskState | '')}>
              <option value="">Recent + unresolved</option>
              <option value="failed">Failed</option>
              <option value="running">Running</option>
              <option value="pending">Pending</option>
              <option value="done">Done</option>
            </select>
          </label>
          <label>
            TYPE
            <input value={type} onChange={(event) => setType(event.target.value)} placeholder="all" />
          </label>
        </div>

        <div className="tasks-bulk-actions">
          <button disabled={busy} onClick={() => retryBulk.mutate({ state: 'failed' })}>
            Retry all failed
          </button>
          <button className="danger" disabled={busy} onClick={() => dismissBulk.mutate({ state: 'failed' })}>
            Dismiss all failed
          </button>
          <button disabled={busy} onClick={() => dismissBulk.mutate({})}>
            Dismiss all
          </button>
        </div>

        <div className="tasks-list">
          {isLoading && <p className="tasks-empty">Loading…</p>}
          {isError && <p className="tasks-error">Could not load tasks.</p>}
          {!isLoading && !isError && data.length === 0 && <p className="tasks-empty">No tasks match.</p>}
          {data.map((task: TaskRow) => (
            <article className={`task-row ${task.state}${task.dismissed_at ? ' dismissed' : ''}`} key={task.id}>
              <div className="task-row-heading">
                <span className="task-state">{task.state}</span>
                <strong>{task.type}</strong>
                <span className="task-id">#{task.id}</span>
              </div>
              {task.ref && <div className="task-ref">{task.ref}</div>}
              {task.error && <pre className="task-error">{task.error}</pre>}
              <div className="task-row-footer">
                <time>{ageLabel(task.finished_at ?? task.started_at ?? task.created_at)}</time>
                <div>
                  {task.state === 'failed' && <button disabled={busy} onClick={() => retry.mutate(task.id)}>Retry</button>}
                  {!task.dismissed_at && <button disabled={busy} onClick={() => dismiss.mutate(task.id)}>Dismiss</button>}
                </div>
              </div>
            </article>
          ))}
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
    refetchInterval: (query) => taskSummaryPollMs(query.state.data),
  });
  const running = data?.counts.running ?? 0;
  const pending = data?.counts.pending ?? 0;
  const failures = data?.undismissed_failures ?? 0;
  const active = running > 0 || pending > 0;
  const label = active ? `${running} running / ${pending} pending` : 'Tasks';

  return (
    <>
      <button
        className={`tasks-widget${active ? ' active' : ''}${failures ? ' failed' : ''}`}
        onClick={() => setOpen(true)}
        title={data?.running_task ? `${data.running_task.type}: ${data.running_task.ref ?? 'no ref'}` : 'Background tasks'}
      >
        {active && <span className="tasks-spinner" aria-hidden="true" />}
        <span>{label}</span>
        {failures > 0 && <span className="tasks-failure-count" aria-label={`${failures} undismissed failures`}>{failures}</span>}
      </button>
      {open && <TaskDrawer onClose={() => setOpen(false)} />}
    </>
  );
}
