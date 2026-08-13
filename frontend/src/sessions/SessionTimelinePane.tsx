/**
 * The Library's Session pane (sessions 04, library integration): resolves
 * the selected Session's row and mounts the timeline in the tracklist's
 * flex cell (the SetDetailPane posture — one flex:1 child, own scroll).
 * Consumes the one-shot deep-link focus moment on mount.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { SessionTimelineView } from './SessionTimelineView';
import { consumeSessionFocusS } from './openSession';

export function SessionTimelinePane({ sessionUuid }: { sessionUuid: string }) {
  const { data: rows } = useQuery({ queryKey: ['sessions'], queryFn: api.sessions.list });
  // One-shot: the deep-link moment, read exactly once per pane mount
  // (lazy initializer — never re-runs on re-render).
  const [focusS] = useState<number | null>(() => consumeSessionFocusS());

  const session = rows?.find((r) => r.uuid === sessionUuid) ?? null;
  if (!session) {
    return (
      <div style={{ flex: 1, padding: 24, color: 'var(--overlay0)' }}>
        {rows === undefined ? 'Loading…' : 'Session not found (deleted?).'}
      </div>
    );
  }
  return <SessionTimelineView session={session} focusS={focusS} />;
}
