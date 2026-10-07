/**
 * GRV6 jog calibration falls back to / resets to the Shipped default
 * (setup-guides #293) — "that model's default" — else the code constant.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GRV6_JOG_CALIBRATION } from './jogCalibration';

const shipped = { current: null as string | null };
vi.mock('../settings/persistedSettings', () => ({
  writeSetting: vi.fn(),
  removeSetting: vi.fn((key: string) => localStorage.removeItem(key)),
  shippedDefault: () => shipped.current,
}));

const SHIPPED = { ...GRV6_JOG_CALIBRATION, bendMaxPercent: 25, fastSeekAccelTicksPerSecond: 395 };

beforeEach(() => {
  vi.resetModules();
  const map = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  });
  shipped.current = null;
});

afterEach(() => vi.unstubAllGlobals());

describe('GRV6 jog calibration default', () => {
  it('uses the shipped default when unset, and resets to it', async () => {
    shipped.current = JSON.stringify({ version: 1, calibration: SHIPPED });
    localStorage.setItem('manadj.grv6JogCalibration', JSON.stringify({ version: 1, calibration: { ...SHIPPED, bendMaxPercent: 40 } }));
    const store = await import('./jogCalibrationStore');
    expect(store.getJogCalibration('grv6').bendMaxPercent).toBe(40);

    store.resetGrv6JogCalibration();
    expect(store.getJogCalibration('grv6')).toEqual(SHIPPED);
  });

  it('falls back to the code constant without a shipped default', async () => {
    const store = await import('./jogCalibrationStore');
    expect(store.getJogCalibration('grv6')).toEqual(GRV6_JOG_CALIBRATION);
    store.resetGrv6JogCalibration();
    expect(store.getJogCalibration('grv6')).toEqual(GRV6_JOG_CALIBRATION);
  });
});
