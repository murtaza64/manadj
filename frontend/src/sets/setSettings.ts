/**
 * Set playback settings (sets 06): the tunable heuristics the PRD keeps
 * out of the model — Tempo return ramp speed today; grace-fade headroom
 * later (sets 14). Module-level store on its own localStorage preference
 * key (the codebase's UI-preference pattern, as follow/paramsStore).
 * Edits apply live: the next plan recompute reads the new values.
 */
import { useSyncExternalStore } from 'react';
import {
  DEFAULT_GRACE_FADE_SEC,
  DEFAULT_GRACE_HEADROOM_SEC,
  DEFAULT_TEMPO_RETURN_SEC_PER_PERCENT,
} from './planner';

export interface SetPlaybackSettings {
  /** Tempo return speed (Riding): seconds of ramp per percent of pitch
   * ridden during the window. */
  tempoReturnSecPerPercent: number;
  /** Grace fade (sets 14): free a colliding deck this long before the
   * window that needs it (load headroom)… */
  graceHeadroomSec: number;
  /** …fading the dying track out over this long, ending at the cut. */
  graceFadeSec: number;
}

export const DEFAULT_SET_SETTINGS: SetPlaybackSettings = {
  tempoReturnSecPerPercent: DEFAULT_TEMPO_RETURN_SEC_PER_PERCENT,
  graceHeadroomSec: DEFAULT_GRACE_HEADROOM_SEC,
  graceFadeSec: DEFAULT_GRACE_FADE_SEC,
};

const STORAGE_KEY = 'manadj-set-settings';

function load(): SetPlaybackSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SET_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<SetPlaybackSettings>;
    return {
      tempoReturnSecPerPercent: clampNonNegative(
        parsed.tempoReturnSecPerPercent,
        DEFAULT_SET_SETTINGS.tempoReturnSecPerPercent
      ),
      graceHeadroomSec: clampNonNegative(
        parsed.graceHeadroomSec,
        DEFAULT_SET_SETTINGS.graceHeadroomSec
      ),
      graceFadeSec: clampNonNegative(parsed.graceFadeSec, DEFAULT_SET_SETTINGS.graceFadeSec),
    };
  } catch {
    return DEFAULT_SET_SETTINGS;
  }
}

function clampNonNegative(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

let settings: SetPlaybackSettings = load();

const listeners = new Set<() => void>();

export function getSetSettings(): SetPlaybackSettings {
  return settings;
}

/** Merge-update; effective on the next plan recompute (no Apply). */
export function setSetSettings(update: Partial<SetPlaybackSettings>): void {
  settings = { ...settings, ...update };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Preference persistence is best-effort.
  }
  for (const fn of listeners) fn();
}

export function subscribeSetSettings(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useSetSettings(): SetPlaybackSettings {
  return useSyncExternalStore(subscribeSetSettings, getSetSettings);
}
