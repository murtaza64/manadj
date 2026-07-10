/**
 * Set-building suggestions (sets 10) — pure ranking beside the Follow
 * model, sharing its ONE total edge order (match-score PRD): Known strata
 * in Known-strength order, then Compatible descending by Match score,
 * below-floor excluded. Honors Transition directionality.
 *
 * The unit here is the ORDERED EDGE from → to: append ranks candidates by
 * the edge out of the Set's last Track; insert scores both edges (out of
 * the predecessor, into the successor) and ranks by the weaker edge,
 * tie-breaking by the stronger. Known strengths arrive as caller-built
 * lookups (links/known.ts over the transition index's direction-aware
 * maps), so direction is the caller's contract: `knownOutOf*` means
 * anchor→candidate, `knownInto*` means candidate→anchor.
 *
 * The Affinity floor is the cut (it replaced the old rest-tier cut): an
 * unadmitted edge never appears. Inserts demand BOTH edges admitted — the
 * old rule cut on the weaker edge, and an inadmissible handover on either
 * side is exactly that.
 */
import type { Track } from '../types';
import { compareRanks, rankAgainst, type CandidateRank } from './matchScore';

/** A known strength for one ordered edge, or null (not Known). */
export type EdgeKnownLookup = (candidateId: number) => number | null;

/**
 * Rank of the ordered edge from → to: its Known strength when it has one,
 * else the Match score of `to` against `from` — matchScore.ts semantics
 * throughout (an edge rank IS rankAgainst with a single-edge reference
 * whose reference Track is the edge's `from` side).
 */
export function edgeRank(from: Track, to: Track, knownStrength: number | null): CandidateRank {
  return rankAgainst(to, [{ track: from, knownStrength: () => knownStrength }]);
}

export interface AppendSuggestion {
  track: Track;
  /** Edge rank out of the last Track (rankLabel/score name it). */
  rank: CandidateRank;
}

/**
 * Rank append candidates by the edge out of the Set's last Track.
 * Tracks already in the Set never appear; unadmitted edges are cut (the
 * floor); the sort is stable, so the incoming order holds within ties.
 */
export function suggestAppend(
  candidates: readonly Track[],
  inSetIds: ReadonlySet<number>,
  last: Track,
  knownOutOfLast: EdgeKnownLookup
): AppendSuggestion[] {
  return candidates
    .filter((t) => !inSetIds.has(t.id))
    .map((track) => ({ track, rank: edgeRank(last, track, knownOutOfLast(track.id)) }))
    .filter((s) => s.rank.admitted)
    .sort((a, b) => compareRanks(a.rank, b.rank));
}

export interface InsertSuggestion {
  track: Track;
  /** Edge rank out of the predecessor (predecessor → candidate). */
  outRank: CandidateRank;
  /** Edge rank into the successor (candidate → successor). */
  inRank: CandidateRank;
}

/** An insert is judged by its worst handover (PRD): the edge that ranks
 * LATER in the shared order. */
export function weakerRank(s: Pick<InsertSuggestion, 'outRank' | 'inRank'>): CandidateRank {
  return compareRanks(s.outRank, s.inRank) >= 0 ? s.outRank : s.inRank;
}

function strongerRank(s: Pick<InsertSuggestion, 'outRank' | 'inRank'>): CandidateRank {
  return compareRanks(s.outRank, s.inRank) < 0 ? s.outRank : s.inRank;
}

/**
 * Rank insert candidates for the adjacency predecessor → successor:
 * score both edges, order by the weaker edge, tie-break by the stronger.
 * Both edges must be admitted. Stable within full ties; in-Set Tracks
 * excluded.
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
      outRank: edgeRank(predecessor, track, knownOutOfPredecessor(track.id)),
      inRank: edgeRank(track, successor, knownIntoSuccessor(track.id)),
    }))
    .filter((s) => s.outRank.admitted && s.inRank.admitted)
    .sort(
      (a, b) =>
        compareRanks(weakerRank(a), weakerRank(b)) ||
        compareRanks(strongerRank(a), strongerRank(b))
    );
}
