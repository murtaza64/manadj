// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api, type SetWithEntriesWire } from '../api/client';
import type { Track } from '../types';
import { _resetTransitionStoreForTests, reconcilePairFromServer } from '../editor/pairStore';
import { _resetRoutineCastsForTests, setRoutineCast } from './routineCasts';
import { _resetSetStoreForTests, getSetEntries, getSetSelection } from './setStore';
import SetDetailPane from './SetDetailPane';
import { useSetPlan } from './useSetPlan';
import { planSet } from './planner';
import { SetSpaceTransport } from './SetSpaceTransport';
import { selectSet } from './setStore';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { decks, mixer, occupancy, hotCues, toast } = vi.hoisted(() => ({
  decks: { A: { engine: {} }, B: { engine: {} } },
  mixer: {},
  occupancy: Object.fromEntries(['A', 'B', 'C', 'D'].map((id) => [
    id, { trackId: null, playing: false },
  ])),
  hotCues: { byTrack: new Map() },
  toast: vi.fn(),
}));

vi.mock('../hooks/useDeck', () => ({ useDecks: () => decks }));
vi.mock('../hooks/useMixer', () => ({ useMixer: () => mixer }));
vi.mock('../hooks/useDeckOccupancy', () => ({ useDeckOccupancy: () => occupancy }));
vi.mock('../components/Toast', () => ({ useToast: () => toast }));
vi.mock('../components/useTrackMenuItems', () => ({ useTrackMenuItems: () => [] }));
vi.mock('./pickup', async (importOriginal) => ({
  ...await importOriginal<typeof import('./pickup')>(),
  readPickupSnapshot: () => ({}),
  evaluatePickup: () => ({ lit: false, message: 'No decks loaded' }),
}));
vi.mock('./OverviewLadder', () => ({
  OverviewLadder: ({ plan, previewFutures }: {
    plan: { entries: { trackId: number }[] }; previewFutures?: (string | null)[];
  }) => <div data-ladder-order={plan.entries.map((entry) => entry.trackId).join()}
    data-futures={JSON.stringify(previewFutures)} />,
}));
// Keyboard ownership needs real rows and store mutations, not an audio plan.
vi.mock('./useSetPlan', () => ({
  useSetPlan: vi.fn(() => undefined),
  useSetHotCues: () => hotCues,
}));

const routinePin = { kind: 'routine', uuid: 'routine-1' } as const;
const set: SetWithEntriesWire = {
  id: 1, name: 'Set', color: null, display_order: 0, tempo_policy: 'riding',
  set_tempo_bpm: null, has_archived_tracks: false,
  entries: [1, 2, 3].map((id, position) => ({
    track_id: id, position, trim: 0, cameo_pins: [],
    pin_kind: id === 1 ? routinePin.kind : null,
    pin_uuid: id === 1 ? routinePin.uuid : null,
  })),
  dormant: [], dormant_cameos: [],
};

let host: HTMLDivElement;
let root: Root;
let client: QueryClient;

beforeEach(() => {
  vi.mocked(useSetPlan).mockReset().mockReturnValue(undefined);
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
  });
  _resetSetStoreForTests();
  _resetTransitionStoreForTests();
  _resetRoutineCastsForTests();
  setRoutineCast(routinePin.uuid, [1, 2, 3]);
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected network request'); }));
  vi.spyOn(api.sets, 'list').mockResolvedValue([set]);
  vi.spyOn(api.sets, 'get').mockResolvedValue(set);
  vi.spyOn(api.sets, 'replaceEntries').mockResolvedValue(set);
  vi.spyOn(api.transitions, 'list').mockResolvedValue([]);
  vi.spyOn(api.takes, 'list').mockResolvedValue([]);
  vi.spyOn(api.cameos, 'list').mockResolvedValue([]);
  vi.spyOn(api.routines, 'list').mockResolvedValue([{
    uuid: routinePin.uuid, name: 'Routine', cast: [1, 2, 3],
    entry_offsets_beats: [0, 16, 32], entry_positions: [0, 0, 0],
    duration_beats: 48, origin_take_uuid: null, created_at: null,
  }]);
  vi.spyOn(api.routineTakes, 'list').mockResolvedValue([]);
  vi.spyOn(api.routineCandidates, 'list').mockResolvedValue([]);
  vi.spyOn(api.tracks, 'getById').mockImplementation(async (id) => ({
    id, title: `Track ${id}`, bpm: 120, duration_secs: 180,
  } as Track));
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  act(() => root.unmount());
  client.clear();
  host.remove();
  _resetSetStoreForTests();
  _resetTransitionStoreForTests();
  _resetRoutineCastsForTests();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function dragEvent(target: Element, type: string, dataTransfer: DataTransfer, clientY = 0) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY });
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  act(() => { target.dispatchEvent(event); });
}

