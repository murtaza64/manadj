// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MixerContext } from '../hooks/useMixer';
import { Mixer } from '../playback/mixer';
import SettingsPage from './SettingsPage';
import { describeSweepFilter } from '../playback/sweepFilter';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
vi.hoisted(() => {
  const values = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
    clear: () => values.clear(),
    key: (i: number) => [...values.keys()][i] ?? null,
    get length() {
      return values.size;
    },
  };
});
beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('AudioContext', class {
    constructor() { throw new Error('Settings must not construct audio'); }
  });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true })));
});

let root: Root | undefined;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = undefined;
  document.body.innerHTML = '';
  localStorage.clear();
  vi.unstubAllGlobals();
  history.replaceState(null, '', '/');
});

it('edits typed values only on commit, supports cancel/reset and does not create audio', async () => {
  const mixer = new Mixer();
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <MixerContext.Provider value={mixer}>
        <SettingsPage />
      </MixerContext.Provider>,
    ),
  );
  expect(mixer.getFilterSettings()).toMatchObject({
    model: 'res24',
    resonance: 17,
    compensation: 0.15,
  });
  let input = host.querySelector<HTMLInputElement>(
    '[aria-label="High-pass endpoint value"]',
  )!;
  const type = (text: string) =>
    act(() => {
      input.focus();
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!.call(input, text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  type('8');
  expect(mixer.getFilterSettings().hpMax).toBe(16000);
  type('8000');
  act(() =>
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    ),
  );
  expect(mixer.getFilterSettings().hpMax).toBe(8000);
  type('20000');
  act(() =>
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    ),
  );
  expect(mixer.getFilterSettings().hpMax).toBe(8000);
  const reset = [...host.querySelectorAll('button')].find(
    (b) => b.textContent === 'Reset filter defaults',
  )!;
  type('9000');
  act(() => reset.click());
  expect(mixer.getFilterSettings().hpMax).toBe(16000);
  input = host.querySelector<HTMLInputElement>('[aria-label="High-pass endpoint value"]')!;
  expect(input.value).toBe('16000');
  type('7000'); // reset must discard a draft even if persisted values are already defaults
  act(() => reset.click());
  input = host.querySelector<HTMLInputElement>('[aria-label="High-pass endpoint value"]')!;
  expect(input.value).toBe('16000');
  act(() => { input.focus(); input.blur(); });
  expect(mixer.getFilterSettings().hpMax).toBe(16000);
  expect(host.querySelectorAll('.settings-nav button')).toHaveLength(4);
  expect(host.querySelector('[aria-label="Filter frequency response"] polyline')?.getAttribute('points')?.split(' ')).toHaveLength(180);
  expect(host.querySelector('input[type="search"], canvas')).toBeNull();
  expect(host.textContent).toContain('Target response at 48 kHz');
});

it('selects filter diagnostics without loading decks and follows automation with live write guards', async () => {
  const mixer = new Mixer();
  const setFilter = vi.spyOn(mixer, 'setFilter').mockImplementation(() => {});
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<MixerContext value={mixer}><SettingsPage /></MixerContext>));
  const select = host.querySelector<HTMLSelectElement>('[aria-label="Filter response deck"]')!;
  act(() => {
    select.value = 'C';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(setFilter).not.toHaveBeenCalled();
  const sweep = host.querySelector<HTMLInputElement>('#settings-sweep')!;
  const change = (value: string) => act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(sweep, value);
    sweep.dispatchEvent(new Event('input', { bubbles: true }));
  });
  change('-0.4');
  expect(setFilter).toHaveBeenLastCalledWith('C', -0.4);
  const center = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Center')!;
  act(() => center.click());
  expect(setFilter).toHaveBeenLastCalledWith('C', 0);
  setFilter.mockClear();
  // Automation can engage between render and the next pointer event.
  mixer.engageAutomation();
  change('0.3');
  act(() => center.click());
  expect(setFilter).not.toHaveBeenCalled();
  mixer.setAutomation('C', { filter: 0.6, fader: 1, eq: { low: 0.5, mid: 0.5, high: 0.5 } });
  const frame = vi.mocked(requestAnimationFrame).mock.calls.at(-1)![0];
  act(() => frame(0));
  expect(sweep.value).toBe('0.6');
  expect(sweep.disabled).toBe(true);
  expect(center.disabled).toBe(true);
  const target = describeSweepFilter(mixer.getFilterSettings(), 0.6, 48000);
  expect(host.querySelector('.settings-filter-sweep output')?.textContent).toBe(`HP ${Math.round(target.frequency)} Hz`);
  expect(host.querySelector<HTMLInputElement>('[aria-label="Resonance value"]')!.disabled).toBe(false);
  act(() => root!.render(null));
  expect(mixer.isAutomationEngaged()).toBe(true);
  expect(mixer.getAutomation('C')?.filter).toBe(0.6);
  expect(setFilter).not.toHaveBeenCalled();
});

it('shows waveform style controls without a player, track queries or deck provider', async () => {
  history.replaceState(null, '', '/?view=performance&settings=1&section=waveforms');
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<SettingsPage />));
  await act(async () => { await vi.dynamicImportSettled(); });
  expect(host.querySelector('.settings-content')?.getAttribute('aria-label')).toBe('Waveforms');
  expect(host.querySelector('[aria-label="Waveform color style"]')).not.toBeNull();
  expect(host.textContent).toContain('The waveforms above are the live preview');
  expect(host.querySelector('canvas, input[type="search"]')).toBeNull();
  expect(host.textContent).not.toContain('Load on');
});
