/**
 * Set store (sets 01): Set-view state and the selected Sets' entries.
 *
 * Set-view state (selected Set, scroll position) lives HERE, not in
 * component state: every top-panel mode mounts its own browse instance
 * (App.tsx renders one Library per mode), and the PRD requires the Set
 * pane to survive mode switches unmoved — same rationale as followStore.
 *
 * Entries are client-authoritative (ADR 0011, mirroring pairStore): the
 * store owns a Set's ordered entry list once loaded; mutations update the
 * snapshot synchronously (optimistic) and replace the whole list on the
 * server in a background PUT, reconciled by track_id (a Track at most
 * once per Set — entry identity). Write failures log only.
 */
import { useSyncExternalStore } from 'react';
import { api } from '../api/client';
import type { AdjacencyPin } from './adjacency';

export interface SetEntryLocal {
  trackId: number;
  /** The pin of the adjacency this entry heads (sets 02): a Transition
   * uuid, a Take uuid, or null (Unresolved). Meaningless on the last
   * entry. Stable — only explicit user acts (pin/unpin/auto-fill accept)
   * change it; saving new Transitions for the pair never does. */
  pin: AdjacencyPin | null;
}

interface SetStoreSnapshot {
  selectedSetId: number | null;
  /** Ordered entries per Set id; absent = not loaded yet. */
  entriesBySet: Record<number, SetEntryLocal[]>;
}

let snapshot: SetStoreSnapshot = { selectedSetId: null, entriesBySet: {} };

/** Scroll position of the Set detail pane, per Set (session state — read
 * imperatively on mount, written on scroll; not reactive). */
const scrollTopBySet = new Map<number, number>();

/** Ladder viewport per Set (sets 05): zoom (1 = whole set fits) and pan.
 * Same session-state contract as the scroll position. */
export interface LadderView {
  zoom: number;
  scrollLeft: number;
}
const ladderViewBySet = new Map<number, LadderView>();

/** In-flight/completed entry loads, per Set (idempotence, pairStore-style). */
const loadPromises = new Map<number, Promise<void>>();

// ── Change events (same-tab) ───────────────────────────────────────────

const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of listeners) fn();
}

