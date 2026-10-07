// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { KeepAliveView } from '../../contexts/KeepAliveView';
import { BeatFxKeys } from './BeatFxKeys';

const section = vi.hoisted(() => ({ selected: 'echo', target: 'A', on: true, depth: 0, beats: 0.5 }));
const mixer = vi.hoisted(() => ({
  getBeatFxSection: () => section,
  setBeatFxDepth: vi.fn((value: number) => { section.depth = value; }),
}));
vi.mock('../../hooks/useMixer', () => ({ useMixer: () => mixer }));

let root: ReturnType<typeof createRoot>;
let mouseX = 0;
const key = (value: string, type = 'keydown', options: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent(type, { key: value, bubbles: true, cancelable: true, ...options });
  act(() => { document.dispatchEvent(event); });
  return event;
};
const move = (x: number) => act(() => {
  const event = new MouseEvent('mousemove', { clientX: x, clientY: 100, bubbles: true });
  Object.defineProperties(event, { movementX: { value: x - mouseX }, movementY: { value: 0 } });
  mouseX = x;
  document.dispatchEvent(event);
});

beforeEach(() => {
  section.depth = 0;
  mixer.setBeatFxDepth.mockClear();
  mouseX = 0;
  Object.defineProperty(document, 'pointerLockElement', { configurable: true, value: null });
  Object.defineProperty(HTMLElement.prototype, 'requestPointerLock', { configurable: true, value: vi.fn(function (this: HTMLElement) {
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, value: this });
    document.dispatchEvent(new Event('pointerlockchange'));
  }) });
  document.exitPointerLock = vi.fn(() => {
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, value: null });
    document.dispatchEvent(new Event('pointerlockchange'));
  });
  root = createRoot(document.createElement('div'));
});
afterEach(() => act(() => root.unmount()));

const render = (enabled = true) => act(() => root.render(
  <KeepAliveView active><BeatFxKeys enabled={enabled} /></KeepAliveView>
));

it('drives LEVEL/DEPTH while 0 is held, with keyboard-pointer feedback', () => {
  render(); move(100);
  expect(key('0').defaultPrevented).toBe(true);
  move(190); // +90 px of a 360 px sweep, bipolar → +0.5
  expect(section.depth).toBeCloseTo(0.5, 9);
  expect(document.querySelector('.keyboard-pointer-row')!.textContent).toContain('FX DEPTH');
  key('0', 'keyup');
  mixer.setBeatFxDepth.mockClear();
  move(250);
  expect(mixer.setBeatFxDepth).not.toHaveBeenCalled();
});

it('double-tap resets to fully dry', () => {
  section.depth = 0.7;
  render();
  key('0'); key('0', 'keyup');
  key('0'); key('0', 'keyup');
  expect(mixer.setBeatFxDepth).toHaveBeenLastCalledWith(-1);
});

it('ignores 0 while disabled (library focus) or with modifiers', () => {
  render(false); move(100);
  expect(key('0').defaultPrevented).toBe(false);
  render(true);
  expect(key('0', 'keydown', { metaKey: true }).defaultPrevented).toBe(false);
});
