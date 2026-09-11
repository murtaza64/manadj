import { useSyncExternalStore } from 'react';
import type { ChannelId } from '../../playback/mixer';
import { removeSetting, writeSetting } from '../../settings/persistedSettings';

export interface MouseJogSettings {
  sensitivity: number;
  acceleration: number;
  smoothingMs: number;
}

export const DEFAULT_MOUSE_JOG_SETTINGS = { sensitivity: 2, acceleration: 1.8, smoothingMs: 50 };
const STORAGE_KEY = 'manadj-mouse-jog';

function bounded(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback;
}

function sanitize(raw: unknown): MouseJogSettings {
  const value = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<MouseJogSettings>;
  return {
    sensitivity: bounded(value.sensitivity, DEFAULT_MOUSE_JOG_SETTINGS.sensitivity, 0.25, 12),
    acceleration: bounded(value.acceleration, DEFAULT_MOUSE_JOG_SETTINGS.acceleration, 1, 3),
    smoothingMs: bounded(value.smoothingMs, DEFAULT_MOUSE_JOG_SETTINGS.smoothingMs, 0, 200),
  };
}

export function mouseJogBendTarget(velocity: number, settings: MouseJogSettings): number {
  if (!Number.isFinite(velocity) || velocity === 0) return 0;
  const { sensitivity, acceleration } = sanitize(settings);
  return Math.sign(velocity) * Math.min(8, 8 * (Math.abs(velocity) * sensitivity / 6000) ** acceleration);
}

function load(): MouseJogSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (raw?.version === 1) return sanitize(raw.settings);
  } catch {
    // An unavailable or malformed cache starts at the baseline.
  }
  return { ...DEFAULT_MOUSE_JOG_SETTINGS };
}

let settings = load();
const listeners = new Set<() => void>();

export function getMouseJogSettings(): MouseJogSettings {
  return settings;
}

function publish(next: MouseJogSettings): void {
  if (next.sensitivity === settings.sensitivity && next.acceleration === settings.acceleration &&
      next.smoothingMs === settings.smoothingMs) return;
  settings = next;
  for (const listener of listeners) listener();
}

export function setMouseJogSettings(patch: Partial<MouseJogSettings>): void {
  const next = sanitize({ ...settings, ...patch });
  writeSetting(STORAGE_KEY, JSON.stringify({ version: 1, settings: next }));
  publish(next);
}

export function resetMouseJogSettings(): void {
  removeSetting(STORAGE_KEY);
  publish({ ...DEFAULT_MOUSE_JOG_SETTINGS });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useMouseJogSettings(): MouseJogSettings {
  return useSyncExternalStore(subscribe, getMouseJogSettings);
}

const speeds: Record<ChannelId, number> = { A: 0, B: 0, C: 0, D: 0 };
const speedListeners: Record<ChannelId, Set<() => void>> = {
  A: new Set(), B: new Set(), C: new Set(), D: new Set(),
};

/** Controller-owned telemetry: publish zero when a gesture is cancelled. */
export function setMouseJogSpeed(deck: ChannelId, speed: number): void {
  const next = Number.isFinite(speed) ? speed : 0;
  if (speeds[deck] === next) return;
  speeds[deck] = next;
  for (const listener of speedListeners[deck]) listener();
}

export function useMouseJogSpeed(deck: ChannelId): number {
  return useSyncExternalStore(
    (listener) => {
      speedListeners[deck].add(listener);
      return () => { speedListeners[deck].delete(listener); };
    },
    () => speeds[deck],
  );
}
