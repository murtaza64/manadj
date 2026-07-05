/**
 * Known (linked-pairs 04, glossary): the relation between two Tracks when
 * they are Linked or a saved Transition connects them — discovery's
 * confirmed evidence tier, as opposed to the heuristic Compatible tier.
 *
 * Strength within the tier: favorited Transition, then Linked, then
 * unfavorited Transition; a pair takes its best. In follow semantics the
 * Transition side is directional (FROM the followed reference) while
 * Linked is symmetric.
 */
import type { PairInfo } from '../editor/transitionIndex';
import { isLinked } from './linkStore';
import type { LinkKey } from './linkStore';

/** Known strengths, ascending = stronger first (sortable as tiers). */
export const KNOWN_FAVORITED = 0;
export const KNOWN_LINKED = 1;
export const KNOWN_SAVED = 2;
export type KnownStrength = typeof KNOWN_FAVORITED | typeof KNOWN_LINKED | typeof KNOWN_SAVED;

/**
 * The candidate's Known strength relative to a reference Track, or null
 * when the pair is not Known. `fromRef` is the transition index's map for
 * Transitions FROM the reference.
 */
export function knownStrengthOf(
  fromRef: ReadonlyMap<number, PairInfo>,
  links: ReadonlySet<LinkKey>,
  refTrackId: number,
  candidateId: number
): KnownStrength | null {
  const info = fromRef.get(candidateId);
  if (info?.preferred) return KNOWN_FAVORITED;
  if (isLinked(links, refTrackId, candidateId)) return KNOWN_LINKED;
  if (info) return KNOWN_SAVED;
  return null;
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
