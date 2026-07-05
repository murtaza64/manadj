/**
 * Adjacency model (sets 02) — pure functions under vitest.
 *
 * Each adjacency in a Set (ordered pair of neighboring entries) carries a
 * pin: a saved Transition (by uuid), a Take (by uuid — ADR 0023), or
 * nothing. Two orthogonal per-adjacency states fall out of pin + evidence:
 *
 * - UNRESOLVED: nothing pinned — playback will hard-cut. Also the
 *   degraded state of a dangling pin (its Transition/Take was deleted):
 *   library cleanup never corrupts a Set.
 * - UNPRACTICED: the ordered pair has zero saved Transitions AND zero
 *   Takes — the rehearsal to-do list.
 *
 * Auto-fill proposes Transitions only: the favorite first, else the sole
 * Transition, else nothing (several unfavorited siblings are ambiguous).
 * Takes are never auto-filled — pinning one is always a manual act.
 * Pins are stable: nothing here re-resolves on favoriting or new saves.
 */

export interface AdjacencyPin {
  kind: 'transition' | 'take';
  uuid: string;
}

/** A saved Transition for the pair, as the pin picker/badges need it. */
export interface TransitionEvidence {
  uuid: string;
  name: string;
  favorite?: boolean;
}

/** A Take for the pair (metadata only). */
export interface TakeEvidence {
  uuid: string;
  detectedAt: string;
}

export interface AdjacencyView {
  /** Resolved pin state: what plays at this handover. */
  status: 'transition' | 'take' | 'unresolved';
  /** The pinned Transition's evidence row (status 'transition'). */
  transition?: TransitionEvidence;
  /** The pinned Take's evidence row (status 'take'). */
  take?: TakeEvidence;
  /** The ordered pair has no saved Transition and no Take. */
  unpracticed: boolean;
  counts: { transitions: number; takes: number };
}

/** The Transition auto-fill would pin, or null when there is no
 * unambiguous choice: the first favorite, else the sole Transition. */
export function autoFillProposal(
  transitions: readonly TransitionEvidence[]
): TransitionEvidence | null {
  const favorite = transitions.find((t) => t.favorite);
  if (favorite) return favorite;
  return transitions.length === 1 ? transitions[0] : null;
}

/** Resolve one adjacency's pin against the pair's evidence. */
export function adjacencyView(
  pin: AdjacencyPin | null,
  transitions: readonly TransitionEvidence[],
  takes: readonly TakeEvidence[]
): AdjacencyView {
  const base = {
    unpracticed: transitions.length === 0 && takes.length === 0,
    counts: { transitions: transitions.length, takes: takes.length },
  };
  if (pin?.kind === 'transition') {
    const transition = transitions.find((t) => t.uuid === pin.uuid);
    if (transition) return { status: 'transition', transition, ...base };
  }
  if (pin?.kind === 'take') {
    const take = takes.find((t) => t.uuid === pin.uuid);
    if (take) return { status: 'take', take, ...base };
  }
  // No pin, or a dangling one (deleted Transition/Take): unresolved.
  return { status: 'unresolved', ...base };
}
