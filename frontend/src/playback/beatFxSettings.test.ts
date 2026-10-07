import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BEAT_FX_SETTINGS_KEY,
  DEFAULT_BEAT_FX_SETTINGS,
  loadBeatFxSettings,
  sanitizeBeatFxSettings,
  saveBeatFxSettings,
} from './beatFxSettings';
import { PERSISTED_SETTING_KEYS } from '../settings/persistedSettings';

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true })));
});
afterEach(() => vi.unstubAllGlobals());

describe('Beat FX settings', () => {
  it('defaults and clamps persisted values', () => {
    expect(PERSISTED_SETTING_KEYS).toContain(BEAT_FX_SETTINGS_KEY);
    expect(loadBeatFxSettings()).toEqual(DEFAULT_BEAT_FX_SETTINGS);
    localStorage.setItem(BEAT_FX_SETTINGS_KEY, JSON.stringify({
      echoFeedback: 7,
      reverbDecay: 0,
      flangerDelayMs: 4.2,
      flangerFeedback: Number.NaN,
    }));
    expect(loadBeatFxSettings()).toMatchObject({
      echoFeedback: 0.9,
      reverbDecay: 0.5,
      flangerDelayMs: 4.2,
      flangerFeedback: DEFAULT_BEAT_FX_SETTINGS.flangerFeedback,
    });
  });

  it('returns a frozen, complete value from malformed input', () => {
    const settings = sanitizeBeatFxSettings({ reverbDampingHz: 9000 });
    expect(settings).toMatchObject({ ...DEFAULT_BEAT_FX_SETTINGS, reverbDampingHz: 9000 });
    expect(Object.isFrozen(settings)).toBe(true);
  });

  it('defaults the Flanger length unit to bars and rejects unknown units', () => {
    expect(DEFAULT_BEAT_FX_SETTINGS.flangerLengthUnit).toBe('bars');
    expect(sanitizeBeatFxSettings({ flangerLengthUnit: 'beats' }).flangerLengthUnit).toBe('beats');
    expect(sanitizeBeatFxSettings({ flangerLengthUnit: 'ms' }).flangerLengthUnit).toBe('bars');
    // Pre-#331 persisted blobs have no unit: they read as bars.
    localStorage.setItem(BEAT_FX_SETTINGS_KEY, JSON.stringify({ echoFeedback: 0.6 }));
    expect(loadBeatFxSettings().flangerLengthUnit).toBe('bars');
  });

  it('persists through the settings seam', () => {
    saveBeatFxSettings({ ...DEFAULT_BEAT_FX_SETTINGS, echoFeedback: 0.7 });
    expect(JSON.parse(localStorage.getItem(BEAT_FX_SETTINGS_KEY)!)).toMatchObject({ echoFeedback: 0.7 });
  });
});