async function startDrag() {
  await selectSetTrack();
  vi.useFakeTimers();
  const source = host.querySelector<HTMLElement>('[data-set-track-row="1"]')!;
  const pane = source.closest('[tabindex="-1"]')!;
  const values = new Map<string, string>();
  const dataTransfer = {
    setData: (key: string, value: string) => values.set(key, value),
    getData: (key: string) => values.get(key) ?? '',
    get types() { return [...values.keys()]; },
  } as unknown as DataTransfer;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const rows = [...host.querySelectorAll('[data-set-track-row]')];
    const index = rows.indexOf(this);
    return { top: Math.max(0, index) * 40, height: 40, bottom: (index + 1) * 40 } as DOMRect;
  });
  dragEvent(source, 'dragstart', dataTransfer);
  vi.mocked(useSetPlan).mockClear();
  return { source, pane, dataTransfer };
}

it('moves rows immediately but only plans a settled drag target', async () => {
  const { pane, dataTransfer } = await startDrag();
  const previewInputs = () => vi.mocked(useSetPlan).mock.calls
    .map(([entries]) => entries?.map((entry) => entry.trackId))
    .filter((ids) => ids && ids.join() !== '1,2,3');
  for (let i = 0; i < 10; i++) {
    dragEvent(pane, 'dragover', dataTransfer, i % 2 === 0 ? 119 : 0);
    act(() => vi.advanceTimersByTime(40));
  }
  dragEvent(pane, 'dragover', dataTransfer, 119);
  expect([...host.querySelectorAll('[data-set-track-row]')].map((row) => row.getAttribute('data-set-track-row')))
    .toEqual(['2', '3', '1']);
  expect(previewInputs()).toEqual([]);
  act(() => vi.advanceTimersByTime(200));
  expect(previewInputs()).toContainEqual([2, 3, 1]);
  expect(api.sets.replaceEntries).not.toHaveBeenCalled();
});

it('commits the latest row order even before its preview plan settles', async () => {
  const { pane, dataTransfer } = await startDrag();
  vi.mocked(api.tracks.getById).mockClear();
  dragEvent(pane, 'dragover', dataTransfer, 119);
  dragEvent(pane, 'drop', dataTransfer);
  expect(getSetEntries(1)!.map((entry) => entry.trackId)).toEqual([2, 3, 1]);
  expect(api.sets.replaceEntries).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(200); });
  expect(api.tracks.getById).not.toHaveBeenCalled();
});

it('holds the completed ladder preview while the next target loads, without showing stale row times', async () => {
  const { pane, dataTransfer } = await startDrag();
  const makePlan = (ids: number[]) => planSet({
    entries: ids.map((trackId) => ({ trackId, pin: null })),
    tracks: Object.fromEntries(ids.map((id) => [id, { durationSec: 180, bpm: 120, hotCue1Sec: null }])),
    transitionsByUuid: {}, takesByUuid: {},
  });
  const committed = makePlan([1, 2, 3]);
  const first = makePlan([2, 3, 1]);
  const second = makePlan([2, 1, 3]);
  let loading = true;
  vi.mocked(useSetPlan).mockImplementation((entries) => {
    const order = entries?.map((entry) => entry.trackId).join();
    return order === '1,2,3' ? committed : order === '2,3,1' ? first
      : order === '2,1,3' && !loading ? second : undefined;
  });
  const ladderOrder = () => host.querySelector('[data-ladder-order]')?.getAttribute('data-ladder-order');
  const time = () => host.querySelector('[data-set-track-row="1"] [title="When this track enters the mix (mix clock)"]')?.textContent;
  dragEvent(pane, 'dragover', dataTransfer, 119);
  act(() => vi.advanceTimersByTime(200));
  expect(ladderOrder()).toBe('2,3,1');
  expect(time()).toBe('6:00');
  dragEvent(pane, 'dragover', dataTransfer, 40);
  expect(time()).toBe('');
  act(() => vi.advanceTimersByTime(200));
  expect(ladderOrder()).toBe('2,3,1');
  loading = false;
  act(() => host.querySelector<HTMLElement>('[data-set-track-row="2"]')!.click());
  expect(ladderOrder()).toBe('2,1,3');
  expect(time()).toBe('3:00');
  // Evidence can settle after the plan did; marker-only updates must also land.
  act(() => reconcilePairFromServer('2:1', [{
    uuid: 'new-transition', name: 'New', favorite: false, position: 0, data: {},
  }]));
  act(() => vi.advanceTimersByTime(200));
  expect(host.querySelector('[data-futures]')?.getAttribute('data-futures')).toContain('auto-resolves');
});

