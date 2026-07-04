// Persisted Waveform style slots (grill decision 2026-07-04): two slots —
// 'full' (library player, decks, editor rows) and 'minimap' (overview
// strips) — each holding a style id + params, stored as one versioned
// localStorage key (the codebase's UI-preference pattern). Live: setSlot
// notifies subscribers, so a tuning-page tweak repaints every surface.
//
// DB persistence (named user presets) is deliberately deferred until styles
// become a product feature — see the waveform-overhaul PRD.

import { useSyncExternalStore } from 'react';
import { DEFAULT_PARAMS, DEFAULT_STYLE_ID, STYLE_REGISTRY } from './styles';
import type { StyleParams } from './styles';

export type SlotName = 'full' | 'minimap';

export interface SlotState {
  styleId: string;
  params: StyleParams;
}

export type StyleSlots = Record<SlotName, SlotState>;

const STORAGE_KEY = 'manadj.waveformStyles';
const STORAGE_VERSION = 1;

export function defaultSlots(): StyleSlots {
  return {
    full: { styleId: DEFAULT_STYLE_ID, params: { ...DEFAULT_PARAMS } },
    // Minimap: markers are full-height bars, headroom matters less, and the
    // strip is short — run near full scale by default.
    minimap: { styleId: DEFAULT_STYLE_ID, params: { ...DEFAULT_PARAMS, master: 1.0 } },
  };
}

function sanitizeSlot(raw: unknown, fallback: SlotState): SlotState {
  if (typeof raw !== 'object' || raw === null) return fallback;
  const r = raw as Partial<SlotState> & { params?: Partial<StyleParams> };
  const styleId = STYLE_REGISTRY.some((s) => s.id === r.styleId)
    ? (r.styleId as string)
    : fallback.styleId;
  const p: Partial<StyleParams> = r.params ?? {};
  const num = (v: unknown, fb: number) => (typeof v === 'number' && isFinite(v) ? v : fb);
  const params: StyleParams = {
    displayGamma: num(p.displayGamma, fallback.params.displayGamma),
    master: num(p.master, fallback.params.master),
    gains: Array.isArray(p.gains) && p.gains.length === 3
      ? [num(p.gains[0], 1), num(p.gains[1], 1), num(p.gains[2], 1)]
      : [...fallback.params.gains],
    b1: Math.min(7, Math.max(1, Math.round(num(p.b1, fallback.params.b1)))),
    b2: Math.min(8, Math.max(2, Math.round(num(p.b2, fallback.params.b2)))),
    smooth: typeof p.smooth === 'boolean' ? p.smooth : fallback.params.smooth,
  };
  if (params.b2 <= params.b1) params.b2 = params.b1 + 1;
  return { styleId, params };
}

function load(): StyleSlots {
  const defaults = defaultSlots();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    if (parsed?.version !== STORAGE_VERSION) return defaults;
    return {
      full: sanitizeSlot(parsed.full, defaults.full),
      minimap: sanitizeSlot(parsed.minimap, defaults.minimap),
    };
  } catch {
    return defaults;
  }
}

let slots: StyleSlots = load();
const listeners = new Set<() => void>();

export function getSlots(): StyleSlots {
  return slots;
}

export function getSlot(name: SlotName): SlotState {
  return slots[name];
}

export function setSlot(
  name: SlotName,
  patch: { styleId?: string; params?: Partial<StyleParams> },
): void {
  const prev = slots[name];
  const next: SlotState = {
    styleId: patch.styleId ?? prev.styleId,
    params: { ...prev.params, ...patch.params },
  };
  slots = { ...slots, [name]: next };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, ...slots }));
  } catch {
    // Persistence is best-effort; the in-memory state still drives rendering.
  }
  for (const l of listeners) l();
}

export function resetSlots(): void {
  slots = defaultSlots();
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* best-effort */
  }
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The current state of a style slot; re-renders on any slot change. */
export function useStyleSlot(name: SlotName): SlotState {
  return useSyncExternalStore(subscribe, () => slots[name]);
}
