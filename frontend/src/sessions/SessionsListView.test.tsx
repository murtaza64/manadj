// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { api, type SessionRowWire } from '../api/client';
import { SessionsListView } from './SessionsListView';
import { groupSessionsByDay, sessionDate } from './sessionsListModel';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let host: HTMLDivElement;
let client: QueryClient;
afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  client?.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function row(uuid: string, minutes: number, start = new Date(2026, 8, 12, 12)): SessionRowWire {
  return { uuid, started_at: start.toISOString(),
    ended_at: new Date(start.getTime() + minutes * 60000).toISOString(), take_count: 2 };
}

it('groups local days newest first and sorts by duration, then recency, without mutating input', () => {
  const rows = [row('old', 90, new Date(2026, 8, 11, 23)), row('short', 2), row('long', 30),
    row('later', 30, new Date(2026, 8, 12, 14))];
  const groups = groupSessionsByDay(rows);
  expect(groups.map(g => g.sessions.map(s => s.uuid))).toEqual([['later', 'long', 'short'], ['old']]);
  expect(rows.map(s => s.uuid)).toEqual(['old', 'short', 'long', 'later']);
  expect(sessionDate('2026-09-12T12:00:00').toISOString()).toBe('2026-09-12T12:00:00.000Z');
  expect(sessionDate('2026-09-12T12:00:00-04:00').toISOString()).toBe('2026-09-12T16:00:00.000Z');
});

it('orders live sessions by elapsed length, not by a special live-first rank', () => {
  const short = row('live', 0);
  short.ended_at = null;
  const now = sessionDate(short.started_at).getTime() + 5 * 60000;
  expect(groupSessionsByDay([short, row('long', 10)], now)[0].sessions.map(s => s.uuid)).toEqual(['long', 'live']);
});

it('advances live duration and rank even when the cached headers stay identical', async () => {
  vi.useFakeTimers();
  const live = { ...row('clock-live', 0), ended_at: null };
  vi.setSystemTime(sessionDate(live.started_at).getTime() + 59_000);
  client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  client.setQueryData(['sessions'], [row('clock-ended', 1), live]);
  for (const session of ['clock-ended', 'clock-live']) {
    client.setQueryData(['session', session], { events: [] });
    client.setQueryData(['routine-candidates', session], []);
  }
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(<QueryClientProvider client={client}><SessionsListView onOpen={() => {}} /></QueryClientProvider>));
  expect(host.querySelector('.session-row')?.getAttribute('data-session-uuid')).toBe('clock-ended');
  await act(async () => vi.advanceTimersByTime(30_000));
  expect(host.querySelector('.session-row')?.getAttribute('data-session-uuid')).toBe('clock-live');
  expect(host.querySelector('.session-duration')?.textContent).toBe('1m');
});

it('fetches cold summaries only when their rows approach the viewport', async () => {
  const intersects: (() => void)[] = [];
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
      intersects.push(() => callback([{ isIntersecting: true }]));
    }
    observe() {} disconnect() {}
  });
  const session = row('cold', 10);
  const get = vi.spyOn(api.sessions, 'get').mockResolvedValue({ ...session, events: [] });
  const mine = vi.spyOn(api.routineCandidates, 'forSession').mockResolvedValue([]);
  client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  client.setQueryData(['sessions'], [session]);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(<QueryClientProvider client={client}><SessionsListView /></QueryClientProvider>));
  expect(get).not.toHaveBeenCalled();
  expect(mine).not.toHaveBeenCalled();
  await act(async () => intersects[0]());
  expect(get).toHaveBeenCalledWith('cold');
  expect(mine).toHaveBeenCalledWith('cold');
});

it('shows five per day, expands independently, previews tracks and keeps expansion after a timeline round-trip', async () => {
  const rows = Array.from({ length: 7 }, (_, i) => row(`session-${i}`, i + 1));
  rows.push(row('yesterday', 90, new Date(2026, 8, 11, 12)));
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(['sessions'], rows);
  for (const session of rows) {
    client.setQueryData(['session', session.uuid], { ...session, events: [
      { t: 0, kind: 'control', control: 'crossfaderEnabled', channel: null, value: 0 },
      { t: 0, kind: 'control', control: 'fader', channel: 'B', value: 1 },
      { t: 0, kind: 'control', control: 'fader', channel: 'A', value: 1 },
      { t: 1, kind: 'load', channel: 'B', trackId: 11, bpm: 120 },
      { t: 2, kind: 'transport', channel: 'B', action: 'play', playhead: 0 },
      { t: 3, kind: 'load', channel: 'A', trackId: 12, bpm: 120 },
      { t: 4, kind: 'transport', channel: 'A', action: 'play', playhead: 0 },
      { t: 10, kind: 'tick', playheads: { A: 6, B: 8 } },
    ] });
    client.setQueryData(['routine-candidates', session.uuid], [{ uuid: 'candidate' }]);
  }
  client.setQueryData(['track', 11], { title: 'First heard' });
  client.setQueryData(['track', 12], { title: 'Second heard' });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const onOpen = vi.fn();
  const render = () => root!.render(<QueryClientProvider client={client}><SessionsListView onOpen={onOpen} /></QueryClientProvider>);
  await act(async () => render());
  const days = host.querySelectorAll('.session-day');
  expect(days[0].querySelectorAll('.session-row')).toHaveLength(5);
  expect(days[1].querySelectorAll('.session-row')).toHaveLength(1);
  expect(days[0].querySelector('.session-row')?.getAttribute('data-session-uuid')).toBe('session-6');
  expect(days[0].querySelector('.session-preview')?.textContent).toBe('First heard / Second heard');
  expect(days[0].querySelector('.session-stats')?.textContent).toContain('1 mined candidate');
  act(() => (days[0].querySelector('.session-show-more') as HTMLButtonElement).click());
  expect(days[0].querySelectorAll('.session-row')).toHaveLength(7);
  expect(days[0].querySelector('.session-show-more')?.getAttribute('aria-expanded')).toBe('true');
  act(() => (days[0].querySelector('.session-open') as HTMLButtonElement).click());
  expect(onOpen).toHaveBeenCalledWith('session-6');
  act(() => root!.render(null));
  await act(async () => render());
  expect(host.querySelector('.session-day')?.querySelectorAll('.session-row')).toHaveLength(7);
  const remove = vi.spyOn(api.sessions, 'delete').mockRejectedValue(new Error('Delete refused'));
  await act(async () => (host.querySelector('.session-delete') as HTMLButtonElement).click());
  expect(remove).toHaveBeenCalledWith('session-6');
  expect(onOpen).toHaveBeenCalledTimes(1);
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Delete refused');
  act(() => (host.querySelector('.session-show-more') as HTMLButtonElement).click());
});
