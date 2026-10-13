/**
 * Cue mode store (setup-guides #289): the app-wide preference for what a
 * Hot Cue press does on a paused Deck (CONTEXT.md "Cue mode"). Gated
 * (default) holds-to-preview; Trigger jumps and starts playback. Read at
 * gesture time by DeckEngine's transport context.
 */
import { writeSetting } from '../settings/persistedSettings';

export type CueMode = 'gated' | 'trigger';

export const CUE_MODE_STORAGE_KEY = 'manadj-cue-mode';

function load(): CueMode {
  try {
    // Default Gated: only an explicit 'trigger' switches.
    return localStorage.getItem(CUE_MODE_STORAGE_KEY) === 'trigger' ? 'trigger' : 'gated';
  } catch {
    return 'gated';
  }
}

let cueMode: CueMode = load();
const listeners = new Set<() => void>();

export function subscribeCueMode(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getCueMode(): CueMode {
  return cueMode;
}

export function setCueMode(mode: CueMode): void {
  if (mode === cueMode) return;
  cueMode = mode;
  writeSetting(CUE_MODE_STORAGE_KEY, mode);
  for (const listener of listeners) listener();
}
