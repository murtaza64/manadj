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
 *
 * Dormant pins (sets 07) are Set state under the same contract: every
 * order-changing mutation routes through the pure reconcile rule
 * (dormancy.ts) — broken pins go Dormant, newly-adjacent pairs restore
 * their memory — and the whole dormant list rides the same wholesale PUT.
 */
import { useSyncExternalStore } from 'react';
import { api } from '../api/client';
import { EMPTY_SELECTION, prune, type Selection } from '../selection/selectionModel';
import type { AdjacencyPin } from './adjacency';
import { reconcileOrderChange, type DormantPin } from './dormancy';

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
  /** Dormant pins per Set id (sets 07): broken-pin memories, strictly
   * per-Set, keyed by ordered track pair. Loaded with the entries. */
  dormantBySet: Record<number, DormantPin[]>;
  /** Row selection per Set id (sets 18): lives here, not in component
   * state, so the context menu, keyboard handlers, and group drag all
   * read the same selection — and it survives mode switches like the
   * scroll position does. Pruned whenever the Set's entries change. */
  selectionBySet: Record<number, Selection>;
}

let snapshot: SetStoreSnapshot = {
  selectedSetId: null,
  entriesBySet: {},
  dormantBySet: {},
  selectionBySet: {},
};

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
    const entries: SetEntryLocal[] = detail.entries.map((e) => ({
      trackId: e.track_id,
      pin:
        e.pin_kind === 'transition' || e.pin_kind === 'take'
          ? { kind: e.pin_kind, uuid: e.pin_uuid! }
          : null,
    }));
    const dormant: DormantPin[] = (detail.dormant ?? []).map((d) => ({
      aTrackId: d.a_track_id,
      bTrackId: d.b_track_id,
      pin: { kind: d.pin_kind, uuid: d.pin_uuid },
    }));
    // Normalize through the reconcile rule (sets 07): server state where
    // a Dormant memory covers a currently-adjacent pair (writable via
    // the API) restores/retires on read — the invariant "a pair never
    // carries two pins, and an adjacent pair's memory is awake" holds
    // from the first render. Consistent state passes through unchanged;
    // local-only (the next mutation pushes wholesale anyway).
    const normalized = reconcileOrderChange(
      entries,
      dormant,
      entries.map((e) => e.trackId)
    );
    setSetStateLocal(setId, normalized.entries, normalized.dormant);
  } catch (err) {
    console.error(`set store: entries load failed for set ${setId}`, err);
    if (!snapshot.entriesBySet[setId]) setSetStateLocal(setId, [], []);
  }
}

function setSetStateLocal(setId: number, entries: SetEntryLocal[], dormant: DormantPin[]): void {
  // Selected rows that left the Set drop out of the selection (sets 18)
  // — the one write point for entries is the one prune point.
  const selection = prune(
    getSetSelection(setId),
    entries.map((e) => e.trackId)
  );
  snapshot = {
    ...snapshot,
    entriesBySet: { ...snapshot.entriesBySet, [setId]: entries },
    dormantBySet: { ...snapshot.dormantBySet, [setId]: dormant },
    selectionBySet: { ...snapshot.selectionBySet, [setId]: selection },
  };
  notify();
}

// ── Row selection (sets 18) ────────────────────────────────────────────

/** The Set's row selection; EMPTY_SELECTION until someone selects. */
export function useSetSelection(setId: number): Selection {
  return useSyncExternalStore(
    subscribeSetStore,
    () => snapshot.selectionBySet[setId] ?? EMPTY_SELECTION
  );
}

export function getSetSelection(setId: number): Selection {
  return snapshot.selectionBySet[setId] ?? EMPTY_SELECTION;
}

export function setSetSelection(setId: number, selection: Selection): void {
  if (getSetSelection(setId) === selection) return;
  snapshot = {
    ...snapshot,
    selectionBySet: { ...snapshot.selectionBySet, [setId]: selection },
  };
  notify();
}

function currentDormant(setId: number): DormantPin[] {
  return snapshot.dormantBySet[setId] ?? [];
}

/** Replace a Set's entries (and, optionally, its Dormant pins): the
 * snapshot updates synchronously (optimistic), the wholesale PUT runs in
 * the background (ADR 0011: no retry queue). */
export function replaceSetEntries(
  setId: number,
  entries: SetEntryLocal[],
  dormant: DormantPin[] = currentDormant(setId)
): void {
  setSetStateLocal(setId, entries, dormant);
  void pushSetState(setId, entries, dormant);
}

async function pushSetState(
  setId: number,
  entries: SetEntryLocal[],
  dormant: DormantPin[]
): Promise<void> {
  try {
    await api.sets.replaceEntries(
      setId,
      entries.map((e) => ({
        track_id: e.trackId,
        pin_kind: e.pin?.kind ?? null,
        pin_uuid: e.pin?.uuid ?? null,
      })),
      dormant.map((d) => ({
        a_track_id: d.aTrackId,
        b_track_id: d.bTrackId,
        pin_kind: d.pin.kind,
        pin_uuid: d.pin.uuid,
      }))
    );
  } catch (err) {
    console.error(`set store: save failed for set ${setId}`, err);
  }
}

