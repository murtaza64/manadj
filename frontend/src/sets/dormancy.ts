/**
 * Dormant pins (sets 07) — pure functions under vitest.
 *
 * A Dormant pin is a Set's memory of a pin whose adjacency was broken by
 * reordering or removal: kept per ORDERED pair, per Set, and restored
 * automatically when that pair becomes adjacent in that Set again
 * (restoring a manually-pinned Take honors the original manual act).
 * Nothing is ever destroyed by reorder — there is no discard warning.
 *
 * `reconcileOrderChange` is the single rule for what happens to pins
 * when a Set's track order changes (reorder, insert, remove, re-add):
 * pins whose ordered pair stays adjacent ride along; broken pins go
 * Dormant; newly-adjacent pairs consume their Dormant memory. Exported
 * and pure on purpose — issue 18's multi-row blocks reuse it.
 *
 * `previewAdjacencyFutures` classifies a HYPOTHETICAL order's affected
 * adjacencies for the live drag preview: will-restore (a Dormant pin
 * waits) / auto-fillable (a library Transition exists for the pair) /
 * unresolved; unaffected adjacencies are null.
 */
import type { AdjacencyPin } from './adjacency';

/** An ordered Set entry as dormancy sees it: the track plus the pin of
 * the adjacency it heads (structurally `SetEntryLocal`). */
export interface OrderedEntry {
  trackId: number;
  pin: AdjacencyPin | null;
}

/** A Set's memory of a broken pin, keyed by the ORDERED track pair. */
export interface DormantPin {
  aTrackId: number;
  bTrackId: number;
  pin: AdjacencyPin;
}

const key = (a: number, b: number): string => `${a}|${b}`;

/**
 * Apply a track-order change to a Set's pins and Dormant memories.
 *
 * `newTrackIds` is the full new order — it may drop ids (removal) and
 * introduce ids absent from `oldEntries` (insert/re-add). For each new
 * adjacency: a pin whose ordered pair was already adjacent rides along;
 * else a Dormant pin for the pair restores (consuming the memory).
 * Every broken pin becomes a Dormant pin for its original ordered pair
 * (a fresh break overwrites an older memory). Memories whose pair stays
 * non-adjacent survive untouched — even when their tracks leave the Set.
 */
export function reconcileOrderChange(
  oldEntries: readonly OrderedEntry[],
  oldDormant: readonly DormantPin[],
  newTrackIds: readonly number[]
): { entries: OrderedEntry[]; dormant: DormantPin[] } {
  // Pins on the old adjacencies (the last entry's pin is meaningless).
  const oldPairPins = new Map<string, AdjacencyPin>();
  for (let i = 0; i < oldEntries.length - 1; i++) {
    const pin = oldEntries[i].pin;
    if (pin) oldPairPins.set(key(oldEntries[i].trackId, oldEntries[i + 1].trackId), pin);
  }

  const dormantByPair = new Map<string, DormantPin>();
  for (const d of oldDormant) dormantByPair.set(key(d.aTrackId, d.bTrackId), d);

  const entries: OrderedEntry[] = newTrackIds.map((trackId) => ({ trackId, pin: null }));
  for (let i = 0; i < entries.length - 1; i++) {
    const k = key(entries[i].trackId, entries[i + 1].trackId);
    const kept = oldPairPins.get(k);
    if (kept) {
      // Still adjacent: the pin rides along. A stale Dormant memory for
      // the same pair is dropped — a pair never carries two pins.
      entries[i].pin = kept;
      oldPairPins.delete(k);
      dormantByPair.delete(k);
      continue;
    }
    const dormant = dormantByPair.get(k);
    if (dormant) {
      entries[i].pin = dormant.pin;
      dormantByPair.delete(k);
    }
  }

  // Broken pins go Dormant (a fresh break overwrites an older memory).
  for (const [k, pin] of oldPairPins) {
    const [aTrackId, bTrackId] = k.split('|').map(Number);
    dormantByPair.set(k, { aTrackId, bTrackId, pin });
  }

  return { entries, dormant: [...dormantByPair.values()] };
}

/** One hypothetical adjacency's future under a drag preview; null =
 * unaffected (the ordered pair is adjacent in the committed order too). */
export type AdjacencyFuture = 'will-restore' | 'auto-fillable' | 'unresolved';

/** The will-restore preview color (ladder frames and list markers share
 * it). Violet is unclaimed on purpose: cyan/magenta are Deck identity,
 * never state — CONTEXT.md "Deck color". */
export const WILL_RESTORE_COLOR = '#b400ff';

/**
 * Classify each adjacency of a hypothetical order for the live drag
 * preview, index-aligned with the hypothetical plan's adjacencies.
 */
export function previewAdjacencyFutures(
  oldEntries: readonly OrderedEntry[],
  oldDormant: readonly DormantPin[],
  newTrackIds: readonly number[],
  /** A library Transition exists for the ordered pair (auto-fillable). */
  hasLibraryTransition: (aTrackId: number, bTrackId: number) => boolean
): (AdjacencyFuture | null)[] {
  const oldAdjacent = new Set<string>();
  for (let i = 0; i < oldEntries.length - 1; i++) {
    oldAdjacent.add(key(oldEntries[i].trackId, oldEntries[i + 1].trackId));
  }
  const dormantPairs = new Set(oldDormant.map((d) => key(d.aTrackId, d.bTrackId)));

  const futures: (AdjacencyFuture | null)[] = [];
  for (let i = 0; i < newTrackIds.length - 1; i++) {
    const a = newTrackIds[i];
    const b = newTrackIds[i + 1];
    if (oldAdjacent.has(key(a, b))) {
      futures.push(null);
    } else if (dormantPairs.has(key(a, b))) {
      futures.push('will-restore');
    } else {
      futures.push(hasLibraryTransition(a, b) ? 'auto-fillable' : 'unresolved');
    }
  }
  return futures;
}
