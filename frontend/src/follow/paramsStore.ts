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

const STORAGE_KEY = 'manadj-follow-params';
/** The retired one-shot's key — deleted on boot (this key REPLACES it). */
const LEGACY_KEY = 'findRelatedTracksSettings';

function loadParams(): FollowParams {
  try {
    localStorage.removeItem(LEGACY_KEY);
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_FOLLOW_PARAMS;
    const parsed = JSON.parse(raw) as Partial<FollowParams>;
    return {
      ...DEFAULT_FOLLOW_PARAMS,
      ...parsed,
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
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(params));
  } catch {
    // persistence is best-effort; the session still follows
  }
}

let params: FollowParams = loadParams();
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
  saveParams(params);
  notify();
}

export function resetFollowParams(): void {
  params = DEFAULT_FOLLOW_PARAMS;
  saveParams(params);
  notify();
}

export function useFollowParams(): FollowParams {
  return useSyncExternalStore(subscribeFollowParams, getFollowParams);
}
