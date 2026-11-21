// @vitest-environment jsdom
/**
 * Heard calibration popover (#510): the mixer's HEARD chip opens a small
 * non-modal popover; nudges write per-route overrides, reset returns to
 * the device report, and nothing about it captures the keyboard or the
 * mix (outside click / Escape close, deck keys propagate).
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Mixer } from '../../playback/mixer';
import { DEFAULT_BEAT_FX_SETTINGS } from '../../playback/beatFxSettings';

vi.mock('../../settings/persistedSettings', () => ({ writeSetting: vi.fn(), removeSetting: vi.fn() }));
vi.mock('../../links/PerformancePairLinks', () => ({ DiagonalPairLinks: () => null }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const MODE_KEY = 'manadj-heard';
const BT = { key: 'bt-1', label: 'Big Speaker', reportedSeconds: 0.212 };

function fakeStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() { return map.size; },
  } as Storage;
}

// Stable identities: MixerStrip reads these through useSyncExternalStore.
const section = { selected: 'echo' as const, target: 'A' as const, on: false, depth: 0, beats: 0.5 };
const mixer = {
  subscribe: () => () => {},
  getCrossfader: () => 0,
  getCrossfaderEnabled: () => true,
  getCrossfaderAssignment: () => 'thru',
  getCueMix: () => 0,
  getBeatFxSection: () => section,
  getBeatFxSettings: () => DEFAULT_BEAT_FX_SETTINGS,
} as unknown as Mixer;

let container: HTMLDivElement;
let root: Root;

/** Fresh heardStore + MixerStrip per test (the store is a module singleton).
 *  Everything MixerStrip touches must come from the same fresh registry. */
async function load(stored: Record<string, string> = { [MODE_KEY]: 'true' }) {
  vi.resetModules();
  vi.stubGlobal('localStorage', fakeStorage(stored));
  const store = await import('../../playback/heardStore');
  store.registerHeardRouteProvider(() => BT);
  const { MixerStrip } = await import('./MixerStrip');
  const { MixerContext } = await import('../../hooks/useMixer');
  (await import('../keyboardHelpStore'))._resetKeyboardHelpForTests();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(
    <MixerContext.Provider value={mixer}>
      <MixerStrip deckCount={4} onToggleHints={() => undefined} />
    </MixerContext.Provider>,
  ));
  return store;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function button(text: string) {
  const found = [...document.querySelectorAll('button')].filter((b) => b.textContent === text);
  expect(found.length, text).toBeGreaterThan(0);
  return found.at(-1)!;
}
async function click(text: string) { await act(async () => { button(text).click(); }); }
async function clickLabel(label: string) {
  await act(async () => { document.querySelector(`[aria-label="${label}"]`)!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
}
const popover = () => document.querySelector('.perf-heardpop');

it('shows the route latency as a chip only while Heard is on', async () => {
  await load({ [MODE_KEY]: 'false' });
  expect(document.querySelector('.perf-heard-chip')).toBeNull();
  await clickLabel('Heard');
  expect(document.querySelector('.perf-heard-chip')?.textContent).toBe('212ms');
  expect(popover()).toBeNull();
});

it('opens the popover from the chip without stealing focus from the mix', async () => {
  await load();
  expect(popover()).toBeNull();
  await click('212ms');
  expect(popover()).not.toBeNull();
  expect(popover()!.textContent).toContain('Big Speaker');
  expect(popover()!.textContent).toContain('device-reported');
  expect(document.activeElement?.closest('.perf-heardpop')).toBeNull();
  // Deck keys still propagate: a capture listener sees Space, popover stays.
  const seen = vi.fn();
  document.addEventListener('keydown', seen, true);
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
  });
  expect(seen).toHaveBeenCalledTimes(1);
  expect(popover()).not.toBeNull();
  document.removeEventListener('keydown', seen, true);
});

it('nudges in 5 ms steps into a per-route override and resets to the report', async () => {
  const store = await load();
  await click('212ms');
  await clickLabel('More output latency');
  expect(popover()!.textContent).toContain('217ms');
  expect(popover()!.textContent).toContain('reported 212ms');
  expect(document.querySelector('.perf-heard-chip')?.textContent).toBe('217ms');
  expect(store.heardRoute().overridden).toBe(true);
  await clickLabel('Less output latency');
  await clickLabel('Less output latency');
  expect(popover()!.textContent).toContain('207ms');
  await click('Use reported');
  expect(popover()!.textContent).toContain('212ms');
  expect(popover()!.textContent).toContain('device-reported');
  expect(store.heardRoute().overridden).toBe(false);
  // The popover stays open through calibration; the mix is uninterrupted.
  expect(popover()).not.toBeNull();
});

it('closes on outside pointerdown and on Escape, and the chip toggles it', async () => {
  await load();
  await click('212ms');
  expect(popover()).not.toBeNull();
  await act(async () => {
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  });
  expect(popover()).toBeNull();
  await click('212ms');
  expect(popover()).not.toBeNull();
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  });
  expect(popover()).toBeNull();
});

it('switching Heard off mid-calibration closes the popover and hides the chip', async () => {
  await load();
  await click('212ms');
  expect(popover()).not.toBeNull();
  await clickLabel('Heard');
  expect(popover()).toBeNull();
  expect(document.querySelector('.perf-heard-chip')).toBeNull();
});
