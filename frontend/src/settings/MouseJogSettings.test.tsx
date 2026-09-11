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

function readout(label: string) {
  return container.querySelector(`output[aria-label="${label}"]`)?.textContent;
}

it('deep-links to Mouse jog with live ranges, stored values and derived targets', async () => {
  setMouseJogSettings({ sensitivity: 2, acceleration: 1.8, smoothingMs: 50 });
  await render();
  expect(container.querySelector('.settings-content')?.getAttribute('aria-label')).toBe('Mouse jog');
  expect(container.querySelector('.settings-nav [aria-current="page"]')?.textContent).toBe('Mouse jogKeyboard and mouse response');
  expect(container.querySelectorAll('.settings-nav button')).toHaveLength(4);
  expect(container.textContent).not.toContain('MOUSE / JOG TUNE');
  const ranges = [...container.querySelectorAll<HTMLInputElement>('.settings-fields input[type="range"]')];
  expect(ranges.map((input) => [input.min, input.max, input.step, input.value])).toEqual([
    ['0.25', '12', '0.25', '2'], ['1', '3', '0.1', '1.8'], ['0', '200', '5', '50'],
  ]);
  expect(container.textContent).toContain('3000 px/s');
  for (const [i, value] of ['12', '2.5', '200'].entries()) inputValue(ranges[i], value);
  expect(getMouseJogSettings()).toEqual({ sensitivity: 12, acceleration: 2.5, smoothingMs: 200 });
  expect(numberInput('Sensitivity').value).toBe('12');
  expect(container.textContent).toContain('500 px/s');
  expect(container.textContent).toContain('600 px/s: 8.00%');
  act(() => setMouseJogSettings({ sensitivity: 6 }));
  expect(ranges[0].value).toBe('6');
});

it('commits numbers on Enter/blur, cancels on Escape and discards drafts on every reset', async () => {
  await render();
  const type = (value: string) => {
    const input = numberInput('Sensitivity');
    act(() => input.focus());
    inputValue(input, value);
    return input;
  };
  const press = (input: HTMLInputElement, key: string) => act(() =>
    input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })),
  );
  let input = type('8');
  expect(getMouseJogSettings()).toEqual(DEFAULT_MOUSE_JOG_SETTINGS);
  press(input, 'Enter');
  expect(getMouseJogSettings().sensitivity).toBe(8);
  input = type('10');
  press(input, 'Escape');
  expect(input.value).toBe('8');
  expect(getMouseJogSettings().sensitivity).toBe(8);
  input = type('6');
  act(() => input.blur());
  expect(getMouseJogSettings().sensitivity).toBe(6);
  const reset = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Reset mouse defaults')!;
  for (let i = 0; i < 2; i++) {
    type('9');
    act(() => reset.click());
    input = numberInput('Sensitivity');
    expect(input.value).toBe(String(DEFAULT_MOUSE_JOG_SETTINGS.sensitivity));
    act(() => { input.focus(); input.blur(); });
    expect(getMouseJogSettings()).toEqual(DEFAULT_MOUSE_JOG_SETTINGS);
  }
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
  const range = container.querySelector<HTMLInputElement>('#mouse-jog-sensitivity')!;
  expect(range.disabled).toBe(false);
  inputValue(range, '5');
  expect(getMouseJogSettings().sensitivity).toBe(5);
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
  await act(async () => buttons.find((b) => b.textContent?.startsWith('Mouse jog'))!.click());
  expect(location.search).toBe('?view=performance&settings=1&section=mouse-jog');
  expect(readout('Deck A actual bend')).toBe('+0.75%');
  await act(async () => buttons.find((b) => b.textContent?.startsWith('Filters'))!.click());
  expect(location.search).toBe('?view=performance&settings=1&section=filters');
  expect(container.querySelector('[aria-label$="actual bend"]')).toBeNull();
  expect(Object.values(listeners).every((set) => set.size === 0)).toBe(true);
});
