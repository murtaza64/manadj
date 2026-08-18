/**
 * Sessions list (Sessions PRD, ADR 0033): the persisted whole event logs —
 * "which nights did I play." Newest-first rows with start time, duration
 * (open Sessions read as "live"), the distinct Master-audible Track count
 * (issue 04), Take count, and a manual delete. Rows open the timeline;
 * deleting a Session never touches a Take.
 */
import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { CaptureEvent } from '../capture/events';
import { deriveTimeline } from './timelineModel';
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

/** The distinct Master-audible Track count for one Session, derived from
 * its whole event log through the SAME pure timeline model the timeline
 * uses (no divergent definition). Lazy + cached under the ['session',
 * uuid] key — opening the timeline afterwards is then free.
 *
 * Perf (issue 13): the derivation is MEMOIZED — this cell re-renders every
 * ~5s while recording (the sink invalidates ['sessions']), and re-reducing
 * every Session's full log per list render was an app-wide drag. An ended
 * Session's log is immutable: never refetch its multi-MB payload. */
function SessionTracksCell({ uuid, ended }: { uuid: string; ended: boolean }) {
  const { data } = useQuery({
    queryKey: ['session', uuid],
    queryFn: () => api.sessions.get(uuid),
    staleTime: ended ? Infinity : 60_000,
  });
  const count = useMemo(
    () => (data === undefined ? null : deriveTimeline(data.events as CaptureEvent[]).audibleTrackIds.length),
    [data]
  );
  if (count === null) return <span className="session-tracks-loading">…</span>;
  return <>{count}</>;
}

export function SessionsListView({ onOpen }: { onOpen?: (uuid: string) => void }) {
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
              <th>Tracks</th>
              <th>Takes</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr
                key={s.uuid}
                className={`session-row${onOpen ? ' openable' : ''}`}
                onClick={onOpen ? () => onOpen(s.uuid) : undefined}
                title={onOpen ? 'Open this Session’s timeline' : undefined}
              >
                <td className="session-when">{fmtWhen(s.started_at)}</td>
                <td className={`session-duration${s.ended_at === null ? ' live' : ''}`}>
                  {fmtDuration(s.started_at, s.ended_at)}
                </td>
                <td className="session-tracks" title="Distinct Tracks that became audible">
                  <SessionTracksCell uuid={s.uuid} ended={s.ended_at !== null} />
                </td>
                <td className="session-takes">{s.take_count}</td>
                <td>
                  <button
                    className="session-delete"
                    title="Delete this Session (Takes are kept)"
                    onClick={(e) => {
                      e.stopPropagation(); // never open the timeline on delete
                      void remove(s.uuid);
                    }}
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
