import { beforeEach, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const values = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    clear: () => values.clear(),
    key: (i: number) => [...values.keys()][i] ?? null,
    get length() {
      return values.size;
    },
  };
});

import { getGuide, guideStatus, listGuides, registerGuide, SETUP_STATE_KEY, setGuideStatus, subscribeSetupState } from './guides';
import { PERSISTED_SETTING_KEYS } from '../settings/persistedSettings';
import { CONTROLLER_CHECK_ID } from './controllerCheck/register';

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true })));
});

it('setup state is a persisted setting', () => {
  expect(PERSISTED_SETTING_KEYS).toContain(SETUP_STATE_KEY);
});

it('status transitions: not-started → skipped → done → not-started', () => {
  const listener = vi.fn();
  const off = subscribeSetupState(listener);
  expect(guideStatus('g')).toBe('not-started');
  setGuideStatus('g', 'skipped');
  expect(guideStatus('g')).toBe('skipped');
  setGuideStatus('g', 'done');
  expect(guideStatus('g')).toBe('done');
  expect(JSON.parse(localStorage.getItem(SETUP_STATE_KEY)!)).toEqual({ g: 'done' });
  setGuideStatus('g', 'not-started');
  expect(guideStatus('g')).toBe('not-started');
  expect(listener).toHaveBeenCalledTimes(3);
  off();
});

it('tolerates a corrupt setup state', () => {
  localStorage.setItem(SETUP_STATE_KEY, '{"g":"bogus","h":"done"');
  expect(guideStatus('h')).toBe('not-started');
  localStorage.setItem(SETUP_STATE_KEY, '{"g":"bogus","h":"done"}');
  expect(guideStatus('g')).toBe('not-started');
  expect(guideStatus('h')).toBe('done');
});

it('lists guides in order; the Controller check is registered', () => {
  registerGuide({ id: 'z-first', title: 'First', order: 1, status: () => 'not-started', Component: () => null });
  const ids = listGuides().map((g) => g.id);
  expect(ids[0]).toBe('z-first');
  const cc = getGuide(CONTROLLER_CHECK_ID)!;
  expect(cc.title).toBe('Controller check');
  expect(cc.status()).toBe('not-started');
  setGuideStatus(CONTROLLER_CHECK_ID, 'done');
  expect(cc.status()).toBe('done');
});
