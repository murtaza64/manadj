/**
 * Deep-link into a Session's timeline at a moment (sessions 04) — the
 * Transition history's "view in Session" jump. Same request-stash +
 * CustomEvent shape as capture/takeReview.ts and editor/openPair.ts: the
 * requester stashes, App switches to the Sessions view, the Sessions view
 * consumes the pending request once mounted.
 */
export const OPEN_SESSION_EVENT = 'manadj:open-session';

export interface SessionMomentRequest {
  sessionUuid: string;
  /** Capture-clock seconds to center on (a Take's window start, usually);
   * null just opens the Session's timeline. */
  atS: number | null;
}

let pending: SessionMomentRequest | null = null;

/** REQUEST: stash the moment and ask the app to open the Sessions view. */
export function requestSessionMoment(req: SessionMomentRequest): void {
  pending = req;
  window.dispatchEvent(new CustomEvent(OPEN_SESSION_EVENT));
}

/** CONSUME (one-shot): the pending request, cleared on read. */
export function consumeSessionMoment(): SessionMomentRequest | null {
  const req = pending;
  pending = null;
  return req;
}
