// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FollowTemperatureControls } from './FollowTemperatureControls';
import { getFollowTemperature, resetFollowParams, setFollowParams, useFollowParams } from './paramsStore';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  resetFollowParams();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllTimers();
  vi.useRealTimers();
});

it('moves the handle without rerendering ranking subscribers until the debounce settles', () => {
  let renders = 0;
  function Ranking() {
    const params = useFollowParams();
    renders++;
    return <output data-ranking>{params.temperature}</output>;
  }
  act(() => root.render(<><Ranking /><FollowTemperatureControls active /></>));
  const slider = host.querySelector('[role="slider"]')!;
  act(() => slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
  expect(slider.getAttribute('aria-valuenow')).toBe('0.05');
  expect(renders).toBe(1);
  act(() => vi.advanceTimersByTime(149));
  expect(renders).toBe(1);
  act(() => vi.advanceTimersByTime(1));
  expect(renders).toBe(2);
  expect(host.querySelector('[data-ranking]')?.textContent).toBe('0.05');
  expect(host.querySelector('[role="slider"]')).toBe(slider);
});

it('cancels native wheel scrolling while HFader still adjusts, including at the limits', () => {
  setFollowParams({ temperature: 0.5 });
  act(() => root.render(<FollowTemperatureControls active />));
  const fader = host.querySelector('.perf-fader')!;
  const wheel = new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true });
  act(() => fader.dispatchEvent(wheel));
  expect(wheel.defaultPrevented).toBe(true);
  expect(getFollowTemperature()).toBe(0.4);
  act(() => setFollowParams({ temperature: 1 }));
  const limitWheel = new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true });
  act(() => fader.dispatchEvent(limitWheel));
  expect(limitWheel.defaultPrevented).toBe(true);
  expect(getFollowTemperature()).toBe(1);
  act(() => root.render(<FollowTemperatureControls active={false} />));
  act(() => fader.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true })));
  expect(getFollowTemperature()).toBe(1);
});
