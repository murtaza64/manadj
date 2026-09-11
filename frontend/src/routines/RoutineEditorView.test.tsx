// @vitest-environment jsdom
import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { notifyManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api, type RoutineDetailWire, type TakeDetailWire } from '../api/client';
import type { BeatgridResponse, HotCue, Track } from '../types';
import { DEFAULT_DETECTOR_PARAMS, DETECTOR_VERSION } from '../capture/events';
import { _resetTransitionStoreForTests } from '../editor/pairStore';
import * as pairSlotTranslation from '../editor/pairSlotTranslation';
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
import type { MixPicker } from './MixPicker';
import { routineSlotStateAt, slotLanesAt } from '../sets/routinePlan';
import { emptyEdits, type RoutineEdits } from './routineDraft';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { toast, decks, mixer, timeline, picker } = vi.hoisted(() => ({
  toast: vi.fn(),
  timeline: vi.fn(),
  picker: vi.fn(),
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
vi.mock('./MixPicker', () => ({ MixPicker: (props: unknown) => {
  picker(props);
  return null;
} }));

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
  vi.spyOn(pairSlotTranslation, 'seedNewTransition');
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
  vi.useRealTimers();
});

it.each(['0', '1'])('keeps slot %s dragged material in place after pair autosave, undo and reopen', async (slotId) => {
  const original = {
    startSec: 60, durationSec: 20, bInSec: 8, tempoMatch: true,
    lanes: { faderA: [{ x: 0.1, y: 1 }, { x: 0.8, y: 0 }] },
    jumpsA: [{ x: 0.5, deltaSec: -1 }],
  };
  vi.mocked(api.transitions.list).mockResolvedValue([{
    uuid: 'pair-drag', name: 'Pair', favorite: false, position: 0,
    a_track_id: 1, b_track_id: 2, updated_at: null,
    data: original,
  }]);
  act(() => root.render(
    <QueryClientProvider client={client}><RoutineEditorView /></QueryClientProvider>,
  ));
  await act(async () => requestMixEdit({
    open: { kind: 'transition', aTrackId: 1, bTrackId: 2, uuid: 'pair-drag' },
  }));
  const props = () => timeline.mock.lastCall![0] as ComponentProps<typeof RoutineTimeline>;
  await vi.waitFor(async () => {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(timeline).toHaveBeenCalled();
  });
  const slot = Number(slotId);
  const entry = slot === 0 ? 60 : 8;
  const anchor = slot === 0 ? 'startSec' : 'bInSec';
  expect(props().editor.planned.slots[slot].trace[0].pos).toBe(entry);
  expect(pairSlotTranslation.seedNewTransition).not.toHaveBeenCalled();
  vi.useFakeTimers();
  // RoutineTimeline's default pair drag: four beats right, material two seconds earlier.
  act(() => {
    const edits = props().edits;
    props().draftStore.slideWithEditsLive('drag', slotId, {
      nudgeSec: 0,
      lanes: Object.fromEntries(Object.entries(edits.lanes).filter(([k]) => k.startsWith(`${slotId}:`))),
      jumps: edits.jumps.filter((j) => j.slotId === slotId), pauses: [],
      removedRecordedJumps: [], removedRecordedPauses: [],
    }, 4, -2);
    props().draftStore.endGesture();
  });
  expect(props().editor.planned.slots[slot].trace[0].pos).toBe(entry - 2);
  const dragged = props().editor.planned;
  await act(async () => { await vi.advanceTimersByTimeAsync(699); });
  expect(api.transitions.replacePair).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(101); });
  expect(api.transitions.replacePair).toHaveBeenCalledExactlyOnceWith(1, 2, [
    expect.objectContaining({ data: expect.objectContaining({ [anchor]: entry - 2 }) }),
  ]);
  expect(api.transitions.list).toHaveBeenCalledTimes(2);
  expect(props().edits.nudges).toEqual({ [slotId]: -2 });
  expect(props().draftStore.getSnapshot().canUndo).toBe(true);
  expect(props().editor.planned).toEqual(dragged);

  // An unrelated later edit must not bake the same nudge into the anchor again.
  act(() => props().draftStore.setLane('1', 'eqLow', [{ beat: 0, value: 0.25 }]));
  await act(async () => { await vi.advanceTimersByTimeAsync(800); });
  expect(vi.mocked(api.transitions.replacePair).mock.lastCall![2][0].data[anchor]).toBe(entry - 2);
  expect(props().editor.planned.slots[slot].trace).toEqual(dragged.slots[slot].trace);
  act(() => {
    props().draftStore.undo(); // lane
    props().draftStore.undo(); // drag
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(800); });
  expect(vi.mocked(api.transitions.replacePair).mock.lastCall![2][0].data).toEqual(original);
  expect(props().editor.planned.slots[slot].trace[0].pos).toBe(entry);

  act(() => props().draftStore.redo());
  await act(async () => { await vi.advanceTimersByTimeAsync(800); });
  expect(props().editor.planned).toEqual(dragged);
  // A fresh editor loads the saved anchor with no residual nudge. Slot 0
  // remains at the window entry; its nudge changed startSec, not an offset.
  act(() => root.unmount());
  root = createRoot(host);
  await act(async () => root.render(
    <QueryClientProvider client={client}><RoutineEditorView /></QueryClientProvider>,
  ));
  await act(async () => { await vi.advanceTimersByTimeAsync(20); });
  expect(props().edits.nudges).toEqual({});
  expect(props().editor.planned).toEqual(dragged);
  expect(props().editor.planned.slots[0].entryMixSec).toBe(0);
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

it('auditions a pre-window outgoing jump only at its actual instant', async () => {
  await openReview(false);
  const props = () => timeline.mock.lastCall![0] as ComponentProps<typeof RoutineTimeline>;
  act(() => props().draftStore.addJump({ id: 'pre-enter', slotId: '0', beat: -20, deltaSec: -4 }));
  const r = props().editor.planned;
  expect(r.slots[0].jumpMixSecs).toContain(-10);
  expect(r.jumpMixSecs).toContain(-10);
  for (const [globalTime, expected] of [[40, 40], [49.9, 49.9], [50, 46], [61, 57]]) {
    const state = routineSlotStateAt(r, r.slots[0], globalTime - 60);
    expect(state.trackTime).toBeCloseTo(expected);
    expect(state.playing).toBe(true);
  }
});

it('keeps hidden incoming defaults and stash through earlier outgoing edits, autosave and reopen', async () => {
  vi.mocked(api.transitions.list).mockResolvedValue([{
    uuid: 'hidden-b', name: 'Hidden B', favorite: false, position: 0,
    a_track_id: 1, b_track_id: 2, updated_at: null,
    data: { startSec: 60, durationSec: 20, bInSec: 8, tempoMatch: false,
      hiddenLanes: ['faderB'], lanes: { faderB: [{ x: 0.25, y: 0.8 }, { x: 0.75, y: 0.3 }] } },
  }]);
  act(() => root.render(<QueryClientProvider client={client}><RoutineEditorView /></QueryClientProvider>));
  await act(async () => requestMixEdit({ open: { kind: 'transition', aTrackId: 1, bTrackId: 2, uuid: 'hidden-b' } }));
  const props = () => timeline.mock.lastCall![0] as ComponentProps<typeof RoutineTimeline>;
  await vi.waitFor(async () => {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(timeline).toHaveBeenCalled();
  });
  vi.useFakeTimers();
  act(() => props().draftStore.setLane('0', 'fader', [{ beat: -20, value: 1 }, { beat: 40, value: 0 }]));
  expect(props().editor.pairBounds?.handover).toEqual({ enter: 0, exit: 40 });
  const check = () => {
    const b = props().editor.planned.slots[1];
    expect(slotLanesAt(b, -16).fader).toBe(0);
    expect(slotLanesAt(b, 0).fader).toBe(0);
    expect(slotLanesAt(b, 2).fader).toBeCloseTo(0.5);
    expect(slotLanesAt(b, 4).fader).toBe(1);
  };
  check();
  await act(async () => { await vi.advanceTimersByTimeAsync(800); });
  const data = vi.mocked(api.transitions.replacePair).mock.lastCall![2][0].data;
  expect(data.startSec).toBe(60);
  expect(data.hiddenLanes).toEqual(['faderB']);
  expect(data.lanes).toEqual(expect.objectContaining({ faderB: [{ x: 0.25, y: 0.8 }, { x: 0.75, y: 0.3 }] }));
  act(() => root.unmount());
  root = createRoot(host);
  await act(async () => root.render(<QueryClientProvider client={client}><RoutineEditorView /></QueryClientProvider>));
  await act(async () => { await vi.advanceTimersByTimeAsync(30); });
  check();
});

it('derives pair EXIT live beyond the old window without saving on open', async () => {
  await openReview(false);
  const props = () => timeline.mock.lastCall![0] as ComponentProps<typeof RoutineTimeline>;
  expect(props().editor.pairBounds?.handover).toEqual({ enter: 0, exit: 240 });
  expect(props().editor.input.durationBeats).toBeGreaterThan(240);
  act(() => props().player.seek(-40));
  expect(props().player.getMixTime()).toBe(-40);
  vi.useFakeTimers();
  act(() => props().draftStore.setLane('0', 'fader', [
    { beat: 0, value: 1 }, { beat: 260, value: 0 },
  ]));
  // EOF still wins over an envelope extending beyond the available audio.
  expect(props().editor.pairBounds?.handover?.exit).toBe(240);
  expect(props().player.getMixTime()).toBe(-40);
  await act(async () => { await vi.advanceTimersByTimeAsync(800); });
  expect(api.transitions.replacePair).not.toHaveBeenCalled();
});

it('promotes, autosaves and reopens resized handovers without moving unchanged automation', async () => {
  await openReview(false);
  const props = () => timeline.mock.lastCall![0] as ComponentProps<typeof RoutineTimeline>;
  act(() => {
    props().draftStore.setLane('1', 'fader', [{ beat: 20, value: 0 }, { beat: 24, value: 1 }]);
    props().draftStore.setLane('1', 'eqLow', [{ beat: 10, value: 0.2 }, { beat: 30, value: 0.5 }]);
    props().draftStore.setLane('0', 'fader', [{ beat: 0, value: 1 }, { beat: 100, value: 0 }]);
  });
  expect(props().editor.pairBounds?.handover).toEqual({ enter: 20, exit: 100 });
  const plan = props().editor.planned;
  expect(routineSlotStateAt(plan, plan.slots[0], 49.9).playing).toBe(true);
  expect(slotLanesAt(plan.slots[0], 99.8).fader).toBeCloseTo(0.002);
  expect(routineSlotStateAt(plan, plan.slots[0], 50).playing).toBe(false);
  expect(api.transitions.replacePair).not.toHaveBeenCalled();
  await promote();
  expect(vi.mocked(api.transitions.replacePair).mock.lastCall![2][0].data.durationSec).toBe(50);
  vi.useFakeTimers();
  act(() => props().draftStore.setLane('0', 'fader', [{ beat: 0, value: 1 }, { beat: 200, value: 0 }]));
  expect(props().editor.pairBounds?.handover).toEqual({ enter: 20, exit: 200 });
  await act(async () => { await vi.advanceTimersByTimeAsync(800); });
  const saved = vi.mocked(api.transitions.replacePair).mock.lastCall![2][0].data;
  expect(saved.durationSec).toBe(100);
  expect(saved.lanes).toEqual(expect.objectContaining({
    eqLowB: [{ x: 0.05, y: 0.2 }, { x: 0.15, y: 0.5 }],
  }));
  act(() => root.unmount());
  root = createRoot(host);
  await act(async () => root.render(<QueryClientProvider client={client}><RoutineEditorView /></QueryClientProvider>));
  await act(async () => { await vi.advanceTimersByTimeAsync(30); });
  expect(props().editor.pairBounds?.handover).toEqual({ enter: 20, exit: 200 });
  expect(props().edits.lanes['1:eqLow']).toEqual([{ beat: 10, value: 0.2 }, { beat: 30, value: 0.5 }]);
  const writes = vi.mocked(api.transitions.replacePair).mock.calls.length;
  await act(async () => { await vi.advanceTimersByTimeAsync(800); });
  expect(api.transitions.replacePair).toHaveBeenCalledTimes(writes);
});

it('widens before the old window live and preserves that edit on promotion', async () => {
  await openReview(false);
  const props = () => timeline.mock.lastCall![0] as ComponentProps<typeof RoutineTimeline>;
  act(() => {
    props().draftStore.setLane('1', 'fader', [{ beat: -20, value: 0 }, { beat: -16, value: 1 }]);
    props().draftStore.setLane('0', 'fader', [{ beat: 0, value: 1 }, { beat: 100, value: 0 }]);
  });
  // B's entry alignment is at 8s: its audio starts two seconds into the new lead.
  expect(props().editor.pairBounds?.handover).toEqual({ enter: -16, exit: 100 });
  await promote();
  const saved = vi.mocked(api.transitions.replacePair).mock.lastCall![2][0].data;
  expect(saved.startSec).toBe(50);
  expect(saved.bInSec).toBe(-2);
  expect(saved.durationSec).toBe(60);
});

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
      data: expect.objectContaining({ startSec: 60, bInSec: 8, durationSec: 120 }),
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

function pickerProps(): ComponentProps<typeof MixPicker> {
  return picker.mock.lastCall![0];
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function cue(trackId: number, slot: number, seconds: number): HotCue {
  return {
    id: trackId * 10 + slot, track_id: trackId, slot_number: slot, time_seconds: seconds,
    label: null, color: null, created_at: '', updated_at: '',
  };
}

function grid(trackId: number, secondsPerBeat: number): BeatgridResponse {
  return {
    id: trackId, track_id: trackId, origin: 'analyzed', anchor_time: null,
    created_at: null, updated_at: null,
    data: {
      beat_times: Array.from({ length: 601 }, (_, i) => i * secondsPerBeat),
      downbeat_times: [], tempo_changes: [],
    },
  };
}

async function mountNewPair(pinFollow = false) {
  act(() => root.render(
    <QueryClientProvider client={client}><RoutineEditorView /></QueryClientProvider>,
  ));
  await act(async () => requestMixEdit({
    open: { kind: 'transition', aTrackId: 1, bTrackId: 2, uuid: null },
    setContext: pinFollow ? { setId: 2, headTrackId: 1 } : undefined,
  }));
}

async function waitForPair(cast = [1, 2]) {
  await vi.waitFor(async () => {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(timelineProps().editor.detail.cast).toEqual(cast);
    expect(pickerProps().busy).toBe(false);
  });
}

it('waits for both tracks, fresh cues and both grids before seeding, then saves only the first edit', async () => {
  const a = deferred<Track>();
  const b = deferred<Track>();
  const cues = deferred<Record<number, HotCue[]>>();
  const aGrid = deferred<BeatgridResponse>();
  const bGrid = deferred<BeatgridResponse>();
  const outgoing = { id: 1, bpm: 120, duration_secs: 180 } as Track;
  const incoming = { id: 2, bpm: 90, duration_secs: 240 } as Track;
  const freshCues = { 1: [cue(1, 4, 40)], 2: [cue(2, 2, 90)] };
  const grids = [grid(1, 0.4), grid(2, 0.75)];
  vi.mocked(api.tracks.getById).mockImplementation((id) => id === 1 ? a.promise : b.promise);
  vi.mocked(api.hotcues.getBulk).mockReturnValue(cues.promise);
  client.setQueryData(['hotcues-bulk', '1,2'], { 2: [cue(2, 1, 1)] });
  client.removeQueries({ queryKey: ['beatgrid'] });
  vi.spyOn(api.beatgrids, 'get').mockImplementation((id) => id === 1 ? aGrid.promise : bGrid.promise);
  await mountNewPair();
  expect(api.tracks.getById).toHaveBeenCalledWith(1);
  expect(api.tracks.getById).toHaveBeenCalledWith(2);
  expect(api.hotcues.getBulk).toHaveBeenCalledWith([1, 2]);
  expect(api.beatgrids.get).toHaveBeenCalledWith(1);
  expect(api.beatgrids.get).toHaveBeenCalledWith(2);
  for (const resolve of [
    () => a.resolve(outgoing), () => b.resolve(incoming),
    () => cues.resolve(freshCues), () => aGrid.resolve(grids[0]),
  ]) {
    await act(async () => resolve());
    expect(pairSlotTranslation.seedNewTransition).not.toHaveBeenCalled();
    expect(timeline).not.toHaveBeenCalled();
    expect(pickerProps().busy).toBe(true);
  }
  await act(async () => bGrid.resolve(grids[1]));
  await waitForPair();
  expect(pairSlotTranslation.seedNewTransition).toHaveBeenCalledExactlyOnceWith({
    durationSec: 180, bpm: 120, hotCues: freshCues[1], beatTimes: grids[0].data.beat_times,
  }, {
    durationSec: 240, bpm: 90, hotCues: freshCues[2], beatTimes: grids[1].data.beat_times,
  });
  expect(timelineProps().editor.detail.entry_positions[0]).toBeCloseTo(65.6);
  expect(timelineProps().editor.detail.entry_positions[1]).toBeCloseTo(42);
  // The seed counts 32 grid beats; the visible editor also includes
  // surrounding authoring context under ADR 0040.
  expect(vi.mocked(pairSlotTranslation.seedNewTransition).mock.results[0].value.durationSec).toBeCloseTo(32 * 0.4);

  vi.useFakeTimers();
  await act(async () => { await vi.advanceTimersByTimeAsync(800); });
  expect(api.transitions.replacePair).not.toHaveBeenCalled();
  expect(localStorage.getItem('manadj-last-mix')).toBeNull();
  act(() => timelineProps().draftStore.setLane('1', 'eqLow', [{ beat: 0, value: 0.25 }]));
  await act(async () => { await vi.advanceTimersByTimeAsync(800); });
  const seed = vi.mocked(pairSlotTranslation.seedNewTransition).mock.results[0].value;
  expect(api.transitions.replacePair).toHaveBeenCalledExactlyOnceWith(1, 2, [
    // ADR 0040 derives the saved extent from controls. The cue alignment
    // survives while defaults are materialized alongside the changed lane.
    expect.objectContaining({ data: expect.objectContaining({
      startSec: seed.startSec, bInSec: seed.bInSec, tempoMatch: seed.tempoMatch,
      lanes: expect.objectContaining({ eqLowB: [{ x: 0, y: 0.25 }] }),
    }) }),
  ]);
});

it('reuses cached grids but fetches fresh cues for each new draft on the same pair', async () => {
  client.setQueryData(['beatgrid', 1], grid(1, 0.4));
  client.setQueryData(['beatgrid', 2], grid(2, 0.75));
  const gridFetch = vi.spyOn(api.beatgrids, 'get');
  vi.mocked(api.hotcues.getBulk).mockResolvedValue({ 1: [cue(1, 4, 40)], 2: [cue(2, 1, 12)] });
  await mountNewPair();
  await waitForPair();
  expect(timelineProps().editor.detail.entry_positions).toEqual([expect.closeTo(65.6), 12]);
  const firstUuid = timelineProps().editor.detail.uuid;
  vi.mocked(api.hotcues.getBulk).mockResolvedValue({ 1: [cue(1, 4, 40)], 2: [cue(2, 4, 150)] });
  const cueFetchCount = vi.mocked(api.hotcues.getBulk).mock.calls.length;
  await act(async () => pickerProps().onOpen({ kind: 'new-transition', aTrackId: 1, bTrackId: 2 }));
  await waitForPair();
  // The display observer may also refetch; creation must obtain fresh facts.
  expect(vi.mocked(api.hotcues.getBulk).mock.calls.length).toBeGreaterThan(cueFetchCount);
  expect(timelineProps().editor.detail.uuid).not.toBe(firstUuid);
  expect(timelineProps().editor.detail.entry_positions).toEqual([expect.closeTo(65.6), 54]);
  expect(gridFetch).not.toHaveBeenCalled();
  expect(api.transitions.replacePair).not.toHaveBeenCalled();
});

it.each(['missing', 'error'])('uses each track BPM when its grid is %s and never re-anchors on later arrival', async (availability) => {
  const getTrack = vi.mocked(api.tracks.getById).getMockImplementation()!;
  vi.mocked(api.tracks.getById).mockImplementation(async (id) => ({
    ...await getTrack(id), bpm: id === 1 ? 120 : 90,
  }));
  vi.mocked(api.hotcues.getBulk).mockResolvedValue({ 1: [cue(1, 4, 40)], 2: [cue(2, 2, 90)] });
  if (availability === 'error') {
    client.removeQueries({ queryKey: ['beatgrid'] });
    vi.spyOn(api.beatgrids, 'get').mockRejectedValue(new Error('No grid'));
  }
  await mountNewPair();
  await waitForPair();
  const positions = timelineProps().editor.detail.entry_positions;
  expect(positions[0]).toBe(72);
  expect(positions[1]).toBeCloseTo(90 - 64 * 60 / 90);
  expect(pairSlotTranslation.seedNewTransition).toHaveBeenCalledTimes(1);
  expect(toast).not.toHaveBeenCalled();
  await act(async () => {
    client.setQueryData(['beatgrid', 1], grid(1, 0.4));
    client.setQueryData(['beatgrid', 2], grid(2, 0.75));
    client.setQueryData(['hotcues-bulk', '1,2'], { 2: [cue(2, 1, 1)] });
  });
  expect(timelineProps().editor.detail.entry_positions).toEqual(positions);
  expect(pairSlotTranslation.seedNewTransition).toHaveBeenCalledTimes(1);
});

it('keeps the outro / track-zero fallback for successfully fetched empty cues', async () => {
  await mountNewPair();
  await waitForPair();
  expect(timelineProps().editor.detail.entry_positions).toEqual([164, 0]);
  expect(vi.mocked(pairSlotTranslation.seedNewTransition).mock.results[0].value.durationSec).toBe(16);
});

it('reports cue retrieval failure without replacing the current draft or arming failed Set context', async () => {
  await mountNewPair();
  await waitForPair();
  const uuid = timelineProps().editor.detail.uuid;
  vi.mocked(api.hotcues.getBulk).mockRejectedValue(new Error('Cues offline'));
  await act(async () => requestMixEdit({
    open: { kind: 'transition', aTrackId: 1, bTrackId: 3, uuid: null },
    setContext: { setId: 1, headTrackId: 1 },
  }));
  expect(toast).toHaveBeenCalledWith('Transition creation failed: Cues offline');
  expect(timelineProps().editor.detail.uuid).toBe(uuid);
  expect(pairSlotTranslation.seedNewTransition).toHaveBeenCalledTimes(1);
  expect(pickerProps().busy).toBe(false);
  expect(host.querySelector('.re-setctx')).toBeNull();
  expect(api.transitions.replacePair).not.toHaveBeenCalled();
});

it.each(['saved', 'newer-first', 'older-first'])('ignores stale creation when a later open wins (%s)', async (order) => {
  const older = deferred<Record<number, HotCue[]>>();
  const newer = deferred<Record<number, HotCue[]>>();
  vi.mocked(api.hotcues.getBulk).mockImplementation((ids) => ids[1] === 2 ? older.promise : newer.promise);
  const saved = { startSec: 11, bInSec: 7, durationSec: 9, tempoMatch: false, lanes: {} };
  vi.mocked(api.transitions.list).mockResolvedValue([{
    uuid: 'saved-pair', name: 'Saved', favorite: false, position: 0,
    a_track_id: 1, b_track_id: 3, updated_at: null, data: saved,
  }]);
  await mountNewPair(true);
  await act(async () => requestMixEdit({
    open: { kind: 'transition', aTrackId: 1, bTrackId: 3, uuid: order === 'saved' ? 'saved-pair' : null },
    setContext: { setId: 1, headTrackId: 1 },
  }));
  if (order === 'older-first') {
    await act(async () => older.resolve({}));
    expect(pickerProps().busy).toBe(true);
    expect(pairSlotTranslation.seedNewTransition).not.toHaveBeenCalled();
    expect(timeline).not.toHaveBeenCalled();
  }
  await act(async () => newer.resolve({ 3: [cue(3, 1, 17)] }));
  await waitForPair([1, 3]);
  const detail = timelineProps().editor.detail;
  expect(detail.entry_positions).toEqual(order === 'saved' ? [11, 7] : [164, 17]);
  expect(host.querySelector('.re-setctx')).not.toBeNull();
  await act(async () => older.resolve({}));
  expect(timelineProps().editor.detail).toEqual(detail);
  expect(pickerProps().busy).toBe(false);
  expect(host.querySelector('.re-setctx')).not.toBeNull();
  expect(pairSlotTranslation.seedNewTransition).toHaveBeenCalledTimes(order === 'saved' ? 0 : 1);
  expect(api.transitions.replacePair).not.toHaveBeenCalled();
});

async function openRoutine(originTakeUuid: string | null = null, overrides: Partial<RoutineEdits> = {}) {
  const edits = {
    ...emptyEdits(),
    lanes: { '0:fader': [{ beat: 0, value: 0.8 }, { beat: 64, value: 1 }] },
    jumps: [{ id: 'jump-1', slotId: '0', beat: 4, deltaSec: -1 }],
    ...overrides,
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

it('does not restore a cached trim offset when resetting the knob then discarding the envelope', async () => {
  await openRoutine(null, {
    lanes: { '0:trim': [{ beat: 0, value: 0.25 }, { beat: 64, value: 0.75 }] },
    trims: { '0': 0.8 },
  });
  vi.useFakeTimers();
  const value = () => slotLanesAt(timelineProps().editor.planned.slots[0], 32).trim;
  expect(value()).toBeCloseTo(0.8);
  act(() => {
    timelineProps().draftStore.setTrim('0', 0.5);
    timelineProps().draftStore.endGesture();
  });
  expect(value()).toBeCloseTo(0.5);
  act(() => timelineProps().draftStore.clearLane('0', 'trim'));
  expect(timelineProps().edits.trims['0']).toBeUndefined();
  expect(timelineProps().editor.planned.slots[0].trim).toBe(0.5);
  expect(value()).toBeCloseTo(0.5);
});

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
  expect(timelineProps().player.getMixTime()).toBe(6);
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
