/**
 * Link store: Linked pairs (linked-pairs PRD) — the stored, symmetric
 * assertion that two Tracks go well together, persisted in the app DB
 * behind the pairStore snapshot idiom: async `initLinkStore()` at boot,
 * sync `snapshotLinks()` reads, optimistic write-through on `setLinked()`.
 *
 * One fact per unordered pair of distinct Tracks: the canonical key is
 * "low:high", so reads and writes are symmetric regardless of which Deck
 * holds which Track. Write-independent of Transition favorites — the
 * "goes well together" union is computed at query time, never stored.
 */
import { useSyncExternalStore } from 'react';
import { api } from '../api/client';

export type LinkKey = string; // "low:high"

/** Canonical unordered-pair key. */
export function linkKeyOf(aTrackId: number, bTrackId: number): LinkKey {
  return aTrackId < bTrackId ? `${aTrackId}:${bTrackId}` : `${bTrackId}:${aTrackId}`;
}

let snapshot: ReadonlySet<LinkKey> = new Set();
let initPromise: Promise<void> | null = null;
/** Pre-boot toggles, re-applied over the boot rows so a toggle racing the
 * boot GET is never silently reverted (the PUT persists it regardless). */
let pendingPreBoot: Map<LinkKey, boolean> | null = new Map();

/** Boot the store: one GET. Idempotent; never rejects — a dead backend
 * degrades to an empty snapshot with a logged error. */
export function initLinkStore(): Promise<void> {
  initPromise ??= doInit();
  return initPromise;
}

async function doInit(): Promise<void> {
  try {
    applyLinkRows(await api.trackLinks.list());
  } catch (err) {
    console.error('link store: boot load failed — starting empty', err);
  }
}

/** Replace the snapshot from persisted rows (boot load; tests), keeping
 * any toggles made before the load resolved. */
export function applyLinkRows(rows: { low_track_id: number; high_track_id: number }[]): void {
  const next = new Set(rows.map((r) => linkKeyOf(r.low_track_id, r.high_track_id)));
  for (const [key, linked] of pendingPreBoot ?? []) {
    if (linked) next.add(key);
    else next.delete(key);
  }
  pendingPreBoot = null; // booted: writes are authoritative from here on
  snapshot = next;
  notify();
}

/** The current Linked set. Empty until `initLinkStore()` resolves. */
export function snapshotLinks(): ReadonlySet<LinkKey> {
  return snapshot;
}

/** Is the unordered pair Linked? Symmetric; a Track is never self-Linked. */
export function isLinked(links: ReadonlySet<LinkKey>, aTrackId: number, bTrackId: number): boolean {
  return aTrackId !== bTrackId && links.has(linkKeyOf(aTrackId, bTrackId));
}

/**
 * Set or clear the Linked fact for an unordered pair: snapshot updates and
 * listeners fire synchronously (optimistic); the PUT runs in the
 * background. Write failures log only, matching pairStore. No-ops on
 * self-pairs and on writes that match the current state.
 */
export function setLinked(aTrackId: number, bTrackId: number, linked: boolean): void {
  if (aTrackId === bTrackId) return;
  const key = linkKeyOf(aTrackId, bTrackId);
  // The no-op guard only applies once booted: pre-boot the snapshot is
  // empty, but the server may not be — an "unlink" must still record and
  // push, or the boot rows would resurrect it.
  if (pendingPreBoot === null && snapshot.has(key) === linked) return;
  const next = new Set(snapshot);
  if (linked) next.add(key);
  else next.delete(key);
  snapshot = next;
  pendingPreBoot?.set(key, linked);
  notify();
  void push(aTrackId, bTrackId, linked);
}

/** Every Track id Linked with the given Track. */
export function linkedIdsOf(links: ReadonlySet<LinkKey>, trackId: number): Set<number> {
  const ids = new Set<number>();
  for (const key of links) {
    const [low, high] = key.split(':').map(Number);
    if (low === trackId) ids.add(high);
    else if (high === trackId) ids.add(low);
  }
  return ids;
}

async function push(aTrackId: number, bTrackId: number, linked: boolean): Promise<void> {
  try {
    await api.trackLinks.setPair(aTrackId, bTrackId, linked);
  } catch (err) {
    console.error(`link store: save failed for pair ${linkKeyOf(aTrackId, bTrackId)}`, err);
  }
}

// ── Change events (same-tab) ───────────────────────────────────────────

const listeners = new Set<() => void>();

export function subscribeLinks(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(): void {
  for (const fn of listeners) fn();
}

/** The Linked set as a React subscription. Self-booting (idempotent init),
 * matching useTransitionIndex's pattern. */
export function useLinks(): ReadonlySet<LinkKey> {
  void initLinkStore();
  return useSyncExternalStore(subscribeLinks, snapshotLinks);
}

/** Reset module state (tests only). */
export function _resetLinkStoreForTests(): void {
  snapshot = new Set();
  initPromise = null;
  pendingPreBoot = new Map();
  listeners.clear();
}
