/**
 * Pair-edit handoff (sets 09): the Set view asks the app to open an
 * adjacency's ordered pair in the Transition editor. Same-tab, in-memory —
 * the request survives the view switch, not a reload (the takeReview.ts
 * pattern).
 */

/** window CustomEvent: a pair edit was requested (App switches view; an
 * already-mounted editor picks it up directly — walking a Set's handovers
 * swaps the pair without leaving the mode). */
export const OPEN_PAIR_EVENT = 'manadj:open-pair';

export interface PairEditRequest {
  /** Outgoing track — always presented as editor deck A. */
  aTrackId: number;
  /** Incoming track — editor deck B. */
  bTrackId: number;
  /** Saved Transition to select once the pair loads (a Transition pin);
   * null opens a blank sketch (unresolved adjacency). */
  transitionUuid: string | null;
}

let pending: PairEditRequest | null = null;

export function requestPairEdit(req: PairEditRequest): void {
  pending = req;
  window.dispatchEvent(new CustomEvent(OPEN_PAIR_EVENT));
}

/** One-shot: the editor consumes the pending request on mount/event. */
export function consumePairEdit(): PairEditRequest | null {
  const req = pending;
  pending = null;
  return req;
}
