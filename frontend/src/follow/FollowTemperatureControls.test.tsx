// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FollowTemperatureControls, nextDiceLanding } from './FollowTemperatureControls';
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

it('rerolls immediately on click and replays the dice tumble each time', async () => {
  const { getFollowSeed } = await import('./paramsStore');
  setFollowParams({ temperature: 0.5 });
  act(() => root.render(<FollowTemperatureControls active />));
  const button = host.querySelector<HTMLButtonElement>('button[aria-label="Reroll Compatible"]')!;
  expect(button.querySelector('svg')?.getAttribute('data-rolling')).toBe('false');
  const seed = getFollowSeed();
  act(() => button.click());
  expect(getFollowSeed()).toBe((seed + 1) >>> 0);
  const first = button.querySelector('svg')!;
  expect(first.getAttribute('data-rolling')).toBe('true');
  act(() => button.click());
  expect(button.querySelector('svg')).not.toBe(first);
  expect(button.textContent).toBe('');
});


it('varies resting tilt even when the random samples repeat, within contained pockets', () => {
  let previous: ReturnType<typeof nextDiceLanding> = [];
  for (let i = 0; i < 100; i++) {
    const next = nextDiceLanding(previous, () => .5);
    next.forEach((die, index) => {
      expect(die.face).toBeGreaterThanOrEqual(1); expect(die.face).toBeLessThanOrEqual(6);
      expect(die.x).toBeGreaterThanOrEqual(index === 0 ? 9 : 25);
      expect(die.x).toBeLessThanOrEqual(index === 0 ? 11 : 27);
      expect(die.y).toBeGreaterThanOrEqual(8.5); expect(die.y).toBeLessThanOrEqual(9.5);
      expect(Math.abs(die.tilt)).toBeLessThanOrEqual(22);
      if (previous[index]) expect(die.tilt).not.toBe(previous[index].tilt);
    });
    previous = next;
  }
});

it('keeps all dice corners within the stage, including extreme landing/rotation samples', () => {
  for (const sample of [0, .001, .25, .5, .75, .999999]) {
    const dice = nextDiceLanding([], () => sample);
    dice.forEach(die => {
      // Circumscribed radius includes stroke. Animation only rotates/scales down.
      const radius = Math.SQRT2 * 5.65;
      expect(die.x - radius).toBeGreaterThanOrEqual(0);
      expect(die.x + radius).toBeLessThanOrEqual(36);
      expect(die.y - radius).toBeGreaterThanOrEqual(0);
      expect(die.y + radius).toBeLessThanOrEqual(18);
    });
  }
});

it('keeps reroll disabled at zero temperature or inactive ranking', () => {
  act(() => root.render(<FollowTemperatureControls active />));
  expect(host.querySelector<HTMLButtonElement>('.follow-reroll')!.disabled).toBe(true);
  act(() => setFollowParams({ temperature: .5 }));
  act(() => root.render(<FollowTemperatureControls active={false} />));
  expect(host.querySelector<HTMLButtonElement>('.follow-reroll')!.disabled).toBe(true);
});
