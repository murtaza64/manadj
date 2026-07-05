/**
 * Transition store: saved Transitions per ordered track pair, persisted in
 * the app DB (ADR 0011) behind a snapshot interface — async `init()` at
 * boot, sync `snapshotPairStore()` reads, optimistic write-through on
 * `savePairEntry()`. Identity is the client-generated `uuid`; the server
 * reconciles pair-replace PUTs by it. Editor session state (`active` per
 * pair, last-open pair) stays in localStorage — the DB stores the artifact,
 * not anybody's screen.
 *
 * LAZY PERSISTENCE (transition-library 01): pristine Transitions — the
 * default shape with a default name, never favorited — exist only in the
 * editor's memory. Persisting filters them out (toStoredEntry), so
 * merely-opened pairs leave no trace and the discovery index stays honest
 * by construction.
 *
 * The pre-DB localStorage store migrates once: when the DB is empty and the
 * legacy key exists, its pairs are pushed up and the key is renamed to a
 * backup. DB non-empty → legacy data is ignored, never merged.
 */
import { api } from '../api/client';
import { defaultMix } from './mixModel';
import type { EditorMix, Transition } from './mixModel';

export const LAST_PAIR_KEY = 'manadj-last-pair';
/** Per-pair active-Transition selection (session state, client-only). */
const ACTIVE_MAP_KEY = 'manadj-transition-active';
/** Pre-DB store (2026-07-04): one-shot migration input, then a backup. */
const LEGACY_PAIR_STORE_KEY = 'manadj-transition-pairs';
const LEGACY_BACKUP_KEY = 'manadj-transition-pairs-pre-db-backup';
/** Pre-graduation keys (renamed 2026-07-04, migrated on legacy load). */
const OLD_PAIR_STORE_KEY = 'PROTOTYPE-transition-editor-pairs';
const OLD_LAST_PAIR_KEY = 'PROTOTYPE-transition-editor-last';


/** A saved Transition (first-class, per ordered track pair). `uuid` is the
 * stable identity (ADR 0011 — survives renames and sibling deletes);
 * `bInSec` lives INSIDE the transition (issue 11). */
export interface SavedTransition {
  uuid: string;
  name: string;
  transition: EditorMix['transition'];
  /** Glossary: Favorite — asserts the pair goes well together AND this
   * specific Transition is good. Write-independent of Linked. */
  favorite?: boolean;
}

export interface PairEntry {
  items: SavedTransition[];
  active: number;
}

export type PairStore = Record<string, PairEntry>;

// ── Snapshot store ─────────────────────────────────────────────────────

let snapshot: PairStore = {};
let initPromise: Promise<void> | null = null;

/** Boot the store: one GET, or the one-shot legacy migration. Idempotent;
 * callers gate on the returned promise. Never rejects — a dead backend
 * degrades to an empty (or legacy-local) snapshot with a logged error. */
export function initTransitionStore(): Promise<void> {
  initPromise ??= doInit();
  return initPromise;
}

async function doInit(): Promise<void> {
  let rows: Awaited<ReturnType<typeof api.transitions.list>>;
  try {
    rows = await api.transitions.list();
  } catch (err) {
    console.error('transition store: boot load failed — starting from legacy/local', err);
    snapshot = readLegacyStore() ?? {};
    notify();
    return;
  }

  if (rows.length > 0) {
    snapshot = storeFromRows(rows);
    notify();
    return;
  }

  // DB empty: one-shot migration of the pre-DB localStorage store.
  const legacy = readLegacyStore();
  if (legacy && Object.keys(legacy).length > 0) {
    snapshot = legacy;
    const results = await Promise.all(
      Object.entries(legacy).map(([key, entry]) => pushPair(key, entry.items))
    );
    if (results.every(Boolean)) {
      const raw = localStorage.getItem(LEGACY_PAIR_STORE_KEY);
      if (raw !== null) localStorage.setItem(LEGACY_BACKUP_KEY, raw);
      localStorage.removeItem(LEGACY_PAIR_STORE_KEY);
    }
    // Any failed push: keep the legacy key so the next boot retries.
  } else {
    snapshot = {};
  }
  notify();
}

/** The current store. Empty until `initTransitionStore()` resolves — the
 * editor gates on init; the library's index rebuilds via the init notify. */
export function snapshotPairStore(): PairStore {
  return snapshot;
}

/**
 * Replace one pair's entry (null deletes the pair): snapshot updates and
 * listeners fire synchronously (optimistic — flush-before-repoint relies
 * on this); the PUT runs in the background, reconciled by uuid. Write
 * failures log only (ADR 0011: no retry queue). `active` goes to
 * localStorage, not the DB.
 */
export function savePairEntry(pairKey: string, entry: PairEntry | null): void {
  const next = { ...snapshot };
  if (entry) next[pairKey] = entry;
  else delete next[pairKey];
  snapshot = next;
  writeActive(pairKey, entry?.active ?? null);
  notify();
  void pushPair(pairKey, entry?.items ?? []);
}

