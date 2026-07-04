/**
 * Transition-editor pair store: saved Transitions per ordered track pair,
 * persisted to localStorage. Graduation target: DB persistence (the
 * Transition library) — this module is the seam.
 *
 * LAZY PERSISTENCE (transition-library 01): pristine Transitions — the
 * default shape with a default name, never favorited — exist only in the
 * editor's memory. Persisting filters them out, and loading prunes any
 * legacy pristine-shaped saves, so merely-opened pairs leave no trace and
 * the discovery index (issue 02) stays honest by construction.
 */
import { defaultMix } from './mixModel';
import type { EditorMix, Transition } from './mixModel';

const PAIR_STORE_KEY = 'manadj-transition-pairs';
export const LAST_PAIR_KEY = 'manadj-last-pair';
/** Pre-graduation storage keys (renamed 2026-07-04, migrated on load). */
const OLD_PAIR_STORE_KEY = 'PROTOTYPE-transition-editor-pairs';
const OLD_LAST_PAIR_KEY = 'PROTOTYPE-transition-editor-last';


/** A saved Transition (first-class, per ordered track pair). `bInSec` lives
 * INSIDE the transition (issue 11 — pair knowledge switches with the named
 * artifact); older saves carried it as a sibling field (migrated on load). */
export interface SavedTransition {
  name: string;
  transition: EditorMix['transition'];
  /** Proven move (glossary: Favorite). A pair with ≥1 favorited Transition
   * is a Preferred pair — always derived, never stored. */
  favorite?: boolean;
}

export interface PairEntry {
  items: SavedTransition[];
  active: number;
}

export type PairStore = Record<string, PairEntry>;

export function loadPairStore(): PairStore {
  // Graduation key rename (2026-07-04): one-time move from the PROTOTYPE-
  // prefixed keys. (The even older single-mix-draft migration was dropped
  // here — that data was migrated into the pair store long ago.)
  const old = localStorage.getItem(OLD_PAIR_STORE_KEY);
  if (old !== null && localStorage.getItem(PAIR_STORE_KEY) === null) {
    localStorage.setItem(PAIR_STORE_KEY, old);
  }
  localStorage.removeItem(OLD_PAIR_STORE_KEY);
  const oldLast = localStorage.getItem(OLD_LAST_PAIR_KEY);
  if (oldLast !== null && localStorage.getItem(LAST_PAIR_KEY) === null) {
    localStorage.setItem(LAST_PAIR_KEY, oldLast);
  }
  localStorage.removeItem(OLD_LAST_PAIR_KEY);

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
  // Lazy-persistence honesty: pristine-shaped saves (pre-transition-library
  // autosave wrote merely-opened pairs) are pruned so they never feed
  // discovery.
  const pruned = pruneStore(store);
  if (pruned.changed) savePairStore(pruned.store);
  return pruned.store;
}

// ── Change events (same-tab) ───────────────────────────────────────────
// The library's discovery index rebuilds on every store write (issue 02).

type StoreListener = (store: PairStore) => void;
const storeListeners = new Set<StoreListener>();

export function subscribePairStore(fn: StoreListener): () => void {
  storeListeners.add(fn);
  return () => storeListeners.delete(fn);
}

export function savePairStore(store: PairStore): void {
  localStorage.setItem(PAIR_STORE_KEY, JSON.stringify(store));
  for (const fn of storeListeners) fn(store);
}

// ── Materialization rules (pure — under vitest) ────────────────────────

const DEFAULT_NAME_RE = /^Transition \d+$/;

/** Next free "Transition n" number (creation-ordered list, holes reused). */
export function nextFreeNumber(items: SavedTransition[]): number {
  const taken = new Set(
    items
      .map((i) => (DEFAULT_NAME_RE.test(i.name) ? Number(i.name.slice('Transition '.length)) : 0))
      .filter((n) => n > 0)
  );
  let n = 1;
  while (taken.has(n)) n++;
  return n;
}

/** A fresh in-memory Transition: default shape, next free default name. */
export function freshTransition(items: SavedTransition[]): SavedTransition {
  return {
    name: `Transition ${nextFreeNumber(items)}`,
    transition: defaultMix().transition,
  };
}

/** Does this transition still have the untouched default shape? */
function isDefaultShape(tr: Transition): boolean {
  const d = defaultMix().transition;
  return (
    tr.startSec === d.startSec &&
    tr.durationSec === d.durationSec &&
    tr.bInSec === d.bInSec &&
    tr.tempoMatch === d.tempoMatch &&
    Object.values(tr.lanes).every((pts) => !pts || pts.length === 0) &&
    (tr.hiddenLanes?.length ?? 0) === 0
  );
}

/**
 * Pristine = never really edited: default shape, default name, never
 * favorited. The rule is VALUE-based (not event-based), so an edit that is
 * exactly reverted evaporates too — documented behavior, and it doubles as
 * the legacy-save pruning predicate.
 */
export function isPristine(item: SavedTransition): boolean {
  return !item.favorite && DEFAULT_NAME_RE.test(item.name) && isDefaultShape(item.transition);
}

/**
 * The stored view of a session list: pristine items filtered out, `active`
 * remapped to the same item's index in the filtered list (or clamped when
 * the active item itself is pristine). Returns null when nothing is worth
 * storing — the pair should not exist in the store at all.
 */
export function toStoredEntry(items: SavedTransition[], active: number): PairEntry | null {
  const kept = items.filter((i) => !isPristine(i));
  if (kept.length === 0) return null;
  const activeItem = items[active];
  const storedActive = Math.max(0, kept.indexOf(activeItem));
  return { items: kept, active: storedActive };
}

/** Prune pristine-shaped entries from a loaded store (legacy honesty). */
export function pruneStore(store: PairStore): { store: PairStore; changed: boolean } {
  const out: PairStore = {};
  let changed = false;
  for (const [key, entry] of Object.entries(store)) {
    const stored = toStoredEntry(entry.items, entry.active);
    if (!stored) {
      changed = true;
      continue;
    }
    if (stored.items.length !== entry.items.length || stored.active !== entry.active) {
      changed = true;
    }
    out[key] = stored;
  }
  return { store: out, changed };
}
