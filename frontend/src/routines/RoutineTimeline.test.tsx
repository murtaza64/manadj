// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { RoutineDetailWire } from '../api/client';
import { RoutineTimeline } from './RoutineTimeline';
import type { RoutinePlayer } from './RoutinePlayer';
import { buildEditorRoutine, recordedJumps, recordedPauses } from './routineEditorModel';
import { RoutineDraftStore, useRoutineDraft } from './routineDraftStore';
import { emptyEdits } from './routineDraft';
import type { EditorMode } from './editorMode';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const detail: RoutineDetailWire = {
  uuid: 'routine-bounds', name: null, cast: [1, 2, 3],
  entry_offsets_beats: [0, 16, 32], entry_positions: [60, 0, 10],
  duration_beats: 64, origin_take_uuid: null, created_at: null,
  events: [
    { kind: 'tick', beat: 0, playheads: { '0': 60 } },
    { kind: 'tick', beat: 64, playheads: { '0': 92, '1': 24, '2': 26 } },
  ],
};

let host: HTMLDivElement;
let root: Root;
let store: RoutineDraftStore;

function Timeline({ source = detail, mode = 'select', pairMode = false, pairBounds, auditionRange }: {
  source?: RoutineDetailWire;
  mode?: EditorMode;
  pairMode?: boolean;
  pairBounds?: { handover: { enter: number; exit: number } | null };
  auditionRange?: { startSec: number; endSec: number };
}) {
  const { edits } = useRoutineDraft(store);
  const editor = buildEditorRoutine(source, [120, 120, 120], 120, edits)!;
  editor.pairBounds = pairBounds;
  editor.planned.auditionRange = auditionRange;
  const raw = buildEditorRoutine(source, [120, 120, 120], 120, emptyEdits()).planned;
  return <RoutineTimeline
    editor={editor} plannedForRuns={editor.planned}
    recordedJumpsBySlot={Object.fromEntries(raw.slots.map((s) => [s.slotId, recordedJumps(s.trace)]))}
    recordedPausesBySlot={Object.fromEntries(raw.slots.map((s) => [s.slotId, recordedPauses(s.trace)]))}
    tracks={new Map()} waves={new Map()} meters={new Map()} hotcues={new Map()}
    player={{ getBeat: () => 0 } as RoutinePlayer}
    draftStore={store} edits={edits} trim={pairMode ? null : editor.planned.playbackBounds}
    onTrimChange={pairMode ? null : (bounds) => store.setPlaybackBounds(bounds)}
    onSeekBeat={() => {}} mode={mode} onModeHome={() => {}} pairMode={pairMode}
  />;
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1024);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  store = new RoutineDraftStore();
  store.load(detail.uuid, emptyEdits());
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(<Timeline />));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function x(el: HTMLElement): number {
  return Number(el.style.transform.match(/translateX\(([^)]+)px\)/)![1]);
}

function handles(): HTMLElement[] {
  return Array.from(host.querySelectorAll<HTMLElement>('.rt-trimhandle'));
}

function pointer(target: EventTarget, type: string, clientX = 0, init: PointerEventInit = {}) {
  act(() => target.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX, ...init })));
}

function doubleClick(target: EventTarget, clientX = 0, shiftKey = false) {
  for (const detail of [1, 2]) {
    // Browsers need not populate pointerdown.detail; click carries the count.
    pointer(target, 'pointerdown', clientX, { shiftKey });
    pointer(target, 'pointerup', clientX, { shiftKey });
    act(() => target.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX, detail, shiftKey })));
  }
  act(() => target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX, detail: 2, shiftKey })));
}

function wave(): HTMLCanvasElement {
  return host.querySelector('.rt-wave-row > canvas')!;
}

function button(selector: string) {
  const el = host.querySelector<HTMLButtonElement>(selector)!;
  expect(el).not.toBeNull();
  act(() => el.click());
}

