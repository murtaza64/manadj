/**
 * Take-review handoff (transition-takes 03): the Transition history asks
 * the app to open a Take in the Transition editor. Same-tab, in-memory —
 * the request survives the view switch, not a reload.
 */

/** window CustomEvent: a Take review was requested (App switches view;
 * an already-mounted editor picks it up directly). */
export const OPEN_TAKE_EVENT = 'manadj:open-take';

let pendingTakeUuid: string | null = null;

export function requestTakeReview(uuid: string): void {
  pendingTakeUuid = uuid;
  window.dispatchEvent(new CustomEvent(OPEN_TAKE_EVENT));
}

/** One-shot: the editor consumes the pending request on mount/event. */
export function consumeTakeReview(): string | null {
  const uuid = pendingTakeUuid;
  pendingTakeUuid = null;
  return uuid;
}
