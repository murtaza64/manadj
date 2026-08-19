/**
 * Visualizer preset store (realtime-visualization 01): the sticky preset
 * choice, module-level like quantizeStore/keyLockStore. localStorage is
 * origin-shared, so the choice survives reopening the visualizer window
 * and is written from the window itself (the one writer).
 */

import { DEFAULT_PRESET_ID, presetById } from './presets';
import { isCandidateId } from './presets/gen';
import type { VisualizerPreset } from './presets/types';

const STORAGE_KEY = 'manadj-visualizer-preset';

/** Genepool candidate ids are first-class preset ids (rt-viz 06): they must
 * NOT be normalized through the curated registry — that collapsed every gen
 * chip to PRESETS[0] (the "chips select the default preset" bug, same family
 * as the param snap-back). */
function normalizeId(id: string): string {
  return isCandidateId(id) ? id : presetById(id).id;
}

function load(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    // Normalize unknown/stale ids to a real preset (gen ids pass through).
    return stored ? normalizeId(stored) : DEFAULT_PRESET_ID;
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
  const normalized = normalizeId(id);
  if (normalized === presetId) return;
  presetId = normalized;
  save(normalized);
  for (const listener of listeners) listener();
}

/**
 * Per-preset parameter values (realtime-visualization 05): declared on the
 * preset (PresetParam), persisted per preset, resolved with defaults.
 * Cached objects are replaced on change so useSyncExternalStore consumers
 * and the render loop get reference equality between changes.
 */
const PARAMS_KEY_PREFIX = 'manadj-visualizer-params:';
const paramCache = new Map<string, Record<string, number>>();
const paramListeners = new Set<() => void>();

function resolveParams(preset: VisualizerPreset): Record<string, number> {
  const values: Record<string, number> = {};
  let stored: Record<string, unknown> = {};
  try {
    stored = JSON.parse(localStorage.getItem(PARAMS_KEY_PREFIX + preset.id) ?? '{}');
  } catch {
    // corrupted/absent: defaults
  }
  for (const param of preset.params ?? []) {
    const raw = stored[param.id];
    values[param.id] =
      typeof raw === 'number' && Number.isFinite(raw)
        ? Math.min(param.max, Math.max(param.min, raw))
        : param.default;
  }
  return values;
}

export function getParamValues(preset: VisualizerPreset): Record<string, number> {
  let values = paramCache.get(preset.id);
  if (!values) {
    values = resolveParams(preset);
    paramCache.set(preset.id, values);
  }
  return values;
}

export function setParamValue(presetId: string, paramId: string, value: number): void {
  // Do NOT normalize through presetById: genepool candidates (arena) are
  // not in the curated registry, and normalizing silently redirected their
  // writes to PRESETS[0] — sliders "couldn't be dragged" because reads
  // came back from the candidate's untouched cache entry. Operate on the
  // given id; the cache entry was seeded by getParamValues(preset) when
  // the candidate first rendered.
  const curated = presetById(presetId);
  const base =
    paramCache.get(presetId) ?? (curated.id === presetId ? resolveParams(curated) : {});
  const next = { ...base, [paramId]: value };
  paramCache.set(presetId, next);
  try {
    localStorage.setItem(PARAMS_KEY_PREFIX + presetId, JSON.stringify(next));
  } catch {
    // persistence is best-effort
  }
  for (const listener of paramListeners) listener();
}

export function resetParams(presetId: string): void {
  const id = normalizeId(presetId);
  paramCache.delete(id);
  try {
    localStorage.removeItem(PARAMS_KEY_PREFIX + id);
  } catch {
    // best-effort
  }
  for (const listener of paramListeners) listener();
}

export function subscribeParams(listener: () => void): () => void {
  paramListeners.add(listener);
  return () => paramListeners.delete(listener);
}
