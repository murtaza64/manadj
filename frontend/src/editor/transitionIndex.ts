/**
 * Transition library index (transition-library 02): direction-aware
 * queries over the pair store. Only materialized Transitions exist in the
 * store (01's lazy persistence), so the index is honest by construction —
 * merely-opened pairs never produce marks.
 *
 * Prototype-scale: in-memory rebuild over the whole store on save events.
 */
import { useEffect, useState } from 'react';
import { initTransitionStore, snapshotPairStore, subscribePairStore } from './pairStore';
import type { PairStore } from './pairStore';

/** Per ordered pair: how many saved Transitions, and whether the pair is
 * Preferred (≥1 favorited Transition — always derived, never stored). */
export interface PairInfo {
  count: number;
  preferred: boolean;
}

export interface TransitionIndex {
  /** source trackId → (target trackId → info) */
  from: Map<number, Map<number, PairInfo>>;
  /** target trackId → (source trackId → info) */
  into: Map<number, Map<number, PairInfo>>;
}

export function buildTransitionIndex(store: PairStore): TransitionIndex {
  const from = new Map<number, Map<number, PairInfo>>();
  const into = new Map<number, Map<number, PairInfo>>();
  for (const [key, entry] of Object.entries(store)) {
    if (entry.items.length === 0) continue;
    const [a, b] = key.split(':').map(Number);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    const info: PairInfo = {
      count: entry.items.length,
      preferred: entry.items.some((i) => i.favorite),
    };
    if (!from.has(a)) from.set(a, new Map());
    from.get(a)!.set(b, info);
    if (!into.has(b)) into.set(b, new Map());
    into.get(b)!.set(a, info);
  }
  return { from, into };
}

const EMPTY: ReadonlyMap<number, PairInfo> = new Map();

/** Targets with a saved Transition FROM this track (outgoing). */
export function transitionsFrom(
  index: TransitionIndex,
  trackId: number | null | undefined
): ReadonlyMap<number, PairInfo> {
  return (trackId != null && index.from.get(trackId)) || EMPTY;
}

/** Sources with a saved Transition INTO this track (incoming — API only,
 * no UI in v1). */
export function transitionsInto(
  index: TransitionIndex,
  trackId: number | null | undefined
): ReadonlyMap<number, PairInfo> {
  return (trackId != null && index.into.get(trackId)) || EMPTY;
}

/** Live index: rebuilt on every pair-store write (save/favorite/delete).
 * Starts from the current snapshot (empty pre-boot) and fills in when the
 * store's init notify lands — marks appear once the DB load resolves. */
export function useTransitionIndex(): TransitionIndex {
  const [index, setIndex] = useState<TransitionIndex>(() =>
    buildTransitionIndex(snapshotPairStore())
  );
  useEffect(() => {
    void initTransitionStore();
    return subscribePairStore((store) => setIndex(buildTransitionIndex(store)));
  }, []);
  return index;
}
