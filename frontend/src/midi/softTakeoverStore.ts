import { writeSetting } from '../settings/persistedSettings';
import { clearTakeoverHints } from './takeoverFeedback';

export const SOFT_TAKEOVER_SETTING_KEY = 'manadj-soft-takeover';

function readInitialState(): boolean {
  try {
    return localStorage.getItem(SOFT_TAKEOVER_SETTING_KEY) !== 'off';
  } catch {
    return true;
  }
}

let enabled = readInitialState();
const listeners = new Set<() => void>();

export function isSoftTakeoverEnabled(): boolean {
  return enabled;
}

export function subscribeSoftTakeover(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setSoftTakeoverEnabled(next: boolean): void {
  if (enabled === next) return;
  enabled = next;
  writeSetting(SOFT_TAKEOVER_SETTING_KEY, next ? 'on' : 'off');
  if (!next) clearTakeoverHints();
  for (const listener of listeners) listener();
}
