import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  DEFAULT_FILTER_SETTINGS,
  FILTER_SETTINGS_KEY,
  loadFilterSettings,
  saveFilterSettings,
  sanitizeFilterSettings,
} from './filterSettings';
import { PERSISTED_SETTING_KEYS } from '../settings/persistedSettings';

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true })),
  );
});
afterEach(() => vi.unstubAllGlobals());

it('persists the selected filter and restores approved defaults when reset', () => {
  expect(PERSISTED_SETTING_KEYS).toContain(FILTER_SETTINGS_KEY);
  expect(loadFilterSettings()).toEqual(DEFAULT_FILTER_SETTINGS);
  saveFilterSettings({
    ...DEFAULT_FILTER_SETTINGS,
    model: 'res48',
    resonance: 21,
  });
  expect(loadFilterSettings()).toMatchObject({
    model: 'res48',
    resonance: 21,
    compensation: 0.15,
  });
  saveFilterSettings(DEFAULT_FILTER_SETTINGS);
  expect(loadFilterSettings()).toEqual(DEFAULT_FILTER_SETTINGS);
});

it('recovers from malformed, missing and out-of-range persisted values', () => {
  localStorage.setItem(FILTER_SETTINGS_KEY, '{broken');
  expect(loadFilterSettings()).toEqual(DEFAULT_FILTER_SETTINGS);
  localStorage.setItem(
    FILTER_SETTINGS_KEY,
    JSON.stringify({
      model: 'dual',
      resonance: -8,
      lpMin: 9999,
      hpMax: null,
      spread: 0,
    }),
  );
  expect(loadFilterSettings()).toMatchObject({
    model: 'dual',
    resonance: 0,
    lpMin: 300,
    hpMax: 16000,
    spread: 0,
  });
  expect(Object.isFrozen(sanitizeFilterSettings({}))).toBe(true);
});