it.each(['dragend', 'dragleave'])('cancels a pending preview on %s', async (type) => {
  const { source, pane, dataTransfer } = await startDrag();
  dragEvent(pane, 'dragover', dataTransfer, 119);
  dragEvent(type === 'dragend' ? source : pane, type, dataTransfer);
  vi.mocked(useSetPlan).mockClear();
  act(() => vi.advanceTimersByTime(200));
  expect(vi.mocked(useSetPlan).mock.calls.some(([entries]) => entries?.[0].trackId === 2)).toBe(false);
  expect(getSetEntries(1)!.map((entry) => entry.trackId)).toEqual([1, 2, 3]);
  expect(api.sets.replaceEntries).not.toHaveBeenCalled();
});

async function selectSetTrack() {
  selectSet(1);
  await act(async () => root.render(
    <QueryClientProvider client={client}>
      <SetSpaceTransport />
      <SetDetailPane setId={1} onLoadToDeck={() => {}} />
      <div data-editor tabIndex={0}>Routine editor timeline</div>
    </QueryClientProvider>,
  ));
  await vi.waitFor(async () => {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(host.querySelector('[data-set-track-row="2"]')?.textContent).toContain('Track 2');
  });
  const row = host.querySelector<HTMLElement>('[data-set-track-row="2"]')!;
  act(() => row.click());
  expect(getSetSelection(1).ids).toEqual([2]);
  expect(getSetEntries(1)!.map((entry) => entry.trackId)).toEqual([1, 2, 3]);
  expect(getSetEntries(1)![0].pin).toEqual(routinePin);
  expect(api.sets.replaceEntries).not.toHaveBeenCalled();
  return row;
}

it.each(['Backspace', 'Delete'])('ignores %s from an external Routine editor', async (key) => {
  await selectSetTrack();
  const editor = host.querySelector<HTMLElement>('[data-editor]')!;
  editor.focus();
  expect(document.activeElement).toBe(editor);
  await act(async () => {
    editor.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });

  expect.soft(getSetEntries(1)!.map((entry) => entry.trackId)).toEqual([1, 2, 3]);
  expect.soft(getSetEntries(1)![0].pin).toEqual(routinePin);
  expect.soft(api.sets.replaceEntries).not.toHaveBeenCalled();
});

it.each(['Backspace', 'Delete'])('ignores already-handled %s inside the Set pane', async (key) => {
  const row = await selectSetTrack();
  const target = row.querySelector<HTMLButtonElement>('[title="Remove from set"]')!;
  target.focus();
  expect(document.activeElement).toBe(target);
  target.addEventListener('keydown', (event) => event.preventDefault(), { once: true });
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  await act(async () => { target.dispatchEvent(event); });

  expect(event.defaultPrevented).toBe(true);
  expect.soft(getSetEntries(1)!.map((entry) => entry.trackId)).toEqual([1, 2, 3]);
  expect.soft(getSetEntries(1)![0].pin).toEqual(routinePin);
  expect.soft(api.sets.replaceEntries).not.toHaveBeenCalled();
});

it.each(['Backspace', 'Delete'])('removes the selected track with focused Set-pane %s', async (key) => {
  const row = await selectSetTrack();
  const target = row.querySelector<HTMLButtonElement>('[title="Remove from set"]')!;
  target.focus();
  expect(document.activeElement).toBe(target);
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });

  expect(getSetEntries(1)!.map((entry) => entry.trackId)).toEqual([1, 3]);
  expect(getSetSelection(1).ids).toEqual([]);
  expect(api.sets.replaceEntries).toHaveBeenCalledTimes(1);
});