function expectNoEvents() {
  expect(host.querySelectorAll('.rt-jump, .rt-jump-pole, .rt-pause-link, .rt-jump-popover')).toHaveLength(0);
  expect(host.textContent).not.toContain('removed');
}

it('trims an incoming track start without adding or moving jumps, with drag undo', () => {
  const source = { ...detail, entry_positions: [60, 20, 10], events: [
    { kind: 'tick', beat: 0, playheads: { '0': 60 } },
    { kind: 'tick', beat: 64, playheads: { '0': 92, '1': 44, '2': 26 } },
  ] };
  act(() => root.render(<Timeline source={source} />));
  const px = (1024 - 208) / (64 + 8);
  const originX = 208 + 4 * px;
  const handle = host.querySelector<HTMLElement>('.rt-track-start')!;
  expect(handle).not.toBeNull();
  expect(host.querySelectorAll('.rt-track-start')).toHaveLength(2);
  pointer(handle, 'pointerdown', originX + 16 * px);
  pointer(window, 'pointermove', originX + 8 * px, { shiftKey: true });
  pointer(window, 'pointerup');
  expect(store.getSnapshot().edits.startTrims?.['1']).toBeCloseTo(-8);
  expect(store.getSnapshot().edits.jumps).toEqual([]);
  expect(host.querySelector<HTMLInputElement>('[aria-label="Track 2 start beat"]')!.value).toBe('8');
  act(() => store.undo());
  expect(store.getSnapshot().edits.startTrims).toBeUndefined();
  act(() => store.redo());
  expect(store.getSnapshot().edits.startTrims?.['1']).toBeCloseTo(-8);
  act(() => host.querySelector<HTMLButtonElement>('[title="Restore original track start"]')!.click());
  expect(store.getSnapshot().edits.startTrims).toBeUndefined();
});

it('does not expose unpersistable start trims for pair artifacts', () => {
  act(() => root.render(<Timeline pairMode />));
  expect(host.querySelector('.rt-track-start')).toBeNull();
  expect(host.querySelector('.rt-start-control')).toBeNull();
});

it('renders pair handover bounds and edits pre-window jumps without Routine trims', () => {
  const source = { ...detail, cast: [1, 2], entry_offsets_beats: [0, 0], entry_positions: [60, 8], events: [
    { kind: 'tick', beat: 0, playheads: { '0': 60, '1': 8 } },
    { kind: 'tick', beat: 64, playheads: { '0': 92, '1': 40 } },
  ] };
  const range = { startSec: -60, endSec: 32 };
  act(() => root.render(<Timeline source={source} pairMode
    pairBounds={{ handover: { enter: 8, exit: 24 } }} auditionRange={range} />));
  expect(handles()).toHaveLength(0);
  expect(host.querySelector('.rt-start-control')).toBeNull();
  const markers = Array.from(host.querySelectorAll<HTMLElement>('.rt-boundaryline'));
  expect(markers).toHaveLength(2);
  expect(x(markers[1]) - x(markers[0])).toBeCloseTo(16 * (816 / 72));

  button('[title^="Fit the whole tracks"]');
  const px = 1024 / (120 + 64 + 8);
  const clientX = (124 - 16) * px;
  doubleClick(wave(), clientX);
  expect(store.getSnapshot().edits.jumps[0].beat).toBe(-16);
  expect(host.querySelector<HTMLButtonElement>('[title^="Pauses are not part"]')!.disabled).toBe(true);
  pointer(host.querySelector('.rt-jump.authored')!, 'pointerdown', clientX);
  pointer(window, 'pointermove', clientX + 4 * px, { shiftKey: true });
  pointer(window, 'pointerup');
  expect(store.getSnapshot().edits.jumps[0].beat).toBeCloseTo(-12);
  expect(store.getSnapshot().edits.playbackBounds).toBeUndefined();

  act(() => root.render(<Timeline source={source} pairMode
    pairBounds={{ handover: null }} auditionRange={range} />));
  expect(host.querySelectorAll('.rt-boundaryline')).toHaveLength(0);
  expect(host.textContent).toContain('No incoming handover');
  const warning = host.querySelector<HTMLElement>('[role="status"]')!;
  expect(warning.style.bottom).toBe('auto');
  expect(warning.style.pointerEvents).toBe('none');
});

