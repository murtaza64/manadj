// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api, type TakeDetailWire } from '../api/client';
import type { Track } from '../types';
import { DEFAULT_DETECTOR_PARAMS, DETECTOR_VERSION } from '../capture/events';
import { _resetTransitionStoreForTests } from '../editor/pairStore';
import {
  _resetSetStoreForTests,
  getSetDormantPins,
  getSetEntries,
  replaceSetEntries,
  setEntryTrim,
} from '../sets/setStore';
import { requestMixEdit } from './openMix';
import RoutineEditorView from './RoutineEditorView';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { toast, decks, mixer } = vi.hoisted(() => ({
  toast: vi.fn(),
  decks: Object.fromEntries(['A', 'B', 'C', 'D'].map((id) => [
    id, { engine: {}, loadedTrack: null, loadTrack: vi.fn() },
  ])),
  mixer: {},
}));

vi.mock('../hooks/useDeck', () => ({ useDecks: () => decks }));
vi.mock('../hooks/useMixer', () => ({ useMixer: () => mixer }));
vi.mock('../components/Toast', () => ({ useToast: () => toast }));
vi.mock('../editor/auditionTakeover', () => ({
  watchAuditionTakeover: () => () => {},
  watchDeckAuditionTakeover: () => () => {},
}));
// Canvas rendering and picker navigation are outside the promotion path.
vi.mock('./RoutineTimeline', () => ({ RoutineTimeline: () => null }));
vi.mock('./MixPicker', () => ({ MixPicker: () => null }));

const takePin = { kind: 'take', uuid: 'take-1' } as const;
const deckState = {
  playing: true, fader: 1, trim: 0.5,
  eq: { low: 0.5, mid: 0.5, high: 0.5 }, filter: 0, pitch: 0,
};
// Same init/tick geometry as capture/vectorize.test.ts: A at 60s, B at 8s.
const take: TakeDetailWire = {
  uuid: takePin.uuid, a_track_id: 1, b_track_id: 2,
  detected_at: '2026-09-09T00:00:00', confidence: 1, detector_version: DETECTOR_VERSION,
  params: DEFAULT_DETECTOR_PARAMS, origin: 'detected', kind: 'handover',
  session_uuid: null, engagement_uuid: null,
  promoted_transition_uuid: null,
  window_start_s: 100, window_end_s: 120,
  events: [
    {
      t: 100, kind: 'init', outgoingChannel: 'A',
      decks: { A: { ...deckState, trackId: 1 }, B: { ...deckState, trackId: 2 } },
      crossfader: 0, crossfaderEnabled: true,
    },
    { t: 100, kind: 'tick', playheads: { A: 60, B: 8 } },
  ],
};

let host: HTMLDivElement;
let root: Root;
let client: QueryClient;

beforeEach(() => {
  vi.clearAllMocks();
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
    clear: () => storage.clear(),
  });
  _resetSetStoreForTests();
  _resetTransitionStoreForTests();
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected network request'); }));
  vi.spyOn(api.routines, 'list').mockResolvedValue([]);
  vi.spyOn(api.routineTakes, 'list').mockResolvedValue([]);
  vi.spyOn(api.routineCandidates, 'list').mockResolvedValue([]);
  vi.spyOn(api.cameos, 'list').mockResolvedValue([]);
  vi.spyOn(api.takes, 'list').mockResolvedValue([take]);
  vi.spyOn(api.takes, 'get').mockResolvedValue(take);
  vi.spyOn(api.takes, 'setPromoted').mockImplementation(async (_, uuid) => ({
    ...take, promoted_transition_uuid: uuid,
  }));
  const transitions = vi.spyOn(api.transitions, 'list').mockResolvedValue([]);
  vi.spyOn(api.transitions, 'replacePair').mockImplementation(async (a, b, items) => {
    const rows = items.map((item, position) => ({
      ...item, position, a_track_id: a, b_track_id: b, updated_at: null,
    }));
    transitions.mockResolvedValue(rows);
    return rows;
  });
  const tracks = [1, 2].map((id) => ({
    id, title: `Track ${id}`, bpm: 120, duration_secs: 180,
  } as Track));
  vi.spyOn(api.tracks, 'getById').mockImplementation(async (id) => tracks.find((t) => t.id === id)!);
  vi.spyOn(api.tracks, 'list').mockResolvedValue({ items: tracks });
  vi.spyOn(api.hotcues, 'getBulk').mockResolvedValue({});
  vi.spyOn(api.sets, 'replaceEntries').mockResolvedValue({
    id: 1, name: 'Set', color: null, display_order: 0, tempo_policy: 'riding',
    set_tempo_bpm: null, has_archived_tracks: false,
    entries: [], dormant: [], dormant_cameos: [],
  });

  for (const setId of [1, 2]) {
    replaceSetEntries(setId, [
      { trackId: 1, pin: takePin },
      { trackId: 2, pin: { kind: 'take', uuid: 'other-take' } },
      { trackId: 3, pin: null },
    ]);
  }
  replaceSetEntries(3, [{ trackId: 1, pin: null }, { trackId: 3, pin: null }], [
    { aTrackId: 1, bTrackId: 2, pin: takePin },
  ]);
  vi.mocked(api.sets.replaceEntries).mockClear();

  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  for (const id of [1, 2]) {
    // These assets are irrelevant to promotion; no audio or analysis fetches.
    for (const key of ['waveform-blob', 'beatgrid', 'metric-ladder']) {
      client.setQueryData([key, id], null);
    }
  }
});

