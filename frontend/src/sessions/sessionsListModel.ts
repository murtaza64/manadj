import type { SessionRowWire } from '../api/client';

export function sessionDate(iso: string): Date {
  return new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(iso) ? iso : `${iso}Z`);
}

export function sessionDuration(session: SessionRowWire, now = Date.now()): number {
  return Math.max(0, (session.ended_at ? sessionDate(session.ended_at).getTime() : now)
    - sessionDate(session.started_at).getTime());
}

export function groupSessionsByDay(rows: SessionRowWire[], now = Date.now()) {
  const groups = new Map<string, { day: Date; sessions: SessionRowWire[] }>();
  for (const row of rows) {
    const date = sessionDate(row.started_at);
    const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const key = `${day.getFullYear()}-${day.getMonth() + 1}-${day.getDate()}`;
    if (!groups.has(key)) groups.set(key, { day, sessions: [] });
    groups.get(key)!.sessions.push(row);
  }
  return [...groups].map(([key, group]) => ({ key, ...group,
    sessions: group.sessions.sort((a, b) => sessionDuration(b, now) - sessionDuration(a, now)
      || sessionDate(b.started_at).getTime() - sessionDate(a.started_at).getTime()
      || a.uuid.localeCompare(b.uuid)),
  })).sort((a, b) => b.day.getTime() - a.day.getTime());
}