it('keeps track-start dragging Select-only while numeric controls stay modeless', () => {
  act(() => root.render(<Timeline mode="jump" />));
  expect(host.querySelector('.rt-track-start')).toBeNull();
  expect(host.querySelector('.rt-start-control')).not.toBeNull();
});

it.each(['pointerup', 'pointercancel'])('seals one undo entry per handle drag on %s', (finish) => {
  const seal = vi.spyOn(store, 'endGesture');
  const [start, end] = handles();
  const endX = x(end);
  const px = (endX - x(start)) / 64;
  // Fit places beat zero after the 208px panel and four beats of padding.
  // Pointer coordinates use that unsnapped axis, not the rounded handle position.
  const originX = 208 + 4 * px;
  pointer(start, 'pointerdown', originX);
  pointer(window, 'pointermove', originX + 8 * px);
  pointer(window, 'pointermove', originX + 12 * px);
  pointer(window, finish);
  expect(seal).toHaveBeenCalledTimes(1);
  expect(store.getSnapshot().edits.playbackBounds?.startBeat).toBeCloseTo(12);
  expect(x(handles()[1])).toBeCloseTo(endX);
  pointer(window, 'pointermove', originX + 20 * px);
  expect(store.getSnapshot().edits.playbackBounds?.startBeat).toBeCloseTo(12);

  pointer(handles()[0], 'pointerdown', originX + 12 * px);
  pointer(window, 'pointermove', originX + 16 * px);
  pointer(window, finish);
  expect(seal).toHaveBeenCalledTimes(2);
  act(() => store.undo());
  expect(store.getSnapshot().edits.playbackBounds?.startBeat).toBeCloseTo(12);
  act(() => store.undo());
  expect(store.getSnapshot().edits.playbackBounds).toBeUndefined();
  expect(store.getSnapshot().canUndo).toBe(false);
  expect(document.body.style.userSelect).toBe('');
});

it('shows current bounds without marking extensions or crops against the source length', () => {
  act(() => store.setPlaybackBounds({ startBeat: -32, endBeat: 128 }));
  act(() => host.querySelector<HTMLButtonElement>('[title="Fit the window"]')!.click());
  expect(handles()).toHaveLength(2);
  expect(x(handles()[0])).toBeGreaterThan(208);
  expect(x(handles()[1])).toBeLessThan(1024);
  expect.soft(host.querySelector('.rt-trimextend')).toBeNull();
  const px = (x(handles()[1]) - x(handles()[0])) / 160;
  const originX = x(handles()[0]) + 32 * px;

  act(() => store.setPlaybackBounds({ startBeat: 8, endBeat: 56 }));
  const bounds = Array.from(host.querySelectorAll<HTMLElement>('.rt-boundaryline'));
  expect(x(bounds[0])).toBeCloseTo(originX + 8 * px);
  expect(x(bounds[1])).toBeCloseTo(originX + 56 * px);
  expect(host.querySelector('.rt-trimshade')).toBeNull();
  expect(detail.duration_beats).toBe(64);
  expect(host.querySelectorAll('.rt-slotblock')).toHaveLength(3);
});

