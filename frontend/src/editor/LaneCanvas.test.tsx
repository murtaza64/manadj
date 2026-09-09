// @vitest-environment jsdom
import { act, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LaneCanvas, type LaneGuide } from './LaneCanvas';
import { laneValueY } from './laneHit';
import type { LaneId, LanePoint } from './mixModel';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const WIDTH = 300;
const HEIGHT = 64;
const PAD = 7;
let host: HTMLDivElement;
let root: Root;
let current: LanePoint[];
let selection: number[];
const changed = vi.fn();
const registerScrollDraw = vi.fn();

function TestLane({ initial, guides = [], id = 'faderA' }: {
  initial: LanePoint[]; guides?: LaneGuide[]; id?: LaneId;
}) {
  const [points, setPoints] = useState(initial);
  const [selected, setSelected] = useState<number[]>([]);
  useEffect(() => { current = points; selection = selected; }, [points, selected]);
  return <LaneCanvas id={id} widthPx={WIDTH} windowLeftPx={0} points={points}
    guides={guides} chopWall={0.001} registerScrollDraw={registerScrollDraw}
    selected={selected} onSelectedChange={setSelected}
    onChange={next => { changed(next); setPoints(next); }} />;
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, right: WIDTH + 2 * PAD, bottom: HEIGHT,
    width: WIDTH + 2 * PAD, height: HEIGHT, toJSON: () => ({}),
  });
  HTMLElement.prototype.setPointerCapture = vi.fn();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  changed.mockClear();
  registerScrollDraw.mockClear();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function render(initial: LanePoint[], guides?: LaneGuide[], id?: LaneId) {
  act(() => root.render(<TestLane initial={initial} guides={guides} id={id} />));
}
function pointer(type: string, x: number, y: number, keys: PointerEventInit = {}) {
  act(() => host.querySelector('.editor-lanehit')!.dispatchEvent(new PointerEvent(type, {
    bubbles: true, pointerId: 1, clientX: PAD + x * WIDTH, clientY: laneValueY(y, HEIGHT), ...keys,
  })));
}
const ghost = () => host.querySelector<HTMLElement>('.editor-lane-insert-preview');

it('plain off-line click never inserts; dragging selects a rectangle in both axes', () => {
  const initial = [{ x: 0.2, y: 0.8 }, { x: 0.5, y: 0.2 }, { x: 0.7, y: 0.7 }];
  render(initial);
  pointer('pointermove', 0.15, 0.95);
  expect(ghost()).toBeNull();
  pointer('pointerdown', 0.15, 0.95);
  pointer('pointerup', 0.15, 0.95);
  expect(changed).not.toHaveBeenCalled();
  pointer('pointerdown', 0.15, 0.95);
  pointer('pointermove', 0.75, 0.55);
  pointer('pointerup', 0.75, 0.55);
  expect(selection).toEqual([0, 2]);
  expect(current).toEqual(initial);
});

it('previews exactly the beat-snapped point clicking the line inserts', () => {
  render([{ x: 0, y: 0 }, { x: 1, y: 1 }], [{ x: 0.5, strong: true }]);
  pointer('pointermove', 0.51, 0.51);
  const preview = ghost()!;
  expect(preview).not.toBeNull();
  expect(parseFloat(preview.style.left)).toBeCloseTo(PAD + 0.5 * WIDTH);
  expect(parseFloat(preview.style.top)).toBeCloseTo(laneValueY(0.5, HEIGHT));
  pointer('pointerdown', 0.51, 0.51);
  pointer('pointerup', 0.51, 0.51);
  expect(current[1]).toEqual({ x: 0.5, y: 0.5 });
  expect(ghost()).toBeNull();
});

it.each([0, 1])('grabs a boundary node at value %s without inserting', (value) => {
  render([{ x: 0.5, y: value }]);
  pointer('pointermove', 0.5, value);
  expect(ghost()).toBeNull();
  pointer('pointerdown', 0.5, value);
  pointer('pointermove', 0.6, 0.5);
  pointer('pointerup', 0.6, 0.5);
  expect(current).toEqual([{ x: 0.6, y: 0.5 }]);
});

