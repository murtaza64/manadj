/**
 * Sessions list (Sessions PRD, ADR 0033): the persisted whole event logs —
 * "which nights did I play." Modest on purpose: newest-first rows with
 * start time, duration (open Sessions read as "live"), Take count, and a
 * manual delete. The future timeline (issue 04) opens from here; deleting
 * a Session never touches a Take (ADR 0033).
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import './sessionsList.css';

function fmtWhen(iso: string): string {
  const d = new Date(iso.endsWith('Z') || iso.includes('+') ? iso : `${iso}Z`);
  return d.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtDuration(startedAt: string, endedAt: string | null): string {
  if (endedAt === null) return 'live';
  const norm = (s: string) => (s.endsWith('Z') || s.includes('+') ? s : `${s}Z`);
  const sec = (new Date(norm(endedAt)).getTime() - new Date(norm(startedAt)).getTime()) / 1000;
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}h${String(m).padStart(2, '0')}m`;
}

export function SessionsListView() {
  const queryClient = useQueryClient();
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['sessions'] });

  const { data: rows, error } = useQuery({ queryKey: ['sessions'], queryFn: api.sessions.list });

  const remove = async (uuid: string) => {
    await api.sessions.delete(uuid).catch((err) => console.error('session delete failed', err));
    invalidate();
  };

  return (
    <div className="sessions-list">
      {error ? <div className="sessions-list-error">{String(error)}</div> : null}
      {rows === undefined ? (
        <div className="sessions-list-empty">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="sessions-list-empty">
          No Sessions yet — play in the Performance view and the whole night lands here.
        </div>
      ) : (
        <table className="sessions-list-table">
          <thead>
            <tr>
              <th>Started</th>
              <th>Duration</th>
              <th>Takes</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.uuid} className="session-row">
                <td className="session-when">{fmtWhen(s.started_at)}</td>
                <td className={`session-duration${s.ended_at === null ? ' live' : ''}`}>
                  {fmtDuration(s.started_at, s.ended_at)}
                </td>
                <td className="session-takes">{s.take_count}</td>
                <td>
                  <button
                    className="session-delete"
                    title="Delete this Session (Takes are kept)"
                    onClick={() => void remove(s.uuid)}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
