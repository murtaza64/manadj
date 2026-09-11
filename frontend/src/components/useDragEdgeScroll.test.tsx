// @vitest-environment jsdom
import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TRACKS_MIME } from '../selection/trackDrag';
import { useDragEdgeScroll } from './useDragEdgeScroll';

let root: Root;
let host: HTMLDivElement;
let pane: HTMLDivElement;
let now: number;
let frames: Map<number, FrameRequestCallback>;
const onScroll = vi.fn();
const onEnd = vi.fn();

function Harness() {
  const ref = useRef<HTMLDivElement>(null);
  const scrolling = useDragEdgeScroll(ref, onScroll, onEnd);
  return <div ref={ref} data-scrolling={scrolling} />;
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  now = 1000;
  frames = new Map();
  let id = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { frames.set(++id, fn); return id; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  onScroll.mockClear();
  onEnd.mockClear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(<Harness />));
  pane = host.firstElementChild as HTMLDivElement;
  let scrollTop = 1000;
  Object.defineProperties(pane, {
    scrollTop: { get: () => scrollTop, set: (value: number) => { scrollTop = Math.round(Math.max(0, Math.min(3600, value))); } },
    clientHeight: { value: 400 }, scrollHeight: { value: 4000 },
  });
  vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue({ left: 100, right: 700, top: 100, bottom: 500 } as DOMRect);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function drag(target: EventTarget, type: string, y = 460, x = 400) {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
  Object.defineProperty(event, 'dataTransfer', { value: { types: [TRACKS_MIME] } });
  act(() => { target.dispatchEvent(event); });
}

function frame(ms = 1000 / 240) {
  act(() => {
    now += ms;
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((fn) => fn(now));
  });
}

it.each([140, 460])('retains fractional scrolling at 240 Hz in either direction (y=%s)', (y) => {
  drag(pane, 'dragstart', y);
  drag(pane, 'dragover', y);
  for (let i = 0; i < 240; i++) frame();
  expect(Math.abs(pane.scrollTop - 1000)).toBeCloseTo(37, 0);
  expect(onScroll).toHaveBeenCalled();
  expect(onEnd).not.toHaveBeenCalled(); // stationary internal drags do not time out
});

it('tracks overshoot outside the pane but stops scrolling outside its horizontal bounds', () => {
  drag(pane, 'dragstart');
  drag(pane, 'dragover');
  drag(window, 'dragover', 80);
  frame(16);
  expect(pane.scrollTop).toBeLessThan(1000);
  expect(onScroll).toHaveBeenLastCalledWith(100);
  const stopped = pane.scrollTop;
  drag(window, 'dragover', 80, 50);
  frame(16);
  expect(pane.scrollTop).toBe(stopped);
  expect(pane.dataset.scrolling).toBe('false');
});

it.each(['drop', 'dragend', 'blur'])('stops immediately on %s', (event) => {
  drag(pane, 'dragstart');
  drag(pane, 'dragover');
  frame(16);
  act(() => { window.dispatchEvent(new Event(event)); });
  const stopped = pane.scrollTop;
  frame(100);
  expect(pane.scrollTop).toBe(stopped);
  expect(frames.size).toBe(0);
  expect(onEnd).toHaveBeenCalledTimes(1);
});

it('times out an external drag with no end event', () => {
  drag(pane, 'dragover');
  frame(701);
  expect(frames.size).toBe(0);
  expect(onEnd).toHaveBeenCalledTimes(1);
});

it('cancels the frame loop on unmount', () => {
  drag(pane, 'dragstart');
  drag(pane, 'dragover');
  act(() => root.render(null));
  expect(frames.size).toBe(0);
});
