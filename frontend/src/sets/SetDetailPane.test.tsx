// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api, type SetWithEntriesWire } from '../api/client';
import type { Track } from '../types';
import { _resetTransitionStoreForTests } from '../editor/pairStore';
import { _resetRoutineCastsForTests, setRoutineCast } from './routineCasts';
import { _resetSetStoreForTests, getSetEntries, getSetSelection } from './setStore';
import SetDetailPane from './SetDetailPane';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { decks, mixer, occupancy, hotCues, toast } = vi.hoisted(() => ({
  decks: {},
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
// Keyboard ownership needs real rows and store mutations, not an audio plan.
vi.mock('./useSetPlan', () => ({
  useSetPlan: () => undefined,
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
});

async function selectSetTrack() {
  await act(async () => root.render(
    <QueryClientProvider client={client}>
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