export function subscribeSetStore(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ── Set-view state ─────────────────────────────────────────────────────

export function getSelectedSetId(): number | null {
  return snapshot.selectedSetId;
}

export function selectSet(id: number | null): void {
  if (snapshot.selectedSetId === id) return;
  snapshot = { ...snapshot, selectedSetId: id };
  notify();
}

export function useSelectedSetId(): number | null {
  return useSyncExternalStore(subscribeSetStore, () => snapshot.selectedSetId);
}

export function getSetScroll(setId: number): number {
  return scrollTopBySet.get(setId) ?? 0;
}

export function setSetScroll(setId: number, top: number): void {
  scrollTopBySet.set(setId, top);
}

export function getLadderView(setId: number): LadderView {
  return ladderViewBySet.get(setId) ?? { zoom: 1, scrollLeft: 0 };
}

export function setLadderView(setId: number, view: LadderView): void {
  ladderViewBySet.set(setId, view);
}

// ── Entries (client-authoritative) ─────────────────────────────────────

/** The Set's ordered entries, or undefined while unloaded. */
export function useSetEntries(setId: number): SetEntryLocal[] | undefined {
  return useSyncExternalStore(subscribeSetStore, () => snapshot.entriesBySet[setId]);
}

export function getSetEntries(setId: number): SetEntryLocal[] | undefined {
  return snapshot.entriesBySet[setId];
}

/** Load a Set's entries into the store (idempotent per Set). After the
 * first load the store is authoritative — reloads never clobber local
 * state. Never rejects: a dead backend degrades to an empty list. */
export function ensureSetEntriesLoaded(setId: number): Promise<void> {
  let p = loadPromises.get(setId);
  if (!p) {
    p = doLoad(setId);
    loadPromises.set(setId, p);
  }
  return p;
}

async function doLoad(setId: number): Promise<void> {
  try {
    const detail = await api.sets.get(setId);
    if (snapshot.entriesBySet[setId]) return; // a local write beat the load
    setEntriesLocal(
      setId,
      detail.entries.map((e) => ({
        trackId: e.track_id,
        pin:
          e.pin_kind === 'transition' || e.pin_kind === 'take'
            ? { kind: e.pin_kind, uuid: e.pin_uuid! }
            : null,
      }))
    );
  } catch (err) {
    console.error(`set store: entries load failed for set ${setId}`, err);
    if (!snapshot.entriesBySet[setId]) setEntriesLocal(setId, []);
  }
}

function setEntriesLocal(setId: number, entries: SetEntryLocal[]): void {
  snapshot = {
    ...snapshot,
    entriesBySet: { ...snapshot.entriesBySet, [setId]: entries },
  };
  notify();
}

/** Replace a Set's entries: snapshot updates synchronously (optimistic),
 * the wholesale PUT runs in the background (ADR 0011: no retry queue). */
export function replaceSetEntries(setId: number, entries: SetEntryLocal[]): void {
  setEntriesLocal(setId, entries);
  void pushEntries(setId, entries);
}

async function pushEntries(setId: number, entries: SetEntryLocal[]): Promise<void> {
  try {
    await api.sets.replaceEntries(
      setId,
      entries.map((e) => ({
        track_id: e.trackId,
        pin_kind: e.pin?.kind ?? null,
        pin_uuid: e.pin?.uuid ?? null,
      }))
    );
  } catch (err) {
    console.error(`set store: save failed for set ${setId}`, err);
  }
}

/** Append the given tracks (skipping ones already in the Set — a Track
 * appears at most once). Loads first if needed. Returns the skip count. */
export async function addTracksToSet(setId: number, trackIds: number[]): Promise<number> {
  await ensureSetEntriesLoaded(setId);
  const entries = snapshot.entriesBySet[setId] ?? [];
  const present = new Set(entries.map((e) => e.trackId));
  const fresh = trackIds.filter((id) => !present.has(id));
  if (fresh.length > 0) {
    replaceSetEntries(setId, [...entries, ...fresh.map((trackId) => ({ trackId, pin: null }))]);
  }
  return trackIds.length - fresh.length;
}

/** Pin (or unpin, with null) the adjacency headed by the given track. */
export function setAdjacencyPin(
  setId: number,
  headTrackId: number,
  pin: AdjacencyPin | null
): void {
  const entries = snapshot.entriesBySet[setId];
  if (!entries) return;
  replaceSetEntries(
    setId,
    entries.map((e) => (e.trackId === headTrackId ? { ...e, pin } : e))
  );
}

/** Apply several pins at once (set-wide auto-fill accept), keyed by head
 * track id. Entries not in the map keep their pin. */
export function setAdjacencyPins(
  setId: number,
  pinsByHeadTrackId: ReadonlyMap<number, AdjacencyPin>
): void {
  const entries = snapshot.entriesBySet[setId];
  if (!entries) return;
  replaceSetEntries(
    setId,
    entries.map((e) => {
      const pin = pinsByHeadTrackId.get(e.trackId);
      return pin ? { ...e, pin } : e;
    })
  );
}

export function removeTrackFromSet(setId: number, trackId: number): void {
  const entries = snapshot.entriesBySet[setId];
  if (!entries) return;
  replaceSetEntries(setId, entries.filter((e) => e.trackId !== trackId));
}

/** Reorder to the given track-id order (must be a permutation; entries
 * whose ids are missing from the order are dropped defensively). */
export function reorderSetEntries(setId: number, orderedTrackIds: number[]): void {
  const entries = snapshot.entriesBySet[setId];
  if (!entries) return;
  const byId = new Map(entries.map((e) => [e.trackId, e]));
  const next = orderedTrackIds
    .map((id) => byId.get(id))
    .filter((e): e is SetEntryLocal => e !== undefined);
  replaceSetEntries(setId, next);
}

/** Insert a Track at the given entry index (sets 10: accepted insert
 * suggestion). No-op when the Track is already in the Set (a Track
 * appears at most once) or the Set is unloaded. The predecessor entry's
 * pin rides along untouched (the reorder policy): it degrades to an
 * unresolved display for the new pair, never gets destroyed. */
export function insertTrackIntoSet(setId: number, trackId: number, index: number): void {
  const entries = snapshot.entriesBySet[setId];
  if (!entries) return;
  if (entries.some((e) => e.trackId === trackId)) return;
  const next = [...entries];
  next.splice(Math.max(0, Math.min(index, next.length)), 0, { trackId, pin: null });
  replaceSetEntries(setId, next);
}

/** Forget a deleted Set's local state (selection cleared by the caller). */
export function dropSetLocalState(setId: number): void {
  loadPromises.delete(setId);
  scrollTopBySet.delete(setId);
  ladderViewBySet.delete(setId);
  if (snapshot.selectedSetId === setId) {
    snapshot = { ...snapshot, selectedSetId: null };
  }
  if (snapshot.entriesBySet[setId]) {
    const entriesBySet = { ...snapshot.entriesBySet };
    delete entriesBySet[setId];
    snapshot = { ...snapshot, entriesBySet };
  }
  notify();
}

/** Reset module state (tests only). */
export function _resetSetStoreForTests(): void {
  snapshot = { selectedSetId: null, entriesBySet: {} };
  scrollTopBySet.clear();
  ladderViewBySet.clear();
  loadPromises.clear();
  listeners.clear();
}
