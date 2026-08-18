/**
 * Visualizer preset store (realtime-visualization 01): the sticky preset
 * choice, module-level like quantizeStore/keyLockStore. localStorage is
 * origin-shared, so the choice survives reopening the visualizer window
 * and is written from the window itself (the one writer).
 */

import { DEFAULT_PRESET_ID, presetById } from './presets';

const STORAGE_KEY = 'manadj-visualizer-preset';

function load(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    // Normalize unknown/stale ids to a real preset.
    return stored ? presetById(stored).id : DEFAULT_PRESET_ID;
  } catch {
    return DEFAULT_PRESET_ID;
  }
}

function save(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // persistence is best-effort; the session keeps its setting
  }
}

let presetId = load();
const listeners = new Set<() => void>();

export function subscribePreset(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPresetId(): string {
  return presetId;
}

export function setPresetId(id: string): void {
  const normalized = presetById(id).id;
  if (normalized === presetId) return;
  presetId = normalized;
  save(normalized);
  for (const listener of listeners) listener();
}
