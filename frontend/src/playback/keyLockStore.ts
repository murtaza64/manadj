/**
 * Key Lock flags store (key-lock 03): the persisted per-Deck Key Lock
 * setting for the shared Decks. Module-level like followStore/routingStore
 * — Key Lock belongs to the Deck, not to a view; default is ON (the PRD's
 * common case: harmonic mixing needs no setup).
 *
 * The DeckEngine holds the live state (snapshot.keyLock drives the worklet
 * mode); this store is the persistence + boot-restore face. DeckContext
 * applies it at engine creation; the MixZone toggle writes both.
 */
export type KeyLockFlags = { A: boolean; B: boolean };

const STORAGE_KEY = 'manadj-keylock';

function loadFlags(): KeyLockFlags {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { A: true, B: true };
    const parsed = JSON.parse(raw) as Partial<Record<'A' | 'B', unknown>>;
    // Default ON: only an explicit false turns a deck's lock off.
    return { A: parsed.A !== false, B: parsed.B !== false };
  } catch {
    return { A: true, B: true };
  }
}

function saveFlags(next: KeyLockFlags): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // persistence is best-effort; the session keeps its setting
  }
}

let flags: KeyLockFlags = loadFlags();
const listeners = new Set<() => void>();

export function subscribeKeyLock(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Stable snapshot for useSyncExternalStore; replaced on every change. */
export function getKeyLockFlags(): KeyLockFlags {
  return flags;
}

export function setKeyLockFlag(deck: 'A' | 'B', on: boolean): void {
  if (flags[deck] === on) return;
  flags = { ...flags, [deck]: on };
  saveFlags(flags);
  for (const listener of listeners) listener();
}
