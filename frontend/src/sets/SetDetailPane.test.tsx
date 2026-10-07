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
import { selectSet, setAdjacencyPin } from './setStore';
import type { MenuItem } from '../components/ContextMenu';
import { BrowseActiveContext } from '../contexts/browseActive';
import { ViewActiveContext } from '../contexts/viewActive';
import { browseSurface } from '../midi/controlRegistry';

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
vi.mock('../components/useTrackMenuItems', () => ({
  useTrackMenuItems: ({ surfaceItems }: { surfaceItems?: MenuItem[] }) => surfaceItems ?? [],
}));
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

function dragEvent(target: EventTarget, type: string, dataTransfer: DataTransfer, clientY = 0, clientX = 400) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY, clientX });
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

it('scrolls smoothly at a stationary drag edge, updates the target, and stops on cancel', async () => {
  const { pane, source, dataTransfer } = await startDrag();
  let now = 1000;
  let id = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => {
    frames.set(++id, fn);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  let scrollTop = 0;
  Object.defineProperties(pane, {
    clientHeight: { value: 80 }, scrollHeight: { value: 120 },
    scrollTop: { get: () => scrollTop, set: (value: number) => { scrollTop = Math.max(0, Math.min(40, value)); } },
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const index = [...host.querySelectorAll('[data-set-track-row]')].indexOf(this);
    const top = index < 0 ? 100 : 100 + index * 40 - scrollTop;
    return { left: 100, right: 700, top, bottom: top + (index < 0 ? 80 : 40), height: index < 0 ? 80 : 40 } as DOMRect;
  });
  const frame = () => act(() => {
    now += 16;
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((fn) => fn(now));
  });
  dragEvent(pane, 'dragover', dataTransfer, 179);
  const positions: number[] = [];
  for (let i = 0; i < 70; i++) { frame(); positions.push(scrollTop); }
  expect(scrollTop).toBeGreaterThan(20);
  expect(positions.filter((pos, i) => i > 0 && pos > positions[i - 1]).length).toBeGreaterThan(5);
  expect([...host.querySelectorAll('[data-set-track-row]')].map((row) => row.getAttribute('data-set-track-row')))
    .toEqual(['2', '3', '1']);
  expect(api.sets.replaceEntries).not.toHaveBeenCalled();
  expect(frames.size).toBe(1); // the stationary internal drag survives beyond 700 ms
  dragEvent(source, 'dragend', dataTransfer);
  const stoppedAt = scrollTop;
  frame();
  expect(scrollTop).toBe(stoppedAt);
  expect(frames.size).toBe(0);
});

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

function armMove(trackId: number, label = 'Move track') {
  const row = host.querySelector<HTMLElement>(`[data-set-track-row="${trackId}"]`)!;
  act(() => row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
  const item = [...host.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    .find((item) => item.textContent === label);
  expect(item).toBeDefined();
  act(() => item!.click());
}

it('arms a move without changing the Set, then inserts at a clicked transition row', async () => {
  await selectSetTrack();
  armMove(1);
  expect(host.textContent).toContain('Choose a transition row');
  expect(getSetEntries(1)!.map((entry) => entry.trackId)).toEqual([1, 2, 3]);
  expect(api.sets.replaceEntries).not.toHaveBeenCalled();
  // Routine interiors are selectable destinations too, despite normally collapsing.
  const target = host.querySelector<HTMLButtonElement>('[data-set-move-index="2"]')!;
  expect(target).not.toBeNull();
  act(() => target.click());
  expect(getSetEntries(1)!.map((entry) => entry.trackId)).toEqual([2, 1, 3]);
  expect(api.sets.replaceEntries).toHaveBeenCalledTimes(1);
  expect(host.querySelector('[data-set-move-index]')).toBeNull();
});

it('moves a non-contiguous selection in Set order, rather than selection order', async () => {
  await selectSetTrack();
  act(() => host.querySelector<HTMLElement>('[data-set-track-row="3"]')!.click());
  act(() => host.querySelector('[data-set-track-row="1"]')!.dispatchEvent(
    new MouseEvent('click', { bubbles: true, metaKey: true }),
  ));
  armMove(3, 'Move 2 tracks');
  act(() => host.querySelector<HTMLButtonElement>('[data-set-move-index="2"]')!.click());
  expect(getSetEntries(1)!.map((entry) => entry.trackId)).toEqual([2, 1, 3]);
  expect(api.sets.replaceEntries).toHaveBeenCalledTimes(1);
});

it.each(['Escape', 'button'])('cancels move mode with %s without clearing selection or saving', async (via) => {
  await selectSetTrack();
  armMove(2);
  if (via === 'Escape') {
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  } else {
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Cancel move"]')!.click());
  }
  expect(host.querySelector('[data-set-move-index]')).toBeNull();
  expect(getSetSelection(1).ids).toEqual([2]);
  expect(api.sets.replaceEntries).not.toHaveBeenCalled();
});

it.each([0, 3])('offers the Set boundary destination %s', async (index) => {
  await selectSetTrack();
  armMove(2);
  act(() => host.querySelector<HTMLButtonElement>(`[data-set-move-index="${index}"]`)!.click());
  expect(getSetEntries(1)!.map((entry) => entry.trackId)).toEqual(index === 0 ? [2, 1, 3] : [1, 3, 2]);
});

it('keeps native Tab/Enter behavior out of the global browse shortcut handler', async () => {
  const row = await selectSetTrack();
  armMove(2);
  const hub = vi.fn();
  document.addEventListener('keydown', hub);
  try {
    for (const key of ['Tab', 'Enter', 'ArrowDown', 'Backspace', ' ']) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      act(() => row.closest('[tabindex="-1"]')!.dispatchEvent(event));
      expect(event.defaultPrevented).toBe(false);
    }
    expect(hub).not.toHaveBeenCalled();
    expect(api.sets.replaceEntries).not.toHaveBeenCalled();
  } finally {
    document.removeEventListener('keydown', hub);
  }
});

it('disables Set-wide pin actions while choosing a move destination', async () => {
  await selectSetTrack();
  act(() => {
    setAdjacencyPin(1, 1, null);
    reconcilePairFromServer('2:3', [{ uuid: 't', name: 'T', favorite: false, position: 0, data: {} }]);
  });
  const pinButtons = [...host.querySelectorAll<HTMLButtonElement>('button')]
    .filter((button) => /^(Auto-fill|Resolve from evidence)/.test(button.textContent ?? ''));
  expect(pinButtons.every((button) => !button.disabled)).toBe(true);
  vi.mocked(api.sets.replaceEntries).mockClear();
  armMove(2);
  expect(pinButtons.every((button) => button.disabled)).toBe(true);
  act(() => pinButtons.forEach((button) => button.click()));
  expect(api.sets.replaceEntries).not.toHaveBeenCalled();
});

async function renderSetPane(viewActive = true, browseActive = true) {
  await act(async () => root.render(
    <QueryClientProvider client={client}>
      <SetSpaceTransport />
      <ViewActiveContext value={viewActive}><BrowseActiveContext value={browseActive}>
        <SetDetailPane setId={1} onLoadToDeck={() => {}} />
      </BrowseActiveContext></ViewActiveContext>
      <div data-editor tabIndex={0}>Routine editor timeline</div>
    </QueryClientProvider>,
  ));
}

async function selectSetTrack() {
  selectSet(1);
  await renderSetPane();
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

it.each(['browse', 'view'])('unregisters hidden Set MIDI browsing and ignores deletion without losing selection (%s)', async (boundary) => {
  const row = await selectSetTrack();
  expect(browseSurface()?.getSelectedTrack()?.id).toBe(2);
  const selection = getSetSelection(1);
  await renderSetPane(boundary !== 'view', boundary !== 'browse');
  expect(browseSurface()).toBeNull();
  const event = new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true });
  act(() => { row.querySelector('[title="Remove from set"]')!.dispatchEvent(event); });
  expect(event.defaultPrevented).toBe(false);
  expect(getSetSelection(1)).toBe(selection);
  expect(api.sets.replaceEntries).not.toHaveBeenCalled();
  await renderSetPane();
  expect(host.querySelector('[data-set-track-row="2"]')).toBe(row);
  expect(browseSurface()?.getSelectedTrack()?.id).toBe(2);
  expect(getSetSelection(1)).toBe(selection);
});

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