afterEach(() => {
  act(() => root.unmount());
  client.clear();
  host.remove();
  localStorage.clear();
  _resetSetStoreForTests();
  _resetTransitionStoreForTests();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function openReview(pinFollow: boolean) {
  act(() => root.render(
    <QueryClientProvider client={client}><RoutineEditorView /></QueryClientProvider>,
  ));
  await act(async () => requestMixEdit({
    open: { kind: 'transition', aTrackId: 1, bTrackId: 2, uuid: null, takeUuid: take.uuid },
    setContext: pinFollow ? { setId: 1, headTrackId: 1 } : undefined,
  }));
  await vi.waitFor(async () => {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(host.querySelector<HTMLButtonElement>('.re-promote')?.disabled).toBe(false);
  });
  expect(!!host.querySelector('.re-setctx')).toBe(pinFollow);
  expect(getSetEntries(1)![0].pin).toEqual(takePin);
  expect(api.transitions.replacePair).not.toHaveBeenCalled();
  expect(api.takes.setPromoted).not.toHaveBeenCalled();
  expect(api.sets.replaceEntries).not.toHaveBeenCalled();
}

async function promote() {
  await act(async () => host.querySelector<HTMLButtonElement>('.re-promote')!.click());
  await vi.waitFor(async () => {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(toast).toHaveBeenCalled();
  });
}

it.each([true, false])('promotes loaded and dormant Take pins (pin-follow: %s)', async (pinFollow) => {
  await openReview(pinFollow);
  await promote();

  expect(toast).toHaveBeenCalledWith(expect.stringContaining('the take is now a saved Transition'));
  expect(api.transitions.replacePair).toHaveBeenCalledExactlyOnceWith(1, 2, [
    expect.objectContaining({
      uuid: expect.any(String),
      data: expect.objectContaining({ startSec: 60, bInSec: 8, durationSec: 20 }),
    }),
  ]);
  const uuid = vi.mocked(api.transitions.replacePair).mock.calls[0][2][0].uuid;
  expect(api.takes.setPromoted).toHaveBeenCalledExactlyOnceWith(take.uuid, uuid);
  const transitionPin = { kind: 'transition', uuid };
  for (const setId of [1, 2]) {
    expect.soft(getSetEntries(setId)![0].pin).toEqual(transitionPin);
    expect(getSetEntries(setId)![1].pin).toEqual({ kind: 'take', uuid: 'other-take' });
  }
  expect.soft(getSetDormantPins(3)![0].pin).toEqual(transitionPin);

  // A later wholesale PUT must not overwrite the server's promotion with stale Take pins.
  vi.mocked(api.sets.replaceEntries).mockClear();
  for (const setId of [1, 2, 3]) setEntryTrim(setId, 1, 0.1);
  for (const setId of [1, 2]) {
    expect.soft(api.sets.replaceEntries).toHaveBeenCalledWith(setId, expect.arrayContaining([
      expect.objectContaining({ track_id: 1, pin_kind: 'transition', pin_uuid: uuid, trim: 0.1 }),
    ]), [], []);
  }
  expect.soft(api.sets.replaceEntries).toHaveBeenCalledWith(3, expect.any(Array), [
    { a_track_id: 1, b_track_id: 2, pin_kind: 'transition', pin_uuid: uuid },
  ], []);
});

it.each(['replacePair', 'setPromoted'] as const)('keeps Take pins when %s fails', async (step) => {
  if (step === 'replacePair') {
    vi.mocked(api.transitions.replacePair).mockRejectedValueOnce(new Error('offline'));
  } else {
    vi.mocked(api.takes.setPromoted).mockRejectedValueOnce(new Error('offline'));
  }
  await openReview(true);
  await promote();

  expect(toast).toHaveBeenCalledWith('Promote failed: offline');
  for (const setId of [1, 2]) expect(getSetEntries(setId)![0].pin).toEqual(takePin);
  expect(getSetDormantPins(3)![0].pin).toEqual(takePin);
  expect(api.sets.replaceEntries).not.toHaveBeenCalled();
  expect(host.querySelector<HTMLButtonElement>('.re-promote')?.disabled).toBe(false);
  if (step === 'replacePair') expect(api.takes.setPromoted).not.toHaveBeenCalled();
});
