/**
 * Transition-editor pair store: saved Transitions per ordered track pair,
 * persisted to localStorage. Graduation target: DB persistence (the
 * Transition library) — this module is the seam.
 */
import type { ProtoMix } from './mixProtoModel';

const PAIR_STORE_KEY = 'PROTOTYPE-transition-editor-pairs';
export const LAST_PAIR_KEY = 'PROTOTYPE-transition-editor-last';
/** Storage key of the pre-rework single-mix draft (migrated on load). */
const LEGACY_MIX_KEY = 'PROTOTYPE-mix-editor-mix';
/** Default working pair while prototyping: Weeble Wobble VIP → Last Time. */
export const DEFAULT_PAIR = { a: 549, b: 171 };

/** A saved Transition (first-class, per ordered track pair). `bInSec` lives
 * INSIDE the transition (issue 11 — pair knowledge switches with the named
 * artifact); older saves carried it as a sibling field (migrated on load). */
export interface SavedTransition {
  name: string;
  transition: ProtoMix['transition'];
}

export interface PairEntry {
  items: SavedTransition[];
  active: number;
}

export type PairStore = Record<string, PairEntry>;

export function loadPairStore(): PairStore {
  let store: PairStore;
  try {
    store = JSON.parse(localStorage.getItem(PAIR_STORE_KEY) ?? '{}');
  } catch {
    store = {};
  }
  // Migrate pre-issue-11 saves: bInSec was a sibling of the transition.
  let migrated = false;
  for (const entry of Object.values(store)) {
    for (const item of entry.items as (SavedTransition & { bInSec?: number })[]) {
      if (item.transition.bInSec === undefined) {
        item.transition.bInSec = item.bInSec ?? 0;
        migrated = true;
      }
      delete item.bInSec;
    }
  }
  if (migrated) savePairStore(store);
  // Migrate the pre-rework single-mix draft into the pair store, so work
  // saved before the transition-per-pair model isn't lost.
  try {
    const raw = localStorage.getItem(LEGACY_MIX_KEY);
    if (raw) {
      const legacy = JSON.parse(raw) as ProtoMix;
      if (legacy.trackAId !== null && legacy.trackBId !== null && legacy.transition) {
        const key = `${legacy.trackAId}:${legacy.trackBId}`;
        if (!store[key]) {
          const legacyBIn = (legacy as ProtoMix & { bInSec?: number }).bInSec ?? 0;
          store[key] = {
            items: [
              {
                name: 'Transition 1',
                transition: { ...legacy.transition, bInSec: legacy.transition.bInSec ?? legacyBIn },
              },
            ],
            active: 0,
          };
          savePairStore(store);
        }
        if (!localStorage.getItem(LAST_PAIR_KEY)) {
          localStorage.setItem(LAST_PAIR_KEY, key);
        }
      }
      localStorage.removeItem(LEGACY_MIX_KEY);
    }
  } catch {
    /* legacy blob unreadable — nothing to migrate */
  }
  return store;
}

export function savePairStore(store: PairStore): void {
  localStorage.setItem(PAIR_STORE_KEY, JSON.stringify(store));
}