/** The Set's Dormant pins (sets 07), or undefined while unloaded. */
export function useSetDormantPins(setId: number): DormantPin[] | undefined {
  return useSyncExternalStore(subscribeSetStore, () => snapshot.dormantBySet[setId]);
}

export function getSetDormantPins(setId: number): DormantPin[] | undefined {
  return snapshot.dormantBySet[setId];
}

/** Route a track-order change through the dormancy reconcile rule
 * (sets 07): pins whose pair stays adjacent ride along, broken pins go
 * Dormant, newly-adjacent pairs restore their memory. */
function applyOrderChange(setId: number, newTrackIds: number[]): void {
  const entries = snapshot.entriesBySet[setId];
  if (!entries) return;
  const { entries: next, dormant } = reconcileOrderChange(
    entries,
    currentDormant(setId),
    newTrackIds
  );
  replaceSetEntries(setId, next, dormant);
}

/** Append the given tracks (skipping ones already in the Set — a Track
 * appears at most once). Loads first if needed. Returns the skip count.
 * A re-added track may restore Dormant pins (sets 07): its old pair's
 * memory wakes when the append makes them adjacent again. */
export async function addTracksToSet(setId: number, trackIds: number[]): Promise<number> {
  await ensureSetEntriesLoaded(setId);
  const entries = snapshot.entriesBySet[setId] ?? [];
  const present = new Set(entries.map((e) => e.trackId));
  const fresh = trackIds.filter((id) => !present.has(id));
  if (fresh.length > 0) {
    applyOrderChange(setId, [...entries.map((e) => e.trackId), ...fresh]);
  }
  return trackIds.length - fresh.length;
}

/** Pin (or unpin, with null) the adjacency headed by the given track.
 * An explicit pin retires any Dormant memory for the same ordered pair
 * (a pair never carries two pins); an explicit unpin destroys — only
 * reorder/removal breakage goes Dormant (sets 07). */
export function setAdjacencyPin(
  setId: number,
  headTrackId: number,
  pin: AdjacencyPin | null
): void {
  const entries = snapshot.entriesBySet[setId];
  if (!entries) return;
  const next = entries.map((e) => (e.trackId === headTrackId ? { ...e, pin } : e));
  const headIndex = entries.findIndex((e) => e.trackId === headTrackId);
  const nextTrackId = headIndex >= 0 ? entries[headIndex + 1]?.trackId : undefined;
  const dormant =
    pin !== null && nextTrackId !== undefined
      ? currentDormant(setId).filter(
          (d) => !(d.aTrackId === headTrackId && d.bTrackId === nextTrackId)
        )
      : currentDormant(setId);
  replaceSetEntries(setId, next, dormant);
}

/** Apply several pins at once (set-wide auto-fill accept), keyed by head
 * track id. Entries not in the map keep their pin. Like setAdjacencyPin,
 * each explicit pin retires any Dormant memory for its ordered pair. */
export function setAdjacencyPins(
  setId: number,
  pinsByHeadTrackId: ReadonlyMap<number, AdjacencyPin>
): void {
  const entries = snapshot.entriesBySet[setId];
  if (!entries) return;
  const pinnedPairs = new Set<string>();
  entries.forEach((e, i) => {
    const next = entries[i + 1];
    if (next && pinsByHeadTrackId.has(e.trackId)) {
      pinnedPairs.add(`${e.trackId}|${next.trackId}`);
    }
  });
  replaceSetEntries(
    setId,
    entries.map((e) => {
      const pin = pinsByHeadTrackId.get(e.trackId);
      return pin ? { ...e, pin } : e;
    }),
    currentDormant(setId).filter((d) => !pinnedPairs.has(`${d.aTrackId}|${d.bTrackId}`))
  );
}

/** Remove Tracks in one order change (the row ✕; sets 18's
 * Delete/Backspace on the selection and the multi context-menu Remove).
 * One reconcile pass (sets 07): broken adjacencies' pins go Dormant,
 * newly-touching survivors may restore their own memory. */
export function removeTracksFromSet(setId: number, trackIds: readonly number[]): void {
  const entries = snapshot.entriesBySet[setId];
  if (!entries || trackIds.length === 0) return;
  const drop = new Set(trackIds);
  const remaining = entries.filter((e) => !drop.has(e.trackId)).map((e) => e.trackId);
  if (remaining.length === entries.length) return;
  applyOrderChange(setId, remaining);
}

/** Reorder to the given track-id order (must be a permutation; ids
 * missing from the Set are dropped defensively). Non-destructive
 * (sets 07): broken pins go Dormant, re-formed pairs restore. */
export function reorderSetEntries(setId: number, orderedTrackIds: number[]): void {
  const entries = snapshot.entriesBySet[setId];
  if (!entries) return;
  const present = new Set(entries.map((e) => e.trackId));
  applyOrderChange(
    setId,
    orderedTrackIds.filter((id) => present.has(id))
  );
}

