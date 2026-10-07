// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MixerStrip } from './MixerStrip';
import { MixerContext } from '../../hooks/useMixer';
import type { Mixer } from '../../playback/mixer';

vi.mock('../../settings/persistedSettings', () => ({ writeSetting: vi.fn(), removeSetting: vi.fn() }));
vi.mock('../../links/PerformancePairLinks', () => ({ DiagonalPairLinks: () => null }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;

const section = { selected: 'echo' as const, target: 'A' as const, on: false, depth: 0, beats: 0.5 };
const toggleBeatFxOn = vi.fn();
const selectBeatFx = vi.fn();
const setBeatFxDepth = vi.fn();
const stepBeatFxBeats = vi.fn();
const selectBeatFxTarget = vi.fn();
const setCrossfaderAssignment = vi.fn();

const mixer = {
  subscribe: () => () => {},
  getCrossfader: () => 0,
  getCrossfaderEnabled: () => true,
  getCrossfaderAssignment: () => 'thru',
  getCueMix: () => 0,
  getBeatFxSection: () => section,
  setCrossfader: vi.fn(),
  setCrossfaderEnabled: vi.fn(),
  setCrossfaderAssignment,
  setCueMix: vi.fn(),
  toggleBeatFxOn,
  selectBeatFx,
  selectBeatFxTarget,
  setBeatFxDepth,
  stepBeatFxBeats,
} as unknown as Mixer;

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(
    <MixerContext.Provider value={mixer}>
      <MixerStrip deckCount={4} />
    </MixerContext.Provider>
  ));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

it('renders one GRV6-shaped section and the five useful targets', () => {
  const row = container.querySelector('.perf-fx-row')!;
  expect(row.parentElement?.className).toBe('perf-strip-right');
  expect(row.nextElementSibling?.className).toBe('perf-strip-slot');
  expect(row.querySelectorAll('.perf-knob')).toHaveLength(1);
  expect(row.querySelector('[aria-label="Beat FX on/off"]')).not.toBeNull();
  expect(row.querySelector('[aria-label="Beat FX effect"]')).not.toBeNull();
  expect(row.querySelector('[aria-label="Echo beats"]')!.textContent).toBe('1/2');
  expect(row.querySelectorAll('.perf-fx-ch')).toHaveLength(5);
  expect(row.querySelector('[aria-label="Beat FX target A"]')!.className).toContain(' on');
  expect(row.querySelector('[aria-label="Beat FX target B"]')!.className).not.toContain(' on');
  expect(row.querySelector('[aria-label="Beat FX target SP"]')).toBeNull();
  expect(row.querySelector('[aria-label="Beat FX target MST"]')).not.toBeNull();
});

it('assigns A/C only left and B/D only right from compact toggles', () => {
  expect(
    [...container.querySelectorAll<HTMLElement>('[aria-label$="crossfader assignment"]')]
      .map((button) => button.textContent)
  ).toEqual(['C', 'A', 'B', 'D']);
  for (const [deck, side] of [['A', 'left'], ['C', 'left'], ['B', 'right'], ['D', 'right']] as const) {
    act(() => (container.querySelector(`[aria-label="Deck ${deck} crossfader assignment"]`) as HTMLElement).click());
    expect(setCrossfaderAssignment).toHaveBeenLastCalledWith(deck, side);
  }
});

it('routes ON/OFF, SELECT, and channel assignment to distinct Mixer controls', () => {
  act(() => (container.querySelector('[aria-label="Beat FX on/off"]') as HTMLElement).click());
  const selector = container.querySelector<HTMLSelectElement>('[aria-label="Beat FX effect"]')!;
  act(() => {
    selector.value = 'reverb';
    selector.dispatchEvent(new Event('change', { bubbles: true }));
  });
  act(() => (container.querySelector('[aria-label="Beat FX target C"]') as HTMLElement).click());
  expect(toggleBeatFxOn).toHaveBeenCalledOnce();
  expect(selectBeatFx).toHaveBeenCalledWith('reverb');
  expect(selectBeatFxTarget).toHaveBeenCalledWith('C');
});

it('routes MST to the master target', () => {
  act(() => (container.querySelector('[aria-label="Beat FX target MST"]') as HTMLElement).click());
  expect(selectBeatFxTarget).toHaveBeenCalledWith('master');
});

it('offers --- and dispatches null for unsupported effects', () => {
  const selector = container.querySelector<HTMLSelectElement>('[aria-label="Beat FX effect"]')!;
  expect([...selector.options].map((option) => option.textContent)).toEqual(['---', 'ECH', 'RVB', 'FLG']);
  act(() => {
    selector.value = '';
    selector.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(selectBeatFx).toHaveBeenCalledWith(null);
});

it('uses one bipolar DEPTH knob centered at 0', () => {
  const dial = container.querySelector<HTMLElement>('.perf-fx-row .perf-knob-dial')!;
  act(() => dial.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true })));
  expect(setBeatFxDepth).toHaveBeenCalledWith(0.2);
});

it('steps the global echo ladder: click doubles, shift-click halves', () => {
  const beats = container.querySelector<HTMLElement>('[aria-label="Echo beats"]')!;
  act(() => beats.click());
  act(() => beats.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })));
  expect(stepBeatFxBeats).toHaveBeenNthCalledWith(1, 'double');
  expect(stepBeatFxBeats).toHaveBeenNthCalledWith(2, 'halve');
});
