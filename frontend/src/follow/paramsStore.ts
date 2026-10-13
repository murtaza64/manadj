/**
 * Follow parameters store (follow-mode 05): the matching parameters'
 * module-level home, on their own preference key (localStorage — the
 * codebase's UI-preference pattern), replacing the retired one-shot's
 * settings key. Edits apply live: the modal writes here, the Library's
 * follow queries and the FilterBar summary subscribe.
 */
import { useSyncExternalStore } from 'react';
import { DEFAULT_FOLLOW_PARAMS } from './model';
import type { FollowParams } from './model';
import { writeSetting } from '../settings/persistedSettings';

const STORAGE_KEY = 'manadj-follow-params';
/** The retired one-shot's key — deleted on boot (this key REPLACES it). */
const LEGACY_KEY = 'findRelatedTracksSettings';

function clampTemperature(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function loadParams(): FollowParams {
  try {
    localStorage.removeItem(LEGACY_KEY);
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_FOLLOW_PARAMS;
    const parsed = JSON.parse(raw) as Partial<FollowParams>;
    return {
      ...DEFAULT_FOLLOW_PARAMS,
      ...parsed,
      temperature: clampTemperature(parsed.temperature ?? DEFAULT_FOLLOW_PARAMS.temperature),
      bpmThresholdPercent: Math.max(
        0,
        Math.min(15, Number(parsed.bpmThresholdPercent ?? DEFAULT_FOLLOW_PARAMS.bpmThresholdPercent))
      ),
    };
  } catch {
    return DEFAULT_FOLLOW_PARAMS;
  }
}

function saveParams(params: FollowParams): void {
  // Write-through (settings #176): DB + localStorage cache, best-effort.
  writeSetting(STORAGE_KEY, JSON.stringify(params));
}

let params: FollowParams = loadParams();
let temperature = params.temperature;
let temperatureTimer: ReturnType<typeof setTimeout> | undefined;
// Session-only draw: shared by Library instances, never persisted as a preference.
let seed = Math.floor(Math.random() * 0x100000000);
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribeFollowParams(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Stable snapshot for useSyncExternalStore; replaced on every change. */
export function getFollowParams(): FollowParams {
  return params;
}

/** Merge-update; effective immediately (no Apply anywhere). */
export function setFollowParams(update: Partial<FollowParams>): void {
  params = { ...params, ...update };
  params.temperature = clampTemperature(params.temperature);
  if ('temperature' in update) {
    clearTimeout(temperatureTimer);
    temperatureTimer = undefined;
    temperature = params.temperature;
  }
  saveParams(params);
  notify();
}

export function resetFollowParams(): void {
  clearTimeout(temperatureTimer);
  temperatureTimer = undefined;
  params = DEFAULT_FOLLOW_PARAMS;
  temperature = params.temperature;
  saveParams(params);
  notify();
}

export function useFollowParams(): FollowParams {
  return useSyncExternalStore(subscribeFollowParams, getFollowParams);
}

export function getFollowSeed(): number {
  return seed;
}

export function rerollFollow(): void {
  if (temperatureTimer !== undefined) setFollowParams({ temperature });
  seed = (seed + 1) >>> 0;
  notify();
}

export function useFollowSeed(): number {
  return useSyncExternalStore(subscribeFollowParams, getFollowSeed);
}

export function getFollowTemperature(): number {
  return temperature;
}

/** Only the fader observes drafts. Library's params snapshot changes once
 * movement settles; the store retains pending edits if the header unmounts. */
export function setFollowTemperature(value: number): void {
  clearTimeout(temperatureTimer);
  temperatureTimer = undefined;
  temperature = clampTemperature(value);
  if (temperature !== params.temperature) {
    temperatureTimer = setTimeout(() => setFollowParams({ temperature }), 150);
  }
  notify();
}

export function useFollowTemperature(): number {
  return useSyncExternalStore(subscribeFollowParams, getFollowTemperature);
}