async function pushPair(pairKey: string, items: SavedTransition[]): Promise<boolean> {
  const [a, b] = pairKey.split(':').map(Number);
  try {
    await api.transitions.replacePair(
      a,
      b,
      items.map((it) => ({
        uuid: it.uuid,
        name: it.name,
        favorite: it.favorite ?? false,
        data: it.transition as unknown as Record<string, unknown>,
      }))
    );
    return true;
  } catch (err) {
    console.error(`transition store: save failed for pair ${pairKey}`, err);
    return false;
  }
}

function storeFromRows(rows: Awaited<ReturnType<typeof api.transitions.list>>): PairStore {
  const store: PairStore = {};
  const activeMap = readActiveMap();
  for (const row of rows) {
    const key = `${row.a_track_id}:${row.b_track_id}`;
    (store[key] ??= { items: [], active: 0 }).items.push({
      uuid: row.uuid,
      name: row.name,
      favorite: row.favorite || undefined,
      transition: row.data as unknown as EditorMix['transition'],
    });
  }
  for (const [key, entry] of Object.entries(store)) {
    const active = activeMap[key] ?? 0;
    entry.active = Math.max(0, Math.min(active, entry.items.length - 1));
  }
  return store;
}

// ── Active selection (session state, localStorage) ─────────────────────

function readActiveMap(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(ACTIVE_MAP_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function writeActive(pairKey: string, active: number | null): void {
  const map = readActiveMap();
  if (active === null) delete map[pairKey];
  else map[pairKey] = active;
  localStorage.setItem(ACTIVE_MAP_KEY, JSON.stringify(map));
}

// ── Change events (same-tab) ───────────────────────────────────────────
// The library's discovery index rebuilds on every store write (issue 02).

type StoreListener = (store: PairStore) => void;
const storeListeners = new Set<StoreListener>();

export function subscribePairStore(fn: StoreListener): () => void {
  storeListeners.add(fn);
  return () => storeListeners.delete(fn);
}

function notify(): void {
  for (const fn of storeListeners) fn(snapshot);
}

// ── Legacy localStorage store (one-shot migration input) ───────────────

/** Read + normalize the pre-DB localStorage store: PROTOTYPE-key rename,
 * pre-issue-11 `bInSec` relocation, pristine pruning, uuid assignment.
 * Returns null when no legacy store exists. */
function readLegacyStore(): PairStore | null {
  // Graduation key rename (2026-07-04): one-time move from the PROTOTYPE-
  // prefixed keys.
  const old = localStorage.getItem(OLD_PAIR_STORE_KEY);
  if (old !== null && localStorage.getItem(LEGACY_PAIR_STORE_KEY) === null) {
    localStorage.setItem(LEGACY_PAIR_STORE_KEY, old);
  }
  localStorage.removeItem(OLD_PAIR_STORE_KEY);
  const oldLast = localStorage.getItem(OLD_LAST_PAIR_KEY);
  if (oldLast !== null && localStorage.getItem(LAST_PAIR_KEY) === null) {
    localStorage.setItem(LAST_PAIR_KEY, oldLast);
  }
  localStorage.removeItem(OLD_LAST_PAIR_KEY);

  const raw = localStorage.getItem(LEGACY_PAIR_STORE_KEY);
  if (raw === null) return null;
  let store: PairStore;
  try {
    store = JSON.parse(raw);
  } catch {
    return null;
  }
  // Migrate pre-issue-11 saves: bInSec was a sibling of the transition.
  for (const entry of Object.values(store)) {
    for (const item of entry.items as (SavedTransition & { bInSec?: number })[]) {
      if (item.transition.bInSec === undefined) {
        item.transition.bInSec = item.bInSec ?? 0;
      }
      delete item.bInSec;
      item.uuid ??= newUuid();
    }
  }
  // Lazy-persistence honesty: pristine-shaped saves (pre-transition-library
  // autosave wrote merely-opened pairs) are pruned so they never feed
  // discovery.
  return pruneStore(store).store;
}

/** Reset module state (tests only). */
export function _resetTransitionStoreForTests(): void {
  snapshot = {};
  initPromise = null;
  storeListeners.clear();
}

// ── Materialization rules (pure — under vitest) ────────────────────────

function newUuid(): string {
  return crypto.randomUUID();
}

const DEFAULT_NAME_RE = /^Transition \d+$/;

/** Next free "Transition n" number (creation-ordered list, holes reused —
 * cosmetic display numbering; identity is `uuid`, which never reuses). */
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

/** A fresh in-memory Transition: default shape, next free default name,
 * fresh identity. */
export function freshTransition(items: SavedTransition[]): SavedTransition {
  return {
    uuid: newUuid(),
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
