/**
 * The Library's Session pane (sessions 04, library integration): resolves
 * the selected Session's row and mounts the timeline in the tracklist's
 * flex cell (the SetDetailPane posture — one flex:1 child, own scroll).
 * Consumes the one-shot deep-link focus moment on mount.
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { SessionTimelineView } from './SessionTimelineView';
import { OPEN_SESSION_EVENT, peekSessionFocus } from './openSession';
import type { SessionFocus } from './openSession';

export function SessionTimelinePane({
  sessionUuid,
  onBack,
}: {
  sessionUuid: string;
  /** Back to the session LIST (gh#170 follow-up — scroll retained by the
   * list itself). */
  onBack?: () => void;
}) {
  const { data: rows } = useQuery({ queryKey: ['sessions'], queryFn: api.sessions.list });
  // Deep-link focus: peeked on mount AND re-peeked on every session-open
  // request — keep-alive panes stay mounted, so a mount-only read would
  // miss deep-links that arrive later (perf-layout 09).
  const [focus, setFocus] = useState<SessionFocus>(() => peekSessionFocus());
  useEffect(() => {
    const onOpen = () => setFocus(peekSessionFocus());
    window.addEventListener(OPEN_SESSION_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_SESSION_EVENT, onOpen);
  }, []);

  const session = rows?.find((r) => r.uuid === sessionUuid) ?? null;
  if (!session) {
    return (
      <div style={{ flex: 1, padding: 24, color: 'var(--overlay0)' }}>
        {rows === undefined ? 'Loading…' : 'Session not found (deleted?).'}
      </div>
    );
  }
  // Keyed per session (sessions 21): a session switch is a fresh mount —
  // state comes from the per-uuid store, never leaks across sessions.
  return (
    <SessionTimelineView
      key={session.uuid}
      session={session}
      focusS={focus.atS}
      focusSpanS={focus.spanS}
      focusFlash={focus.flash}
      focusVersion={focus.version}
      onBack={onBack}
    />
  );
}
