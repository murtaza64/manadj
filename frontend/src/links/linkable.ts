/**
 * Linkable hint (linked-pairs 02): "this pair has a favorited Transition —
 * link them?" The hint is display-only and never auto-links (Favorite and
 * Linked are write-independent; the union is computed at query time).
 */
import { transitionsFrom } from '../editor/transitionIndex';
import type { TransitionIndex } from '../editor/transitionIndex';

/** Does the unordered pair have ≥1 favorited Transition, either direction?
 * Self and null pairs are never linkable. */
export function pairHasFavoritedTransition(
  index: TransitionIndex,
  aTrackId: number | null,
  bTrackId: number | null
): boolean {
  if (aTrackId === null || bTrackId === null || aTrackId === bTrackId) return false;
  return (
    (transitionsFrom(index, aTrackId).get(bTrackId)?.preferred ?? false) ||
    (transitionsFrom(index, bTrackId).get(aTrackId)?.preferred ?? false)
  );
}
