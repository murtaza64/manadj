// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { GroupReplayControls } from './GroupReplayControls';
import type { GroupSessionView } from '../api/client';

const mocks = vi.hoisted(() => ({ open: vi.fn(), start: vi.fn(),
  state: { status: 'idle', sessionUuid: null },
  decks: Object.fromEntries(['A', 'B', 'C', 'D'].map(d => [d, { engine: {} }])),
  ready: { state: 'candidate-exact', generation: 'generation' } }));
vi.mock('../hooks/useDeck', () => ({ useDecks: () => mocks.decks }));
vi.mock('../hooks/useMixer', () => ({ useMixer: () => ({}) }));
vi.mock('./groupReplaySource', () => ({ groupReplaySource: mocks.open,
  groupReplayApi: { readiness: async () => mocks.ready } }));
vi.mock('./replayPlanner', () => ({ planReplay: () => ({ ok: true, plan: {} }) }));
vi.mock('./replayStore', () => ({ replayState: () => mocks.state, subscribeReplay: () => () => {},
  startReplay: mocks.start, stopReplay: vi.fn(), seekReplay: vi.fn(), toggleReplayPause: vi.fn() }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const clients: QueryClient[] = [];
const roots: ReturnType<typeof createRoot>[] = [];
const hosts: HTMLElement[] = [];
afterEach(() => {
  act(() => roots.splice(0).forEach(root => root.unmount()));
  clients.splice(0).forEach(client => client.clear()); hosts.splice(0).forEach(host => host.remove());
  mocks.open.mockReset(); mocks.start.mockReset();
});
const view = (sid: string) => ({ group_id: 'group', operation_id: sid, session_uuid: sid, tracks: [] }) as unknown as GroupSessionView;
const source = (sid: string) => ({ events: [], identity: { session_uuid: sid }, generation: 'generation',
  loadTrack: vi.fn(), validateSource: async () => true });
async function mount(sid: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client);
  client.setQueryData(['group-replay', 'group', sid], mocks.ready);
  const host = document.createElement('div'); hosts.push(host); document.body.append(host);
  const root = createRoot(host); roots.push(root);
  const render = async (sid: string) => act(async () => root.render(<QueryClientProvider client={client}><GroupReplayControls view={view(sid)} /></QueryClientProvider>));
  await render(sid);
  return { host, render, close: () => { act(() => root.unmount()); roots.splice(roots.indexOf(root), 1); } };
}
const clickPlay = async (host: HTMLElement) => {
  await act(async () => (Array.from(host.querySelectorAll('button')).find(b => b.textContent === 'Replay local audio') as HTMLButtonElement).click());
};

it('an unmounted pending open cannot claim replay after a newer Session starts', async () => {
  let resolveOld!: (value: ReturnType<typeof source>) => void;
  mocks.open.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
  const old = await mount('old'); await clickPlay(old.host); old.close();
  mocks.open.mockResolvedValueOnce(source('new'));
  const next = await mount('new'); await clickPlay(next.host);
  await act(async () => resolveOld(source('old')));
  expect(mocks.start.mock.calls.map(call => call[0])).toEqual(['new']);
});

it('a changed operation invalidates the previous pending open without claiming replay', async () => {
  let resolveOld!: (value: ReturnType<typeof source>) => void;
  mocks.open.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
  const current = await mount('old'); await clickPlay(current.host);
  await current.render('new');
  await act(async () => resolveOld(source('old')));
  expect(mocks.start).not.toHaveBeenCalled();
});
