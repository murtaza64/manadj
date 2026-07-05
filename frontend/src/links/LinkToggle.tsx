/**
 * Link toggle (linked-pairs 01): the chain-link button asserting "these
 * two Tracks go well together" for the loaded pair. Symmetric — deck
 * assignment and A/B order never matter. Disabled without a distinct
 * loaded pair (no self-links). Optimistic via linkStore.
 */
import { isLinked, setLinked, useLinks } from './linkStore';

export function LinkToggle({
  aTrackId,
  bTrackId,
}: {
  aTrackId: number | null;
  bTrackId: number | null;
}) {
  const links = useLinks();
  const canToggle = aTrackId !== null && bTrackId !== null && aTrackId !== bTrackId;
  const linked = canToggle && isLinked(links, aTrackId, bTrackId);

  const title = !canToggle
    ? aTrackId !== null && aTrackId === bTrackId
      ? 'A Track cannot be Linked to itself'
      : 'Load two tracks to link them'
    : linked
      ? 'Unlink: these Tracks no longer go well together'
      : 'Link: these Tracks go well together';

  return (
    <button
      className={`link-toggle${linked ? ' on' : ''}`}
      aria-pressed={linked}
      disabled={!canToggle}
      title={title}
      onClick={() => canToggle && setLinked(aTrackId, bTrackId, !linked)}
    >
      🔗
    </button>
  );
}
