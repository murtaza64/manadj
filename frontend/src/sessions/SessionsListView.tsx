import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type SessionRowWire } from '../api/client';
import type { CaptureEvent } from '../capture/events';
import { deriveTimeline } from './timelineModel';
import { groupSessionsByDay, sessionDate, sessionDuration } from './sessionsListModel';
import './sessionsList.css';

function fmtDuration(session: SessionRowWire, now: number): string {
  const sec = sessionDuration(session, now) / 1000;
  if (sec < 60) return `${Math.floor(sec)}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  return `${Math.floor(sec / 3600)}h ${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}m`;
}

function SessionSummary({ session }: { session: SessionRowWire }) {
  const previewRef = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (visible || !previewRef.current) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: '300px' });
    observer.observe(previewRef.current);
    return () => observer.disconnect();
  }, [visible]);
  const { data, error } = useQuery({
    queryKey: ['session', session.uuid],
    queryFn: () => api.sessions.get(session.uuid),
    staleTime: session.ended_at !== null ? Infinity : 60_000,
    gcTime: 60_000,
    enabled: visible,
  });
  const { data: candidates, error: candidateError } = useQuery({
    queryKey: ['routine-candidates', session.uuid],
    queryFn: () => api.routineCandidates.forSession(session.uuid),
    enabled: visible,
  });
  // Keep the full-log reduction out of ordinary list refreshes.
  const trackIds = useMemo(() => visible && data
    ? deriveTimeline(data.events as CaptureEvent[]).audibleTrackIds : null, [visible, data]);
  const tracks = useQueries({ queries: (trackIds?.slice(0, 3) ?? []).map(id => ({
    queryKey: ['track', id], queryFn: () => api.tracks.getById(id), staleTime: 60_000,
  })) });
  const titles = tracks.map((q, i) => q.data?.title || q.data?.filename || `#${trackIds![i]}`);
  const preview = titles.join(' / ');
  return <>
    <span className="session-preview" title={preview} ref={previewRef}>
      {error ? 'Track preview unavailable' : trackIds === null ? 'Loading tracks...' :
        trackIds.length === 0 ? 'No audible tracks' : <>{preview}
          {trackIds.length > 3 && <span className="session-preview-more"> +{trackIds.length - 3} more</span>}
        </>}
    </span>
    <span className="session-stats">
      <span title="Distinct tracks that became Master-audible">{trackIds?.length ?? '-'} {trackIds?.length === 1 ? 'track' : 'tracks'}</span>
      <span>{session.take_count} {session.take_count === 1 ? 'take' : 'takes'}</span>
      <span className={candidates?.length ? 'session-candidates' : undefined}
        title={candidateError ? 'Candidate count unavailable' : 'Routine candidates found by the miner, including confirmed spans'}>
        {candidates?.length ?? '-'} mined {candidates?.length === 1 ? 'candidate' : 'candidates'}
      </span>
    </span>
  </>;
}

// Retain expansion as well as scroll when returning from a timeline.
let lastListScrollTop = 0;
let expandedDays = new Set<string>();

export function SessionsListView({ onOpen }: { onOpen?: (uuid: string) => void }) {
  const queryClient = useQueryClient();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rowsReady = useRef(false);
  const [expanded, setExpanded] = useState(expandedDays);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now);
  const { data: rows, error } = useQuery({ queryKey: ['sessions'], queryFn: api.sessions.list });
  const hasLive = rows?.some(row => row.ended_at === null) ?? false;
  useEffect(() => {
    if (!hasLive) return;
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [hasLive]);
  const groups = useMemo(() => groupSessionsByDay(rows ?? [], now), [rows, now]);

  const remove = async (uuid: string) => {
    setDeleting(uuid);
    setDeleteError(null);
    try {
      await api.sessions.delete(uuid);
      await queryClient.invalidateQueries({ queryKey: ['sessions'] });
    } catch (err) {
      setDeleteError(String(err));
    } finally {
      setDeleting(null);
    }
  };

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || rows === undefined || rowsReady.current) return;
    rowsReady.current = true;
    el.scrollTop = lastListScrollTop;
  }, [rows]);

  return <div className="sessions-list" data-tour="sessions.list" ref={scrollRef}
    onScroll={e => { lastListScrollTop = e.currentTarget.scrollTop; }}>
    <header className="sessions-list-header">
      <h2>Sessions</h2>
      <span>By day / longest first</span>
    </header>
    {error || deleteError ? <div className="sessions-list-error" role="alert">{String(error ?? deleteError)}</div> : null}
    {rows === undefined ? <div className="sessions-list-empty">{error ? 'Could not load sessions.' : 'Loading sessions...'}</div> :
      rows.length === 0 ? <div className="sessions-list-empty">No sessions yet. Play in Performance to start one.</div> :
      groups.map(({ key, day, sessions }) => {
        const isExpanded = expanded.has(key);
        return <section className="session-day" key={key} aria-labelledby={`day-${key}`}>
          <header className="session-day-header">
            <h3 id={`day-${key}`}>{day.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</h3>
            <span>{sessions.length} {sessions.length === 1 ? 'session' : 'sessions'}</span>
          </header>
          <ul id={`sessions-${key}`} className="session-day-list">
            {(isExpanded ? sessions : sessions.slice(0, 5)).map(session => <li className="session-row" key={session.uuid} data-session-uuid={session.uuid}>
              <button className="session-open" disabled={!onOpen} onClick={() => onOpen?.(session.uuid)}
                aria-label={`Open session from ${sessionDate(session.started_at).toLocaleString()}`}>
                <span className="session-when">
                  <time dateTime={sessionDate(session.started_at).toISOString()}>{sessionDate(session.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
                  {session.ended_at === null && <span className="session-live">Live</span>}
                </span>
                <span className="session-duration">{fmtDuration(session, now)}</span>
                <SessionSummary session={session} />
                <span className="session-open-hint" aria-hidden="true">Open timeline</span>
              </button>
              <button className="btn btn-danger btn-mini session-delete" title="Delete this Session (Takes are kept)"
                aria-label={`Delete session from ${sessionDate(session.started_at).toLocaleString()}`}
                disabled={deleting !== null} onClick={() => void remove(session.uuid)}>Delete</button>
            </li>)}
          </ul>
          {sessions.length > 5 && <button className="btn btn-secondary session-show-more" aria-expanded={isExpanded}
            aria-controls={`sessions-${key}`} onClick={() => {
              const next = new Set(expanded);
              if (isExpanded) next.delete(key); else next.add(key);
              expandedDays = next;
              setExpanded(next);
            }}>{isExpanded ? 'Show less' : `Show more (${sessions.length - 5})`}</button>}
        </section>;
      })}
  </div>;
}
