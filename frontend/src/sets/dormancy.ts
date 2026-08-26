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
 * waits) / auto-resolves (a library Transition exists for the pair —
 * plan-time resolution will play it, sets 26) / unresolved (will cut);
 * unaffected adjacencies are null.
 *
 * Routine pins (sets 160, ADR 0035) reconcile by their OWN rule, not
 * the ordered-pair rule: dormancy keys on the boundary tracks + cast
 * membership only. A routine pin stays live exactly while its cast is
 * the next n entries from its head (interior reorder is FREE — the
 * recorded choreography defines interior play order; interior Set order
 * is presentational). Breaking a boundary or the membership sends it
 * Dormant, keyed (entry track, exit track); it restores when the cast
 * is the next n entries again — never on plain pair adjacency. While a
 * routine pin rides its head adjacency, that pair's Dormant memory is
 * KEPT (the shadow of the pin the routine displaced — restored on
 * unpin/Dormant); covered interior pins stay in the entries, shadowed
 * at read time.
 */
import type { AdjacencyPin, RoutineCastLookup } from './adjacency';
import { routineOfferable } from './adjacency';
import type { CameoPin } from './cameoPins';

/** An ordered Set entry as dormancy sees it: the track plus the pin of
 * the adjacency it heads (structurally `SetEntryLocal`). Trim (sets
 * #164) and Cameo pins (#140) are per-TRACK entry state, not adjacency
 * state — the reconcile carries them along untouched (dormancy here is
 * an adjacency-pin rule only; Cameo-pin dormancy for REMOVED hosts is
 * cameoPins.ts's reconcile, layered by the store). */
