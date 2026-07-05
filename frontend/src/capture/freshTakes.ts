/**
 * Fresh-Take surfacing (sets 13): the latest just-captured Take per
 * ordered pair, feeding the Set view's transient "new take — pin?" chip.
 *
 * Session-scoped module state (house snapshot/subscribe pattern, like
 * setStore): a fresh Take is an ephemeral prompt, not history — the Take
 * row itself is already persisted; reloads simply start with no chips.
 * The take sink records here on persist; pinning (or a newer attempt)
 * retires the entry. Never auto-pinned — Takes are unreviewed by
 * definition; the chip is the softest manual act.
 */

export interface FreshTake {
  uuid: string;
}

export type FreshTakesSnapshot = Readonly<Record<string, FreshTake>>;

let snapshot: FreshTakesSnapshot = {};
const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of listeners) fn();
}

const pairKey = (aTrackId: number, bTrackId: number) => `${aTrackId}:${bTrackId}`;

/** A Take persisted for this ordered pair — the LATEST one wins (repeated
 * rehearsal attempts replace the offer; the evidence count carries the
 * rest). */
export function recordFreshTake(aTrackId: number, bTrackId: number, uuid: string): void {
  snapshot = { ...snapshot, [pairKey(aTrackId, bTrackId)]: { uuid } };
  notify();
}

/** Retire the pair's offer (it was pinned, or otherwise dealt with). */
export function clearFreshTake(aTrackId: number, bTrackId: number): void {
  const key = pairKey(aTrackId, bTrackId);
  if (!(key in snapshot)) return;
  const { [key]: _gone, ...rest } = snapshot;
  snapshot = rest;
  notify();
}

export function snapshotFreshTakes(): FreshTakesSnapshot {
  return snapshot;
}

export function subscribeFreshTakes(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The chip rule: offer the pair's fresh Take unless it already IS the
 * pin. A different pin does not suppress it — surfacing never auto-pins,
 * so the offer stands until acted on or superseded. */
export function freshTakeChip(
  snap: FreshTakesSnapshot,
  aTrackId: number,
  bTrackId: number,
  pinnedUuid: string | null
): FreshTake | null {
  const fresh = snap[pairKey(aTrackId, bTrackId)];
  if (!fresh || fresh.uuid === pinnedUuid) return null;
  return fresh;
}

/** Reset module state (tests only). */
export function _resetFreshTakesForTests(): void {
  snapshot = {};
  listeners.clear();
}
