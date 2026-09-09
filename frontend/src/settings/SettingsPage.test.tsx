// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { MixerContext } from '../hooks/useMixer';
import { Mixer } from '../playback/mixer';
import SettingsPage from './SettingsPage';

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
// The shared audio/GL preview is verified in browser, not replaced by a fake audio graph here.
vi.mock('./SettingsDeckPreview', () => ({
  SettingsDeckPreview: () => <div>Live deck preview</div>,
}));

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
  vi.stubGlobal(
    'AudioContext',
    class {
      constructor() {
        throw new Error('Settings must not construct audio');
      }
    },
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true })),
  );
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
  expect(host.querySelectorAll('.settings-nav button')).toHaveLength(3);
});
