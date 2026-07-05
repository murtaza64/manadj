/**
 * Set-building suggestions (sets 10) — pure ranking beside the Follow
 * model, reusing its tiering wholesale (known tier: favorited Transition,
 * Linked, unfavorited Transition; then Compatible key tiers), honoring
 * Transition directionality.
 *
 * The unit here is the ORDERED EDGE from → to: append ranks candidates by
 * the edge out of the Set's last Track; insert scores both edges (out of
 * the predecessor, into the successor) and ranks by the weaker edge,
 * tie-breaking by the stronger. Known strengths arrive as caller-built
 * lookups (links/known.ts over the transition index's direction-aware
 * maps), so direction is the caller's contract: `knownOutOf*` means
 * anchor→candidate, `knownInto*` means candidate→anchor.
 *
 * Tier numbers stay in lockstep with model.ts (tierLabel names them) by
 * construction — an edge tier IS followTier against a single-edge
 * reference whose reference Track is the edge's `from` side.
 */
import type { Track } from '../types';
import { followTier } from './model';

/** A known strength for one ordered edge, or null (not Known). */
export type EdgeKnownLookup = (candidateId: number) => number | null;

/**
 * Tier of the ordered edge from → to: the edge's known strength when it
 * has one, else the key relation of `to` relative to `from` (same,
 * relative, one up, one down, rest) — model.ts numbering throughout.
 */
export function edgeTier(from: Track, to: Track, knownStrength: number | null): number {
  return followTier(to, [{ track: from, knownStrength: () => knownStrength }]);
}

export interface AppendSuggestion {
  track: Track;
  /** Edge tier out of the last Track (tierLabel names it). */
  tier: number;
}

/**
 * Rank append candidates by the edge out of the Set's last Track.
 * Tracks already in the Set never appear; the sort is stable, so the
 * incoming order holds within a tier.
 */
export function suggestAppend(
  candidates: readonly Track[],
  inSetIds: ReadonlySet<number>,
  last: Track,
  knownOutOfLast: EdgeKnownLookup
): AppendSuggestion[] {
  return candidates
    .filter((t) => !inSetIds.has(t.id))
    .map((track) => ({ track, tier: edgeTier(last, track, knownOutOfLast(track.id)) }))
    .sort((a, b) => a.tier - b.tier);
}

export interface InsertSuggestion {
  track: Track;
  /** Edge tier out of the predecessor (predecessor → candidate). */
  outTier: number;
  /** Edge tier into the successor (candidate → successor). */
  inTier: number;
}

/** An insert is judged by its worst handover (PRD). */
export function weakerTier(s: Pick<InsertSuggestion, 'outTier' | 'inTier'>): number {
  return Math.max(s.outTier, s.inTier);
}

/**
 * Rank insert candidates for the adjacency predecessor → successor:
 * score both edges, order by the weaker edge, tie-break by the stronger.
 * Stable within full ties; in-Set Tracks excluded.
 */
export function suggestInsert(
  candidates: readonly Track[],
  inSetIds: ReadonlySet<number>,
  predecessor: Track,
  successor: Track,
  knownOutOfPredecessor: EdgeKnownLookup,
  knownIntoSuccessor: EdgeKnownLookup
): InsertSuggestion[] {
  return candidates
    .filter((t) => !inSetIds.has(t.id))
    .map((track) => ({
      track,
      outTier: edgeTier(predecessor, track, knownOutOfPredecessor(track.id)),
      inTier: edgeTier(track, successor, knownIntoSuccessor(track.id)),
    }))
    .sort(
      (a, b) =>
        weakerTier(a) - weakerTier(b) ||
        Math.min(a.outTier, a.inTier) - Math.min(b.outTier, b.inTier)
    );
}
