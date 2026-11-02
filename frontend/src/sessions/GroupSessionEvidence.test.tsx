// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { api, type GroupSessionView, type SessionRowWire } from '../api/client';
import type { DeckEngine } from '../playback/DeckEngine';
import type { CaptureDeck } from '../capture/events';
import { GroupSessionEvidence, groupStatus } from './GroupSessionEvidence';
import { SessionsListView } from './SessionsListView';
import { SessionTimelinePane } from './SessionTimelinePane';
import { sessionReplaySource } from './sessionReplaySource';

const timeline = vi.hoisted(() => vi.fn());
vi.mock('./SessionTimelineView', () => ({ SessionTimelineView: () => { timeline(); return <p>Recorded timeline</p>; } }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let host: HTMLDivElement;
let client: QueryClient;
afterEach(() => { if (root) act(() => root!.unmount()); host?.remove(); client?.clear(); vi.restoreAllMocks(); timeline.mockClear(); });

function view(status: GroupSessionView['status'] = 'unbound'): GroupSessionView {
  return { format: 'manadj-group-session-view/v1', group_id: 'group-technical-id', operation_id: 'operation-technical-id',
    session_uuid: 'session', operation_sha256: 'a'.repeat(64), manifest_sha256: 'b'.repeat(64),
    origin: { device_id: 'original-device-id', label: 'Laptop A', revoked: false },
    relays: [{ device_id: 'phone-device-id', label: 'Phone', revoked: false }],
    started_at: '2026-01-01T00:00:00Z', ended_at: '2026-01-01T00:01:00Z', status,
    projected: status !== 'projection-pending', playable: false, editable: false, conflict_count: status === 'conflicted' ? 1 : 0,
    tracks: [{ logical_track_id: 'logical-track-id', asset_state: 'unbound', expected_asset: null }] };
}
function row(status?: GroupSessionView['status']): SessionRowWire {
  const v = view(status);
  return { uuid: 'session', started_at: v.started_at, ended_at: v.ended_at, take_count: 0, group_history: [v] };
}
async function render(node: ReactNode, session = row()) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(['sessions'], [session]);
  vi.spyOn(api.sessions, 'get').mockResolvedValue({ ...session, events: [] });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => { root!.render(<QueryClientProvider client={client}>{node}</QueryClientProvider>); });
}

it('uses ordinary Sessions rows with origin/relay/status, not UUIDs or raw-ID track summaries', async () => {
  const tracks = vi.spyOn(api.tracks, 'getById');
  const candidates = vi.spyOn(api.routineCandidates, 'forSession');
  await render(<SessionsListView onOpen={() => {}} />);
  const item = host.querySelector('.session-row')!;
  expect(item.textContent).toContain('Laptop A · Via Phone');
  expect(item.textContent).toContain('Tracks need binding');
  expect(item.textContent).not.toContain('original-device-id');
  expect(item.querySelector('.session-delete')).toBeNull();
  expect(tracks).not.toHaveBeenCalled(); expect(candidates).not.toHaveBeenCalled();
});

it.each(Object.keys(groupStatus) as GroupSessionView['status'][])('opens %s as inspect-only and keeps technical evidence expandable', async status => {
  const session = row(status);
  await render(<GroupSessionEvidence session={session} onBack={() => {}} />, session);
  expect(host.textContent).toContain(groupStatus[status]);
  const details = host.querySelector('details')!;
  expect(details.open).toBe(false);
  expect(details.textContent).toContain('operation-technical-id');
  expect(details.textContent).toContain('logical-track-id');
  const labels = Array.from(host.querySelectorAll('button')).map(b => b.textContent);
  expect(labels).not.toContain('Play'); expect(labels).not.toContain('Edit'); expect(labels).not.toContain('Delete');
});

it('normal pane never mounts a recorded timeline for a group UUID', async () => {
  await render(<SessionTimelinePane sessionUuid="session" />);
  expect(host.querySelector('[aria-label="Relayed Session evidence"]')).not.toBeNull();
  expect(timeline).not.toHaveBeenCalled();
});

it('denies group replay before any local-ID loader/cache can run', async () => {
  vi.spyOn(api.sessions, 'get').mockResolvedValue({ ...row('metadata-ready'), events: [] });
  const local = vi.fn().mockResolvedValue(true);
  await expect(sessionReplaySource('session', {} as Record<CaptureDeck, DeckEngine>, local)).rejects.toThrow('not playable');
  expect(local).not.toHaveBeenCalled();
});

it('preserves unrelated local loading but rechecks a newly received UUID claim before fallback', async () => {
  const normal = { uuid: 'local', started_at: '', ended_at: null, take_count: 0, events: [] };
  const get = vi.spyOn(api.sessions, 'get').mockResolvedValue(normal);
  const local = vi.fn().mockResolvedValue(true);
  const source = await sessionReplaySource('local', {} as Record<CaptureDeck, DeckEngine>, local);
  expect(await source.loadTrack('A', 7)).toBe(true);
  get.mockResolvedValue({ ...row('revoked'), uuid: 'local', events: [] });
  expect(await source.loadTrack('A', 7)).toBe(false);
  expect(await source.validateSource()).toBe(false);
  expect(local).toHaveBeenCalledTimes(1);
});