export interface OrderedEntry {
  trackId: number;
  pin: AdjacencyPin | null;
  /** Trim offset from neutral (sets #164); absent = neutral. */
  trim?: number;
  /** Cameo pins (#140); ride with their track through any reorder. */
  cameoPins?: CameoPin[];
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
  newTrackIds: readonly number[],
  /** Routine casts (sets 160): needed to evaluate routine-pin liveness.
   * Absent/null cast = liveness unknowable — the pin rides on its head
   * entry unchanged (never guessed Dormant on missing metadata). */
  castOf?: RoutineCastLookup
): { entries: OrderedEntry[]; dormant: DormantPin[] } {
  // Routine pins reconcile by the boundary+membership rule (below);
  // everything else is pinned to its ordered pair.
  const oldPairPins = new Map<string, AdjacencyPin>();
  const oldRoutinePins: { headTrackId: number; pin: AdjacencyPin }[] = [];
  for (let i = 0; i < oldEntries.length - 1; i++) {
    const pin = oldEntries[i].pin;
    if (!pin) continue;
    if (pin.kind === 'routine') {
      oldRoutinePins.push({ headTrackId: oldEntries[i].trackId, pin });
    } else {
      oldPairPins.set(key(oldEntries[i].trackId, oldEntries[i + 1].trackId), pin);
    }
  }

  const dormantByPair = new Map<string, DormantPin>();
  for (const d of oldDormant) dormantByPair.set(key(d.aTrackId, d.bTrackId), d);

  // Entry state that is not pin state (trim, Cameo pins) rides with its
  // track. (A REMOVED host's Cameo pins are cameoPins.ts's business.)
  const oldByTrackId = new Map(oldEntries.map((e) => [e.trackId, e]));
  const entries: OrderedEntry[] = newTrackIds.map((trackId) => ({
    trackId,
    pin: null,
    trim: oldByTrackId.get(trackId)?.trim,
    cameoPins: oldByTrackId.get(trackId)?.cameoPins,
  }));

  /** A routine pin is live at head index j when its cast is the next n
   * entries (membership + boundaries — routineOfferable IS the rule). */
  const routineLiveAt = (cast: readonly number[]): number => {
    const j = newTrackIds.indexOf(cast[0]);
    return j >= 0 && routineOfferable(newTrackIds, j, cast) ? j : -1;
  };

  // Pass 1 — riding routine pins claim their head entries. Their head
  // pair's Dormant memory is NOT dropped: it is the shadow of the pin
  // the routine displaced (restored on unpin/Dormant).
  const claimed = new Set<number>();
  for (const { headTrackId, pin } of oldRoutinePins) {
    const cast = (pin.uuid !== undefined ? castOf?.(pin.uuid) : null) ?? null;
    if (!cast) {
      // Liveness unknowable: ride on the head entry if it survived.
      const j = newTrackIds.indexOf(headTrackId);
      if (j >= 0 && j < entries.length - 1 && !claimed.has(j)) {
        entries[j].pin = pin;
        claimed.add(j);
      }
      continue;
    }
    const j = routineLiveAt(cast);
    if (j >= 0 && !claimed.has(j)) {
      entries[j].pin = pin;
      claimed.add(j);
    } else {
      // Boundary/membership broken: Dormant, keyed by the BOUNDARY
      // tracks (a fresh break overwrites an older memory).
      const aTrackId = cast[0];
      const bTrackId = cast[cast.length - 1];
      dormantByPair.set(key(aTrackId, bTrackId), { aTrackId, bTrackId, pin });
    }
  }

  // Pass 2 — surviving ordered-pair pins ride along. A stale Dormant
  // memory for a ridden pair is dropped (a pair never carries two pins)
  // — UNLESS a routine claimed the adjacency: its head-pair memory is
  // the shadow, kept above.
  for (let i = 0; i < entries.length - 1; i++) {
    if (claimed.has(i)) continue;
    const k = key(entries[i].trackId, entries[i + 1].trackId);
    const kept = oldPairPins.get(k);
    if (kept) {
      entries[i].pin = kept;
      oldPairPins.delete(k);
      dormantByPair.delete(k);
    }
  }

  // Broken ordered-pair pins go Dormant (fresh break overwrites).
  for (const [k, pin] of oldPairPins) {
    const [aTrackId, bTrackId] = k.split('|').map(Number);
    dormantByPair.set(k, { aTrackId, bTrackId, pin });
  }

  // Pass 3 — Dormant routine memories wake when the cast is the next n
  // entries again and no explicit pin rode onto the head adjacency.
  // They outrank pair-memory restores (the routine displaced that pin;
  // waking re-shadows it) but never displace a riding pin. Routine
  // memories NEVER wake on plain pair adjacency of (entry, exit) — that
  // means the interior is gone, the opposite of their condition.
  for (const [k, d] of dormantByPair) {
    if (d.pin.kind !== 'routine') continue;
    const cast = castOf?.(d.pin.uuid) ?? null;
    if (!cast) continue;
    const j = routineLiveAt(cast);
    if (j >= 0 && j < entries.length - 1 && entries[j].pin === null && !claimed.has(j)) {
      entries[j].pin = d.pin;
      claimed.add(j);
      dormantByPair.delete(k);
    }
  }

  // Pass 4 — remaining Dormant pair memories restore on their pair
  // becoming adjacent again (skipping routine-claimed heads: those
  // memories stay shadowed under the routine).
  for (let i = 0; i < entries.length - 1; i++) {
    if (entries[i].pin !== null || claimed.has(i)) continue;
    const k = key(entries[i].trackId, entries[i + 1].trackId);
    const dormant = dormantByPair.get(k);
    if (dormant && dormant.pin.kind !== 'routine') {
      entries[i].pin = dormant.pin;
      dormantByPair.delete(k);
    }
  }

  return { entries, dormant: [...dormantByPair.values()] };
}

/** One hypothetical adjacency's future under a drag preview; null =
 * unaffected (the ordered pair is adjacent in the committed order too). */
export type AdjacencyFuture = 'will-restore' | 'auto-resolves' | 'unresolved';

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
  /** A library Transition exists for the ordered pair (auto-resolves). */
  hasLibraryTransition: (aTrackId: number, bTrackId: number) => boolean
): (AdjacencyFuture | null)[] {
  const oldAdjacent = new Set<string>();
  for (let i = 0; i < oldEntries.length - 1; i++) {
    oldAdjacent.add(key(oldEntries[i].trackId, oldEntries[i + 1].trackId));
  }
  // Routine memories are keyed by BOUNDARY tracks, not an adjacency —
  // pair adjacency never restores them, so they never preview (sets 160).
  const dormantPairs = new Set(
    oldDormant.filter((d) => d.pin.kind !== 'routine').map((d) => key(d.aTrackId, d.bTrackId))
  );

  const futures: (AdjacencyFuture | null)[] = [];
  for (let i = 0; i < newTrackIds.length - 1; i++) {
    const a = newTrackIds[i];
    const b = newTrackIds[i + 1];
    if (oldAdjacent.has(key(a, b))) {
      futures.push(null);
    } else if (dormantPairs.has(key(a, b))) {
      futures.push('will-restore');
    } else {
      futures.push(hasLibraryTransition(a, b) ? 'auto-resolves' : 'unresolved');
    }
  }
  return futures;
}