it('clicking near a node preserves the grab offset rather than jumping it to the mouse', () => {
  render([{ x: 0.5, y: 1 }]);
  pointer('pointerdown', 0.51, 0.9);
  pointer('pointermove', 0.61, 0.7);
  pointer('pointerup', 0.61, 0.7);
  expect(current[0].x).toBeCloseTo(0.6);
  expect(current[0].y).toBeCloseTo(0.8);
});

it('reaches both extremes when an offset grab is dragged beyond the lane', () => {
  render([{ x: 0.5, y: 1 }]);
  pointer('pointerdown', 0.51, 0.9);
  pointer('pointermove', -0.1, -0.2);
  pointer('pointerup', -0.1, -0.2);
  expect(current).toEqual([{ x: 0, y: 0 }]);
  pointer('pointerdown', 0.01, 0.1);
  pointer('pointermove', 1.2, 1.2);
  pointer('pointerup', 1.2, 1.2);
  expect(current).toEqual([{ x: 1, y: 1 }]);
});

it('does not select a boundary node when a rectangle stays entirely in the gutter', () => {
  render([{ x: 0.5, y: 1 }]);
  pointer('pointerdown', 0.3, 1.14);
  pointer('pointermove', 0.7, 1.1);
  pointer('pointerup', 0.7, 1.1);
  expect(selection).toEqual([]);
  expect(changed).not.toHaveBeenCalled();
});

it('inserts into a vertical step without changing its outgoing value', () => {
  render([{ x: 0.5, y: 0 }, { x: 0.5, y: 1 }]);
  pointer('pointermove', 0.5, 0.5);
  expect(ghost()).not.toBeNull();
  pointer('pointerdown', 0.5, 0.5);
  pointer('pointerup', 0.5, 0.5);
  expect(current).toEqual([{ x: 0.5, y: 0 }, { x: 0.5, y: 0.5 }, { x: 0.5, y: 1 }]);
});

it('empty faders insert only on their drawn full-level line', () => {
  render([]);
  pointer('pointermove', 0.5, 0.5);
  expect(ghost()).toBeNull();
  pointer('pointerdown', 0.5, 0.5);
  pointer('pointerup', 0.5, 0.5);
  expect(current).toEqual([]);
  pointer('pointermove', 0.5, 1);
  expect(ghost()).not.toBeNull();
  pointer('pointerdown', 0.5, 1);
  pointer('pointerup', 0.5, 1);
  expect(current).toEqual([{ x: 0.5, y: 1 }]);
});

it('preserves command time-span selection and suppresses insertion previews for modifiers', () => {
  render([{ x: 0.2, y: 0.8 }, { x: 0.5, y: 0.2 }, { x: 0.7, y: 0.7 }]);
  pointer('pointerdown', 0.15, 0.95, { ctrlKey: true });
  pointer('pointermove', 0.75, 0.55, { ctrlKey: true });
  pointer('pointerup', 0.75, 0.55, { ctrlKey: true });
  expect(selection).toEqual([0, 1, 2]);
  for (const keys of [{ ctrlKey: true }, { altKey: true }, { shiftKey: true }]) {
    pointer('pointermove', 0.9, 0.7, keys);
    expect(ghost()).toBeNull();
  }
});

it('hides the ghost on leave, cancel, or a modifier pressed without moving', () => {
  render([{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }]);
  pointer('pointermove', 0.5, 0.5);
  expect(ghost()).not.toBeNull();
  act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', ctrlKey: true })));
  expect(ghost()).toBeNull();
  pointer('pointermove', 0.5, 0.5);
  pointer('pointercancel', 0.5, 0.5);
  expect(ghost()).toBeNull();
  pointer('pointermove', 0.5, 0.5);
  pointer('pointerout', 0.5, 0.5);
  expect(ghost()).toBeNull();
});

