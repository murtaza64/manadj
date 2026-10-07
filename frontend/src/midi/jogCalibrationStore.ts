import { useSyncExternalStore } from 'react';
import {
  DEFAULT_JOG_CALIBRATION,
  GRV6_JOG_CALIBRATION,
  SB3_JOG_CALIBRATION,
} from './jogCalibration';
import type { JogCalibration, JogProfile } from './jogCalibration';
import { removeSetting, shippedDefault, writeSetting } from '../settings/persistedSettings';

const STORAGE_KEY = 'manadj.grv6JogCalibration';
const STORAGE_VERSION = 1;

function finitePositive(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

export function sanitizeJogCalibration(
  raw: unknown,
  fallback: JogCalibration = GRV6_JOG_CALIBRATION
): JogCalibration {
  if (typeof raw !== 'object' || raw === null) return { ...fallback };
  const value = raw as Partial<JogCalibration>;
  return {
    bendPercentPerTick: finitePositive(value.bendPercentPerTick, fallback.bendPercentPerTick),
    bendMaxPercent: finitePositive(value.bendMaxPercent, fallback.bendMaxPercent),
    bendFilterWindow: Math.max(
      1,
      Math.round(finitePositive(value.bendFilterWindow, fallback.bendFilterWindow))
    ),
    rimSeekSecondsPerTick: finitePositive(value.rimSeekSecondsPerTick, fallback.rimSeekSecondsPerTick),
    touchSeekSecondsPerTick: finitePositive(value.touchSeekSecondsPerTick, fallback.touchSeekSecondsPerTick),
    fastSeekSecondsPerTick: finitePositive(value.fastSeekSecondsPerTick, fallback.fastSeekSecondsPerTick),
    fastSeekAccelTicksPerSecond: finitePositive(
      value.fastSeekAccelTicksPerSecond,
      fallback.fastSeekAccelTicksPerSecond
    ),
    fastSeekAccelMax: finitePositive(value.fastSeekAccelMax, fallback.fastSeekAccelMax),
  };
}

function parseStored(raw: string | null): JogCalibration | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed?.version === STORAGE_VERSION ? sanitizeJogCalibration(parsed.calibration) : null;
  } catch {
    return null;
  }
}

/** The GRV6 model default: the Shipped default (setup-guides #293) when
 *  present, else the code constant. Reset returns here. */
export function grv6DefaultCalibration(): JogCalibration {
  return parseStored(shippedDefault(STORAGE_KEY)) ?? { ...GRV6_JOG_CALIBRATION };
}

function load(): JogCalibration {
  try {
    return parseStored(localStorage.getItem(STORAGE_KEY)) ?? grv6DefaultCalibration();
  } catch {
    return grv6DefaultCalibration();
  }
}

let grv6Calibration = load();
const listeners = new Set<() => void>();

export function getJogCalibration(profile?: JogProfile): JogCalibration {
  if (profile === 'grv6') return grv6Calibration;
  if (profile === 'ddj-sb3') return SB3_JOG_CALIBRATION;
  return DEFAULT_JOG_CALIBRATION;
}

export function setGrv6JogCalibration(patch: Partial<JogCalibration>): void {
  grv6Calibration = sanitizeJogCalibration({ ...grv6Calibration, ...patch });
  // Write-through (settings #176): DB + localStorage cache, best-effort.
  writeSetting(
    STORAGE_KEY,
    JSON.stringify({ version: STORAGE_VERSION, calibration: grv6Calibration })
  );
  for (const listener of listeners) listener();
}

export function resetGrv6JogCalibration(): void {
  grv6Calibration = grv6DefaultCalibration();
  removeSetting(STORAGE_KEY);
  for (const listener of listeners) listener();
}

export function grv6CalibrationCode(calibration: JogCalibration = grv6Calibration): string {
  return `export const GRV6_JOG_CALIBRATION: JogCalibration = ${JSON.stringify(calibration, null, 2)};`;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useGrv6JogCalibration(): JogCalibration {
  return useSyncExternalStore(subscribe, () => grv6Calibration);
}
