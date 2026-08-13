/**
 * Sessions view container (sessions 04): the list is the entry point, a
 * selected row opens its timeline. Consumes pending deep-link requests
 * (openSession.ts — the history's "view in Session") the same way the
 * Transition editor consumes take-review requests: once on mount and on
 * the event while mounted.
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { SessionsListView } from '../components/sessions/SessionsListView';
import { SessionTimelineView } from './SessionTimelineView';
import { OPEN_SESSION_EVENT, consumeSessionMoment } from './openSession';

interface Opened {
  uuid: string;
  focusS: number | null;
}

export function SessionsView() {
  const [opened, setOpened] = useState<Opened | null>(null);
  const { data: rows } = useQuery({ queryKey: ['sessions'], queryFn: api.sessions.list });

  // Deep-link consumption (takeReview.ts pattern): once on mount catches a
  // request stashed before the view switch; the listener catches requests
  // made while already mounted.
  useEffect(() => {
    const consume = () => {
      const req = consumeSessionMoment();
      if (req) setOpened({ uuid: req.sessionUuid, focusS: req.atS });
    };
    consume();
    window.addEventListener(OPEN_SESSION_EVENT, consume);
    return () => window.removeEventListener(OPEN_SESSION_EVENT, consume);
  }, []);

  const session = opened ? rows?.find((r) => r.uuid === opened.uuid) ?? null : null;

  if (opened && session) {
    return (
      <SessionTimelineView
        session={session}
        focusS={opened.focusS}
        onBack={() => setOpened(null)}
      />
    );
  }

  return <SessionsListView onOpen={(uuid) => setOpened({ uuid, focusS: null })} />;
}