it.each([-16, 96])('adds and drags automation at original beat %s in expanded playback bounds', (beat) => {
  const original = [{ beat: 16, value: 0.25 }, { beat: 48, value: 0.75 }];
  act(() => {
    store.setLane('0', 'fader', original);
    store.endGesture();
    store.setPlaybackBounds({ startBeat: -32, endBeat: 128 });
    store.endGesture();
  });
  button('[title="Fit the window"]');
  const px = 816 / 168;
  const originX = x(handles()[0]) + 32 * px;
  const lane = host.querySelector<HTMLElement>('.rt-lanewindow')!;
  const hit = lane.querySelector<HTMLElement>('.editor-lanehit')!;
  const left = Number.parseFloat(lane.style.left);
  const width = Number.parseFloat(lane.style.width);
  expect.soft(left).toBeCloseTo(originX - 32 * px);
  expect.soft(left + width).toBeCloseTo(originX + 128 * px);
  expect(store.getSnapshot().edits.lanes['0:fader']).toEqual(original);

  // jsdom has no layout: use the rendered lane bounds and LaneCanvas's 7px hit overhang.
  vi.spyOn(hit, 'getBoundingClientRect').mockReturnValue(new DOMRect(left - 7, 100, width + 14, 56));
  Object.defineProperty(hit, 'setPointerCapture', { value: vi.fn(), configurable: true });
  const clientX = originX + beat * px;
  pointer(hit, 'pointerdown', clientX, { clientY: 128 });
  pointer(hit, 'pointerup', clientX, { clientY: 128 });
  const inserted = store.getSnapshot().edits.lanes['0:fader'];
  expect(inserted).toHaveLength(3);
  expect(inserted.find((p) => p.value === 0.5)?.beat).toBeCloseTo(beat);
  expect(inserted.filter((p) => p.value !== 0.5)).toEqual(original);

  pointer(hit, 'pointerdown', clientX, { clientY: 128 });
  pointer(hit, 'pointermove', clientX + 4 * px, { clientY: 128, shiftKey: true });
  pointer(hit, 'pointerup', clientX + 4 * px, { clientY: 128 });
  const dragged = store.getSnapshot().edits.lanes['0:fader'];
  expect(dragged.find((p) => p.value === 0.5)?.beat).toBeCloseTo(beat + 4);
  expect(dragged.filter((p) => p.value !== 0.5)).toEqual(original);
  act(() => store.undo());
  expect(store.getSnapshot().edits.lanes['0:fader']).toEqual(inserted);
  act(() => store.undo());
  expect(store.getSnapshot().edits.lanes['0:fader']).toEqual(original);
  act(() => { store.redo(); store.redo(); });
  expect(store.getSnapshot().edits.lanes['0:fader']).toEqual(dragged);
});

it.each(['select', 'jump'] as const)('%s waveform double-click inserts once and opens pause conversion', (mode) => {
  act(() => root.render(<Timeline mode={mode} />));
  const add = vi.spyOn(store, 'addJump');
  doubleClick(wave(), 208 + 20 * (816 / 72)); // beat 16 on the original fit
  expect(add).toHaveBeenCalledTimes(1);
  expect(store.getSnapshot().edits.jumps).toHaveLength(1);
  expect(store.getSnapshot().edits.jumps[0].beat).toBe(16);
  expect(host.querySelectorAll('.rt-jump.authored')).toHaveLength(1);
  expect(host.querySelectorAll('.rt-jump-popover')).toHaveLength(1);
  button('[title^="Pause: hold"]');
  expect(store.getSnapshot().edits.jumps).toHaveLength(0);
  expect(store.getSnapshot().edits.pauses).toMatchObject([{ slotId: '0', beat: 16, durBeats: 4 }]);
  expect(host.querySelectorAll('.rt-jump.authored-pause')).toHaveLength(2);
  expect(host.querySelectorAll('.rt-pause-link')).toHaveLength(1);
});

it('Select single-click selects without insertion; Jump single-click inserts', () => {
  const target = wave();
  pointer(target, 'pointerdown', 480);
  pointer(target, 'pointerup', 480);
  act(() => target.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 480, detail: 1 })));
  expect(host.querySelectorAll('.rt-selected')).toHaveLength(1);
  expect(store.getSnapshot().edits.jumps).toHaveLength(0);
  act(() => root.render(<Timeline mode="jump" />));
  pointer(target, 'pointerdown', 480);
  pointer(target, 'pointerup', 480);
  act(() => target.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 480, detail: 1 })));
  expect(store.getSnapshot().edits.jumps).toHaveLength(1);
});