it('clears a stale insertion preview when the timeline scrolls', () => {
  render([{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }]);
  const scroll = registerScrollDraw.mock.lastCall![1];
  act(() => scroll(0, 200));
  pointer('pointermove', 0.5, 0.5);
  expect(ghost()).not.toBeNull();
  act(() => scroll(50, 250));
  expect(ghost()).toBeNull();
});

it('previews the same filter-center magnet that insertion commits', () => {
  render([{ x: 0, y: 0.55 }, { x: 1, y: 0.55 }], [], 'filterA');
  pointer('pointermove', 0.5, 0.55);
  expect(parseFloat(ghost()!.style.top)).toBeCloseTo(laneValueY(0.5, HEIGHT));
  pointer('pointerdown', 0.5, 0.55);
  pointer('pointerup', 0.5, 0.55);
  expect(current[1]).toEqual({ x: 0.5, y: 0.5 });
});

it('does not edit on a secondary-button click', () => {
  render([{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }]);
  pointer('pointerdown', 0.5, 0.5, { button: 2 });
  pointer('pointerup', 0.5, 0.5, { button: 2 });
  expect(changed).not.toHaveBeenCalled();
});

it('keeps preview and insertion consistent while nodes are selected', () => {
  render([{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }]);
  pointer('pointerdown', 0, 0.5, { ctrlKey: true });
  pointer('pointerup', 0, 0.5, { ctrlKey: true });
  expect(selection).toEqual([0]);
  pointer('pointermove', 0.5, 0.5);
  expect(ghost()).not.toBeNull();
  pointer('pointerdown', 0.5, 0.5);
  pointer('pointerup', 0.5, 0.5);
  expect(current).toHaveLength(3);
  expect(selection).toEqual([]);
});

it('moves a selected group by the grabbed mouse offset without changing its shape', () => {
  render([{ x: 0.2, y: 0.2 }, { x: 0.5, y: 0.5 }, { x: 0.8, y: 0.8 }]);
  for (const n of [0.2, 0.5]) {
    pointer('pointerdown', n, n, { ctrlKey: true });
    pointer('pointerup', n, n, { ctrlKey: true });
  }
  pointer('pointerdown', 0.21, 0.22);
  pointer('pointermove', 0.31, 0.32);
  pointer('pointerup', 0.31, 0.32);
  expect(current[0].x).toBeCloseTo(0.3);
  expect(current[0].y).toBeCloseTo(0.3);
  expect(current[1].x).toBeCloseTo(0.6);
  expect(current[1].y).toBeCloseTo(0.6);
  expect(current[2]).toEqual({ x: 0.8, y: 0.8 });
});

it('draws nodes at the same inset coordinates used by pointer hits and the ghost', () => {
  const ctx = {
    setTransform: vi.fn(), clearRect: vi.fn(), fillRect: vi.fn(), beginPath: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(), fill: vi.fn(), stroke: vi.fn(),
    arc: vi.fn(), setLineDash: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn(),
    createLinearGradient: () => ({ addColorStop: vi.fn() }),
    measureText: () => ({ width: 12 }),
  };
  vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(HEIGHT + PAD * 2);
  render([{ x: 0.2, y: 1 }, { x: 0.8, y: 0 }]);
  for (const [x, y] of [[0.2, 1], [0.8, 0]]) {
    expect(ctx.arc).toHaveBeenCalledWith(PAD + x * WIDTH, PAD + laneValueY(y, HEIGHT), 5, 0, Math.PI * 2);
  }
  pointer('pointermove', 0.5, 0.5);
  const left = parseFloat(ghost()!.style.left);
  const top = parseFloat(ghost()!.style.top);
  pointer('pointerdown', 0.5, 0.5);
  pointer('pointerup', 0.5, 0.5);
  expect(ctx.arc).toHaveBeenCalledWith(left, PAD + top, 5, 0, Math.PI * 2);
});
