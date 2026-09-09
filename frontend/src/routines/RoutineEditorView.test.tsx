// @vitest-environment jsdom
import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { notifyManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api, type RoutineDetailWire, type TakeDetailWire } from '../api/client';
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
import type { RoutineTimeline } from './RoutineTimeline';
import { emptyEdits } from './routineDraft';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { toast, decks, mixer, timeline } = vi.hoisted(() => ({
  toast: vi.fn(),
  timeline: vi.fn(),
  decks: Object.fromEntries(['A', 'B', 'C', 'D'].map((id) => [
    id, { engine: {}, loadedTrack: null, loadTrack: vi.fn() },
  ])),
  mixer: { now: () => performance.now() / 1000 },
}));

vi.mock('../hooks/useDeck', () => ({ useDecks: () => decks }));
vi.mock('../hooks/useMixer', () => ({ useMixer: () => mixer }));
vi.mock('../components/Toast', () => ({ useToast: () => toast }));
vi.mock('../editor/auditionTakeover', () => ({
  watchAuditionTakeover: () => () => {},
  watchDeckAuditionTakeover: () => () => {},
}));
// Canvas rendering and picker navigation are outside the promotion path.
vi.mock('./RoutineTimeline', () => ({ RoutineTimeline: (props: unknown) => {
  timeline(props);
  return null;
} }));
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
  notifyManager.setNotifyFunction((notify) => act(notify));
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
  const tracks = [1, 2, 3].map((id) => ({
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
  for (const id of [1, 2, 3]) {
    // These assets are irrelevant to promotion; no audio or analysis fetches.
    for (const key of ['waveform-blob', 'beatgrid', 'metric-ladder']) {
      client.setQueryData([key, id], null);
    }
  }
});

afterEach(() => {
  act(() => root.unmount());
  client.clear();
  notifyManager.setNotifyFunction((notify) => notify());
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
  expect(timelineProps().trim).toBeNull();
  expect(timelineProps().onTrimChange).toBeNull();
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

function timelineProps(): ComponentProps<typeof RoutineTimeline> {
  return timeline.mock.lastCall![0];
}

async function openRoutine(originTakeUuid: string | null = null) {
  const edits = {
    ...emptyEdits(),
    lanes: { '0:fader': [{ beat: 0, value: 0.8 }, { beat: 64, value: 1 }] },
    jumps: [{ id: 'jump-1', slotId: '0', beat: 4, deltaSec: -1 }],
  };
  const detail: RoutineDetailWire = {
    uuid: 'routine-1', name: 'Routine', cast: [1, 2, 3],
    entry_offsets_beats: [0, 16, 32], entry_positions: [60, 0, 10],
    duration_beats: 64, origin_take_uuid: originTakeUuid, created_at: null,
    events: [
      { kind: 'tick', beat: 0, playheads: { '0': 60 } },
      { kind: 'tick', beat: 64, playheads: { '0': 92, '1': 24, '2': 26 } },
    ],
    edits,
  };
  vi.spyOn(api.routines, 'get').mockResolvedValue(detail);
  vi.spyOn(api.routines, 'saveEdits').mockImplementation(async (_, saved) => ({
    ...detail, edits: saved,
  }));
  vi.spyOn(api.routines, 'retrim').mockRejectedValue(new Error('Must not retrim'));
  localStorage.setItem('manadj-last-routine', detail.uuid);
  act(() => root.render(
    <QueryClientProvider client={client}><RoutineEditorView /></QueryClientProvider>,
  ));
  await vi.waitFor(async () => {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(timelineProps().trim).toEqual({ startBeat: 0, endBeat: 64 });
  });
  return detail;
}

async function waitForBoundsSave(bounds: { startBeat: number; endBeat: number } | undefined) {
  await vi.waitFor(async () => {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(vi.mocked(api.routines.saveEdits).mock.lastCall?.[1]?.playbackBounds).toEqual(bounds);
    expect(api.routines.saveEdits).toHaveBeenCalled();
  }, { timeout: 2000 });
}

it.each(['origin-take', null])('autosaves playback bounds without retrim (origin: %s)', async (origin) => {
  const detail = await openRoutine(origin);
  expect(timelineProps().onTrimChange).toBeTypeOf('function');
  expect(host.textContent).not.toContain('trim unavailable');
  expect(host.querySelector('.re-trimapply')).toBeNull();

  act(() => timelineProps().onTrimChange!({ startBeat: 8, endBeat: 64 }));
  act(() => timelineProps().onTrimChange!({ startBeat: 12, endBeat: 64 }));
  act(() => timelineProps().draftStore.endGesture());
  await waitForBoundsSave({ startBeat: 12, endBeat: 64 });
  expect(api.routines.saveEdits).toHaveBeenLastCalledWith(detail.uuid, {
    ...detail.edits, playbackBounds: { startBeat: 12, endBeat: 64 },
  });
  expect(timelineProps().trim).toEqual({ startBeat: 12, endBeat: 64 });
  expect(timelineProps().editor.input.durationBeats).toBe(64);
  expect(timelineProps().editor.planned.mixStartSec).toBe(6);
  expect(timelineProps().editor.planned.beatOriginMixSec).toBe(0);
  expect(client.getQueryData(['routine', detail.uuid])).toEqual({
    ...detail, edits: { ...detail.edits, playbackBounds: { startBeat: 12, endBeat: 64 } },
  });

  // Autosave responses must not reset the drag's single undo entry.
  act(() => host.querySelector<HTMLButtonElement>('.re-histbtn')!.click());
  expect(timelineProps().trim).toEqual({ startBeat: 0, endBeat: 64 });
  expect(timelineProps().edits).toEqual(detail.edits);
  expect(host.querySelector<HTMLButtonElement>('.re-histbtn')!.disabled).toBe(true);
  await waitForBoundsSave(undefined);
  expect(api.routines.retrim).not.toHaveBeenCalled();
});

it('clamps slot exclusion and the eight-beat minimum without moving the other handle', async () => {
  const detail = await openRoutine();
  const { maxStartBeat, minEndBeat } = timelineProps().editor.planned.boundsLimits;
  act(() => timelineProps().onTrimChange!({ startBeat: 100, endBeat: 64 }));
  expect(timelineProps().trim).toEqual({ startBeat: Math.min(maxStartBeat, 56), endBeat: 64 });
  expect(host.querySelector('[role="status"]')?.textContent).toBe('Delete this slot to trim further');
  const startBeat = timelineProps().trim!.startBeat;
  act(() => timelineProps().onTrimChange!({ startBeat, endBeat: startBeat + 2 }));
  expect(timelineProps().trim).toEqual({ startBeat, endBeat: Math.max(minEndBeat, startBeat + 8) });
  act(() => timelineProps().draftStore.endGesture());
  act(() => timelineProps().draftStore.undo());

  act(() => timelineProps().onTrimChange!({ startBeat: 0, endBeat: -100 }));
  expect(timelineProps().trim).toEqual({ startBeat: 0, endBeat: Math.max(minEndBeat, 8) });
  expect(host.querySelector('[role="status"]')?.textContent).toBe('Delete this slot to trim further');
  expect(timelineProps().edits.lanes).toEqual(detail.edits!.lanes);
  expect(timelineProps().edits.jumps).toEqual(detail.edits!.jumps);
  act(() => timelineProps().draftStore.endGesture());

  act(() => host.querySelector<HTMLButtonElement>('.re-trimreset')!.click());
  expect(timelineProps().trim).toEqual({ startBeat: 0, endBeat: 64 });
  expect(timelineProps().edits).toEqual(detail.edits);
  expect(host.querySelector('[role="status"]')).toBeNull();
  expect(api.routines.retrim).not.toHaveBeenCalled();
});