it('Pan double-click remains navigation and pairs still prohibit pause insertion', () => {
  act(() => root.render(<Timeline mode="pan" />));
  doubleClick(wave(), 480);
  expectNoEvents();
  expect(store.getSnapshot().canUndo).toBe(false);
  act(() => root.render(<Timeline pairMode />));
  doubleClick(wave(), 480);
  const pause = host.querySelector<HTMLButtonElement>('[title^="Pauses are not part"]')!;
  expect(pause.disabled).toBe(true);
  act(() => pause.click());
  expect(store.getSnapshot().edits.pauses).toHaveLength(0);
  expect(store.getSnapshot().edits.jumps).toHaveLength(1);
});

it('double-click excludes chrome, panels, markers, popovers and automation', () => {
  doubleClick(wave(), 480);
  act(() => {
    store.setLane('0', 'fader', [{ beat: 0, value: 1 }, { beat: 64, value: 1 }]);
    store.endGesture();
  });
  const before = store.getSnapshot().edits;
  for (const selector of [
    '.rt-toolbar-float button', '.rt-ruler', '.rt-rows', '.rt-panelcol',
    '.rt-slotpanel', '.rt-sp-trim', '.rt-lanetoggle', '.rt-jump', '.rt-jump-chip',
    '.rt-jump-pole', '.rt-jump-popover', '.rt-jump-popover input',
    '.rt-jump-popover button', '.rt-laneauthor', '.rt-lanestrip canvas',
    '.rt-lanewindow canvas', '.rt-trimhandle', '.rt-trimgrip',
  ]) {
    const target = host.querySelector(selector);
    expect(target, selector).not.toBeNull();
    act(() => target!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: 480, detail: 2 })));
    expect(store.getSnapshot().edits.jumps, selector).toEqual(before.jumps);
    expect(store.getSnapshot().edits.pauses, selector).toEqual(before.pauses);
  }
});

it.each([-16.25, 96.25])('inserts and drags events at original beat %s in expanded bounds', (beat) => {
  act(() => store.setPlaybackBounds({ startBeat: -32, endBeat: 128 }));
  button('[title="Fit the window"]');
  const px = 816 / 168;
  const clientX = 208 + (beat + 36) * px;
  doubleClick(wave(), clientX, true);
  expect(store.getSnapshot().edits.jumps[0].beat).toBeCloseTo(beat);
  pointer(host.querySelector('.rt-jump.authored')!, 'pointerdown', clientX);
  pointer(window, 'pointermove', clientX + 4 * px, { shiftKey: true });
  pointer(window, 'pointerup');
  expect(store.getSnapshot().edits.jumps[0].beat).toBeCloseTo(beat + 4);
  button('[title^="Pause: hold"]');
  const marker = host.querySelector<HTMLElement>('.rt-jump.authored-pause')!;
  pointer(marker, 'pointerdown', clientX + 4 * px);
  pointer(window, 'pointermove', clientX + 8 * px, { shiftKey: true });
  pointer(window, 'pointerup');
  expect(store.getSnapshot().edits.pauses[0].beat).toBeCloseTo(beat + 8);
});

it('inserts in visible track context without rebasing or expanding playback bounds', () => {
  button('[title^="Fit the whole tracks"]');
  const px = 1024 / (120 + 64 + 8);
  doubleClick(wave(), (124 - 32) * px);
  expect(store.getSnapshot().edits.jumps[0].beat).toBe(-32);
  expect(store.getSnapshot().edits.playbackBounds).toBeUndefined();
});

