// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DeckContext, DeckRegistryContext, useDecks, type DeckContextValue } from '../hooks/useDeck';
import { MixerContext } from '../hooks/useMixer';
import { CHANNEL_IDS, Mixer, type ChannelId } from '../playback/mixer';
import {
  DEFAULT_MOUSE_JOG_SETTINGS, getMouseJogSettings, resetMouseJogSettings,
  setMouseJogSettings, setMouseJogSpeed,
} from '../components/performance/mouseJogSettings';
import SettingsPage from './SettingsPage';
import { _resetControlFocusForTests, focusDeck } from '../performance/controlFocus';

const storage = vi.hoisted(() => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(),
  };
  vi.stubGlobal('localStorage', storage);
  return storage;
});

const probes = vi.hoisted(() => ({ keys: vi.fn(() => null), query: vi.fn(() => { throw new Error('Settings must not query tracks'); }) }));
vi.mock('@tanstack/react-query', () => ({ useQuery: probes.query }));
vi.mock('../contexts/DeckContext', () => ({
  DeckScope: ({ deck, children }: { deck: ChannelId; children: ReactNode }) =>
    <DeckContext value={useDecks()[deck]}>{children}</DeckContext>,
}));
vi.mock('../components/performance/DeckKeys', () => ({
  DeckKeys: probes.keys,
}));
vi.mock('../components/WebGLWaveform', () => ({ default: () => <div>Full waveform</div> }));
vi.mock('../components/WaveformMinimap', () => ({ default: () => <div>Minimap</div> }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;
let mixer: Mixer;
let decks: Record<ChannelId, DeckContextValue>;
let listeners: Record<ChannelId, Set<() => void>>;

beforeEach(() => {
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('AudioContext', class {
    constructor() { throw new Error('Settings must reuse existing audio'); }
  });
  localStorage.clear();
  resetMouseJogSettings();
  _resetControlFocusForTests();
  CHANNEL_IDS.forEach((deck) => setMouseJogSpeed(deck, 0));
  listeners = { A: new Set(), B: new Set(), C: new Set(), D: new Set() };
  decks = Object.fromEntries(CHANNEL_IDS.map((deck, i) => {
    const snapshot = {
      bendPercent: [0.75, -0.5, 2, -3][i], playing: true, loadState: 'ready',
      trackId: i + 1, loop: null, pendingLoopBeats: 4, hasBeatgrid: true,
    };
    return [deck, {
      deck, loadedTrack: { id: i + 1, title: `Track ${deck}` }, loadTrack: vi.fn(),
      engine: {
        getSnapshot: () => snapshot,
        subscribe: (listener: () => void) => {
          listeners[deck].add(listener);
          return () => { listeners[deck].delete(listener); };
        },
        pause: vi.fn(), play: vi.fn(), seek: vi.fn(), togglePlay: vi.fn(),
        toggleLoop: vi.fn(), dispose: vi.fn(),
      },
    }];
  })) as unknown as Record<ChannelId, DeckContextValue>;
  mixer = new Mixer();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  history.replaceState(null, '', '/?view=performance&settings=1&section=mouse-jog');
  vi.clearAllMocks();
});

afterEach(() => {
  act(() => root.unmount());
  expect(probes.keys).not.toHaveBeenCalled();
  expect(probes.query).not.toHaveBeenCalled();
  for (const deck of Object.values(decks)) {
    expect(deck.loadTrack).not.toHaveBeenCalled();
    for (const method of ['pause', 'play', 'seek', 'togglePlay', 'toggleLoop', 'dispose'] as const) {
      expect(deck.engine[method]).not.toHaveBeenCalled();
    }
  }
  container.remove();
  history.replaceState(null, '', '/');
  vi.unstubAllGlobals();
});

async function render(performance = true) {
  await act(async () => root.render(
    <DeckRegistryContext value={decks}>
      <MixerContext value={mixer}><SettingsPage performance={performance} /></MixerContext>
    </DeckRegistryContext>,
  ));
  await act(async () => { await vi.dynamicImportSettled(); });
}

function inputValue(input: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function numberInput(label: string) {
  return container.querySelector<HTMLInputElement>(`[aria-label="${label} value"]`)!;
}

function press(slider: HTMLElement, key: string) {
  act(() => {
    slider.focus();
    slider.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

function readout(label: string) {
  return container.querySelector(`output[aria-label="${label}"]`)?.textContent;
}

it('deep-links to Mouse jog with live ranges, stored values and derived targets', async () => {
  setMouseJogSettings({ sensitivity: 2, acceleration: 1.8, smoothingMs: 50, maxBendPercent: 25 });
  await render();
  expect(container.querySelector('.settings-content')?.getAttribute('aria-label')).toBe('Keyboard + mouse');
  expect(container.querySelector('#settings-section-mouse-jog')).not.toBeNull();
  expect(container.querySelector('.settings-nav [aria-current="page"]')?.textContent).toBe('Keyboard + mouseMouse jog, shortcuts');
  expect(container.querySelectorAll('.settings-nav button')).toHaveLength(6);
  expect(container.textContent).not.toContain('MOUSE / JOG TUNE');
  const ranges = [...container.querySelectorAll<HTMLElement>('.settings-fields [role="slider"]')];
  expect(container.querySelector('input[type="range"]')).toBeNull();
  expect(ranges.map((slider) => ['aria-valuemin', 'aria-valuemax', 'aria-valuenow'].map((attr) => slider.getAttribute(attr)))).toEqual([
    ['0.25', '12', '2'], ['1', '3', '1.8'], ['0', '200', '50'], ['8', '50', '25'],
  ]);
  for (const slider of ranges) {
    expect(slider.classList.contains('perf-fader')).toBe(true);
    expect(slider.querySelector('.perf-fader-handle')?.textContent).toBe(slider.getAttribute('aria-valuenow'));
  }
  expect(ranges[3].getAttribute('aria-label')).toBe('Maximum bend');
  expect(numberInput('Maximum bend').value).toBe('25');
  expect(container.textContent).toContain(`Full bend (+/-25%) at ${(3000 * (25 / 8) ** (1 / 1.8)).toFixed(0)} px/s`);
  press(ranges[0], 'ArrowRight');
  press(ranges[1], 'ArrowRight');
  press(ranges[2], 'ArrowRight');
  press(ranges[3], 'ArrowRight');
  expect(getMouseJogSettings()).toEqual({ sensitivity: 2.25, acceleration: 1.9, smoothingMs: 55, maxBendPercent: 26 });
  press(ranges[0], 'End');
  press(ranges[1], 'End');
  for (let i = 0; i < 5; i++) press(ranges[1], 'ArrowLeft');
  press(ranges[2], 'End');
  press(ranges[3], 'End');
  expect(getMouseJogSettings()).toEqual({ sensitivity: 12, acceleration: 2.5, smoothingMs: 200, maxBendPercent: 50 });
  expect(numberInput('Sensitivity').value).toBe('12');
  expect(container.textContent).toContain(`Full bend (+/-50%) at ${(500 * (50 / 8) ** (1 / 2.5)).toFixed(0)} px/s`);
  expect(container.textContent).toContain(`600 px/s: ${(8 * 1.2 ** 2.5).toFixed(2)}%`);
  act(() => setMouseJogSettings({ sensitivity: 6 }));
  expect(ranges[0].getAttribute('aria-valuenow')).toBe('6');
  ranges.forEach((slider) => press(slider, 'Home'));
  expect(getMouseJogSettings()).toEqual({ sensitivity: 0.25, acceleration: 1, smoothingMs: 0, maxBendPercent: 8 });
  expect(container.textContent).toContain('Full bend (+/-8%) at 24000 px/s');
});

it('drags the shared sensitivity fader and resets it to the mouse default', async () => {
  await render();
  const slider = container.querySelector<HTMLElement>('[role="slider"][aria-label="Sensitivity"]')!;
  slider.setPointerCapture = vi.fn();
  slider.releasePointerCapture = vi.fn();
  vi.spyOn(slider, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 470 } as DOMRect);
  act(() => slider.dispatchEvent(new MouseEvent('pointerdown', { clientX: 0, bubbles: true })));
  expect(getMouseJogSettings().sensitivity).toBe(0.25);
  expect(document.activeElement).toBe(slider);
  act(() => slider.dispatchEvent(new MouseEvent('pointermove', { clientX: 230, bubbles: true })));
  expect(getMouseJogSettings().sensitivity).toBe(6);
  act(() => slider.dispatchEvent(new MouseEvent('pointerup', { bubbles: true })));
  expect(document.activeElement).not.toBe(slider);
  act(() => slider.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  expect(getMouseJogSettings().sensitivity).toBe(DEFAULT_MOUSE_JOG_SETTINGS.sensitivity);
});

it.each([
  ['Sensitivity', 'sensitivity', 8, 10, 6, 9],
  ['Acceleration', 'acceleration', 2, 2.5, 1.5, 3],
  ['Smoothing', 'smoothingMs', 100, 150, 75, 200],
  ['Maximum bend', 'maxBendPercent', 40, 50, 8, 45],
] as const)('%s commits on Enter/blur, cancels on Escape and discards drafts on every reset', async (label, setting, entered, escaped, blurred, draft) => {
  await render();
  const type = (value: string) => {
    const input = numberInput(label);
    act(() => input.focus());
    inputValue(input, value);
    return input;
  };
  const press = (input: HTMLInputElement, key: string) => act(() =>
    input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })),
  );
  let input = type(String(entered));
  expect(getMouseJogSettings()).toEqual(DEFAULT_MOUSE_JOG_SETTINGS);
  press(input, 'Enter');
  expect(getMouseJogSettings()[setting]).toBe(entered);
  input = type(String(escaped));
  press(input, 'Escape');
  expect(input.value).toBe(String(entered));
  expect(getMouseJogSettings()[setting]).toBe(entered);
  input = type(String(blurred));
  act(() => input.blur());
  expect(getMouseJogSettings()[setting]).toBe(blurred);
  const reset = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Reset mouse defaults')!;
  for (let i = 0; i < 2; i++) {
    type(String(draft));
    act(() => reset.click());
    input = numberInput(label);
    expect(input.value).toBe(String(DEFAULT_MOUSE_JOG_SETTINGS[setting]));
    act(() => { input.focus(); input.blur(); });
    expect(getMouseJogSettings()).toEqual(DEFAULT_MOUSE_JOG_SETTINGS);
  }
});

it('clamps maximum bend numeric entry and updates the fader and full-bend speed on cap-only changes', async () => {
  await render();
  const slider = container.querySelector<HTMLElement>('[role="slider"][aria-label="Maximum bend"]')!;
  const input = numberInput('Maximum bend');
  expect(input.min).toBe('8');
  expect(input.max).toBe('50');
  expect(input.step).toBe('1');
  for (const [value, expected] of [['100', 50], ['-1', 8], ['42', 42]] as const) {
    act(() => input.focus());
    inputValue(input, value);
    act(() => input.blur());
    expect(getMouseJogSettings()).toEqual({ ...DEFAULT_MOUSE_JOG_SETTINGS, maxBendPercent: expected });
    expect(slider.getAttribute('aria-valuenow')).toBe(String(expected));
    expect(input.value).toBe(String(expected));
    expect(container.textContent).toContain(`Full bend (+/-${expected}%) at ${(3000 * (expected / 8) ** (1 / 1.8)).toFixed(0)} px/s`);
    expect(container.textContent).toContain('600 px/s: 0.44%');
  }
  act(() => slider.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  expect(getMouseJogSettings().maxBendPercent).toBe(25);
  expect(input.value).toBe('25');
  expect(slider.getAttribute('aria-valuenow')).toBe('25');
});

it('shows read-only telemetry for both control-focus decks without preview controls or bindings', async () => {
  await render();
  expect(container.querySelectorAll('[aria-label$="mouse jog"]')).toHaveLength(2);
  expect(container.querySelector('select, input[type="search"], canvas')).toBeNull();
  expect(readout('Deck A actual bend')).toBe('+0.75%');
  expect(readout('Deck B actual bend')).toBe('-0.50%');
  expect(container.textContent).toContain('Hold T for Deck A rim');
  act(() => {
    setMouseJogSpeed('A', 321);
    decks.A.engine.getSnapshot().bendPercent = 1.23;
    for (const listener of listeners.A) listener();
  });
  expect(readout('Deck A mouse speed')).toBe('321 px/s');
  expect(readout('Deck A actual bend')).toBe('+1.23%');
  act(() => { focusDeck('C'); focusDeck('D'); });
  expect(container.textContent).toContain('Hold T for Deck C rim');
  expect(container.textContent).toContain('Hold Y for Deck D rim');
  expect(readout('Deck A actual bend')).toBeUndefined();
  expect(readout('Deck B actual bend')).toBeUndefined();
  expect(readout('Deck C actual bend')).toBe('+2.00%');
  expect(readout('Deck D actual bend')).toBe('-3.00%');
  expect(listeners.A.size).toBe(0);
  expect(listeners.B.size).toBe(0);
  act(() => root.render(null));
  expect(listeners.C.size).toBe(0);
  expect(listeners.D.size).toBe(0);
});

it('keeps preferences editable during automation without taking over deck controls', async () => {
  mixer.engageAutomation();
  await render();
  expect(container.textContent).not.toContain('Pause');
  const range = container.querySelector<HTMLElement>('[role="slider"][aria-label="Sensitivity"]')!;
  expect(range.getAttribute('aria-disabled')).not.toBe('true');
  press(range, 'ArrowRight');
  expect(getMouseJogSettings().sensitivity).toBe(2.25);
});

it('shows a Performance hint outside Performance without subscribing to decks', async () => {
  await render(false);
  expect(container.textContent).toContain('Switch to Performance to test T/Y');
  expect(container.querySelector('[aria-label$="actual bend"]')).toBeNull();
  expect(Object.values(listeners).every((set) => set.size === 0)).toBe(true);
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyT', key: 't', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyY', key: 'y', bubbles: true }));
  });
});

it('navigates lazy sections with canonical URLs without changing decks', async () => {
  history.replaceState(null, '', '/?view=performance&settings=1');
  await render();
  const buttons = [...container.querySelectorAll<HTMLButtonElement>('.settings-nav button')];
  expect(container.querySelector('[aria-label$="actual bend"]')).toBeNull();
  await act(async () => buttons.find((b) => b.textContent?.startsWith('Keyboard + mouse'))!.click());
  expect(location.search).toBe('?view=performance&settings=1&section=keyboard-mouse');
  expect(readout('Deck A actual bend')).toBe('+0.75%');
  await act(async () => buttons.find((b) => b.textContent?.startsWith('Performance'))!.click());
  expect(location.search).toBe('?view=performance&settings=1&section=performance');
  expect(container.querySelector('[aria-label$="actual bend"]')).toBeNull();
  expect(Object.values(listeners).every((set) => set.size === 0)).toBe(true);
});