/** Insert a Track at the given entry index (sets 10: accepted insert
 * suggestion). No-op when the Track is already in the Set (a Track
 * appears at most once) or the Set is unloaded. The predecessor's pin
 * goes Dormant for its original ordered pair (sets 07) — it never
 * squats on the new adjacency, and returns if the insert is undone. */
export function insertTrackIntoSet(setId: number, trackId: number, index: number): void {
  const entries = snapshot.entriesBySet[setId];
  if (!entries) return;
  if (entries.some((e) => e.trackId === trackId)) return;
  const ids = entries.map((e) => e.trackId);
  ids.splice(Math.max(0, Math.min(index, ids.length)), 0, trackId);
  applyOrderChange(setId, ids);
}

/** Mirror the server's promotion re-pointing (sets 08, ADR 0023) in
 * every loaded Set: each Take pin with this uuid becomes a Transition
 * pin with the promoted uuid — Dormant memories included (sets 07).
 * Local-only — the promotion PATCH already rewrote the rows server-side;
 * without this mirror a later wholesale PUT from a loaded Set would
 * clobber the migration with the stale Take pin. */
export function repointTakePinsLocal(takeUuid: string, transitionUuid: string): void {
  let changed = false;
  const entriesBySet = { ...snapshot.entriesBySet };
  for (const [setId, entries] of Object.entries(entriesBySet)) {
    if (!entries.some((e) => e.pin?.kind === 'take' && e.pin.uuid === takeUuid)) continue;
    changed = true;
    entriesBySet[Number(setId)] = entries.map((e) =>
      e.pin?.kind === 'take' && e.pin.uuid === takeUuid
        ? { ...e, pin: { kind: 'transition', uuid: transitionUuid } }
        : e
    );
  }
  const dormantBySet = { ...snapshot.dormantBySet };
  for (const [setId, dormant] of Object.entries(dormantBySet)) {
    if (!dormant.some((d) => d.pin.kind === 'take' && d.pin.uuid === takeUuid)) continue;
    changed = true;
    dormantBySet[Number(setId)] = dormant.map((d) =>
      d.pin.kind === 'take' && d.pin.uuid === takeUuid
        ? { ...d, pin: { kind: 'transition', uuid: transitionUuid } }
        : d
    );
  }
  if (!changed) return;
  snapshot = { ...snapshot, entriesBySet, dormantBySet };
  notify();
}

/** Mirror the server's dangling-pin degradation (sets 12) in every
 * loaded Set: pins of the given kind referencing a deleted artifact go
 * Unresolved (null); Dormant memories of it are dropped outright
 * (sets 07 — a memory of a deleted artifact restores nothing).
 * Local-only — the deletion endpoint already handled its rows
 * server-side; without this mirror a later wholesale PUT from a loaded
 * Set would write the dangling reference back. */
export function degradeDeletedPinsLocal(kind: 'transition' | 'take', uuid: string): void {
  let changed = false;
  const entriesBySet = { ...snapshot.entriesBySet };
  for (const [setId, entries] of Object.entries(entriesBySet)) {
    if (!entries.some((e) => e.pin?.kind === kind && e.pin.uuid === uuid)) continue;
    changed = true;
    entriesBySet[Number(setId)] = entries.map((e) =>
      e.pin?.kind === kind && e.pin.uuid === uuid ? { ...e, pin: null } : e
    );
  }
  const dormantBySet = { ...snapshot.dormantBySet };
  for (const [setId, dormant] of Object.entries(dormantBySet)) {
    if (!dormant.some((d) => d.pin.kind === kind && d.pin.uuid === uuid)) continue;
    changed = true;
    dormantBySet[Number(setId)] = dormant.filter(
      (d) => !(d.pin.kind === kind && d.pin.uuid === uuid)
    );
  }
  if (!changed) return;
  snapshot = { ...snapshot, entriesBySet, dormantBySet };
  notify();
}

/** Forget a deleted Set's local state (selection cleared by the caller). */
export function dropSetLocalState(setId: number): void {
  loadPromises.delete(setId);
  scrollTopBySet.delete(setId);
  ladderViewBySet.delete(setId);
  if (snapshot.selectedSetId === setId) {
    snapshot = { ...snapshot, selectedSetId: null };
  }
  if (
    snapshot.entriesBySet[setId] ||
    snapshot.dormantBySet[setId] ||
    snapshot.selectionBySet[setId]
  ) {
    const entriesBySet = { ...snapshot.entriesBySet };
    const dormantBySet = { ...snapshot.dormantBySet };
    const selectionBySet = { ...snapshot.selectionBySet };
    delete entriesBySet[setId];
    delete dormantBySet[setId];
    delete selectionBySet[setId];
    snapshot = { ...snapshot, entriesBySet, dormantBySet, selectionBySet };
  }
  notify();
}

/** Reset module state (tests only). */
export function _resetSetStoreForTests(): void {
  snapshot = { selectedSetId: null, entriesBySet: {}, dormantBySet: {}, selectionBySet: {} };
  scrollTopBySet.clear();
  ladderViewBySet.clear();
  loadPromises.clear();
  listeners.clear();
}