function recordedSource(kind: 'jump' | 'pause'): RoutineDetailWire {
  return {
    ...detail,
    events: [
      detail.events[0],
      { kind: 'tick', beat: 12, playheads: { '0': 66 } },
      ...(kind === 'jump' ? [
        { kind: 'transport', beat: 16, slot: 0, action: 'seek', playhead: 64 },
      ] : [
        { kind: 'transport', beat: 16, slot: 0, action: 'pause', playhead: 68 },
        { kind: 'transport', beat: 24, slot: 0, action: 'play', playhead: 68 },
      ]),
      { kind: 'tick', beat: 64, playheads: { '0': 88, '1': 24, '2': 26 } },
    ],
  };
}

it.each(['jump', 'pause'] as const)('recorded %s deletion removes every visual; undo/redo restores/removes the real event', (kind) => {
  const source = recordedSource(kind);
  const original = structuredClone(source);
  act(() => root.render(<Timeline source={source} />));
  const selector = kind === 'jump' ? '.rt-jump.recorded' : '.rt-jump.recorded-pause';
  const count = kind === 'jump' ? 1 : 2;
  expect(host.querySelectorAll(selector)).toHaveLength(count);
  pointer(host.querySelector(selector)!, 'pointerdown');
  button('.rt-jump-delete');
  expectNoEvents();
  const removed = kind === 'jump' ? 'removedRecordedJumps' : 'removedRecordedPauses';
  expect(store.getSnapshot().edits[removed]).toEqual([{ slotId: '0', beat: 16 }]);
  act(() => store.undo());
  expect(host.querySelectorAll(selector)).toHaveLength(count);
  expect(host.querySelectorAll('.rt-jump-pole')).toHaveLength(count);
  expect(host.querySelectorAll('.rt-pause-link')).toHaveLength(kind === 'pause' ? 1 : 0);
  expect(store.getSnapshot().edits[removed]).toHaveLength(0);
  // Redo must also dismiss a recorded popup reopened after Undo.
  pointer(host.querySelector(selector)!, 'pointerdown');
  act(() => store.redo());
  expectNoEvents();
  expect(source).toEqual(original);
});

it.each(['jump', 'pause'] as const)('converting, moving, changing type and deleting a recorded %s never reveals a ghost', (kind) => {
  act(() => root.render(<Timeline source={recordedSource(kind)} />));
  pointer(host.querySelector('.rt-jump')!, 'pointerdown');
  button('[title^="Convert to an edited"]');
  expect(host.querySelectorAll('.rt-jump.recorded, .rt-jump.recorded-pause, .ghost, .ghost-pause')).toHaveLength(0);
  const marker = host.querySelector<HTMLElement>('.rt-jump')!;
  pointer(marker, 'pointerdown', x(marker));
  pointer(window, 'pointermove', 208 + 36 * (816 / 72)); // beat 32
  pointer(window, 'pointerup');
  const authored = kind === 'jump' ? 'jumps' : 'pauses';
  expect(store.getSnapshot().edits[authored][0].beat).toBe(32);
  expect(host.querySelectorAll('.ghost, .ghost-pause')).toHaveLength(0);
  button('.rt-jump-delete');
  expectNoEvents();
  act(() => store.undo());
  expect(host.querySelectorAll('.ghost, .ghost-pause, .recorded, .recorded-pause')).toHaveLength(0);
  const restored = host.querySelector('.rt-jump')!;
  pointer(restored, 'pointerdown');
  pointer(window, 'pointerup');
  button(kind === 'jump' ? '[title^="Pause: hold"]' : '[title^="Forward jump"]');
  expect(host.querySelectorAll('.ghost, .ghost-pause')).toHaveLength(0);
  button('.rt-jump-delete');
  expectNoEvents();
  const removed = kind === 'jump' ? 'removedRecordedJumps' : 'removedRecordedPauses';
  expect(store.getSnapshot().edits[removed]).toEqual([{ slotId: '0', beat: 16 }]);
  act(() => store.undo());
  expect(host.querySelectorAll('.rt-jump')).toHaveLength(kind === 'jump' ? 2 : 1);
  expect(host.querySelectorAll('.ghost, .ghost-pause, .recorded, .recorded-pause')).toHaveLength(0);
  act(() => store.redo());
  expectNoEvents();
});
