// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { RoutineDetailWire } from '../api/client';
import { RoutineTimeline } from './RoutineTimeline';
import type { RoutinePlayer } from './RoutinePlayer';
import { buildEditorRoutine } from './routineEditorModel';
import { RoutineDraftStore, useRoutineDraft } from './routineDraftStore';
import { emptyEdits } from './routineDraft';

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

function Timeline() {
  const { edits } = useRoutineDraft(store);
  const editor = buildEditorRoutine(detail, [120, 120, 120], 120, edits)!;
  return <RoutineTimeline
    editor={editor} plannedForRuns={editor.planned}
    recordedJumpsBySlot={{}} recordedPausesBySlot={{}}
    tracks={new Map()} waves={new Map()} meters={new Map()} hotcues={new Map()}
    player={{ getBeat: () => 0 } as RoutinePlayer}
    draftStore={store} edits={edits} trim={editor.planned.playbackBounds}
    onTrimChange={(bounds) => store.setPlaybackBounds(bounds)}
    onSeekBeat={() => {}} mode="select" onModeHome={() => {}}
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

function pointer(target: EventTarget, type: string, clientX = 0) {
  act(() => target.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX })));
}

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

it('fits widened bounds and keeps crop shading on the saved beat axis', () => {
  act(() => store.setPlaybackBounds({ startBeat: -32, endBeat: 128 }));
  act(() => host.querySelector<HTMLButtonElement>('[title="Fit the window"]')!.click());
  expect(handles()).toHaveLength(2);
  expect(x(handles()[0])).toBeGreaterThan(208);
  expect(x(handles()[1])).toBeLessThan(1024);
  const px = (x(handles()[1]) - x(handles()[0])) / 160;
  const originX = x(handles()[0]) + 32 * px;

  act(() => store.setPlaybackBounds({ startBeat: 8, endBeat: 56 }));
  const bounds = Array.from(host.querySelectorAll<HTMLElement>('.rt-boundaryline'));
  expect(x(bounds[0])).toBeCloseTo(originX + 8 * px);
  expect(x(bounds[1])).toBeCloseTo(originX + 56 * px);
  const shades = host.querySelectorAll<HTMLElement>('.rt-trimshade');
  expect(shades).toHaveLength(2);
  expect(Number.parseFloat(shades[0].style.left)).toBeCloseTo(originX);
  expect(Number.parseFloat(shades[0].style.width)).toBeCloseTo(8 * px);
  expect(Number.parseFloat(shades[1].style.width)).toBeCloseTo(8 * px);
  expect(host.querySelectorAll('.rt-slotblock')).toHaveLength(3);
});
