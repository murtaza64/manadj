/**
 * Session selection + deep-link into the Library's session pane
 * (sessions 04, library integration) — the navigateToSet shape exactly:
 * a durable module-store half (a fresh Library mount seeds from it) and a
 * live CustomEvent half (an already-mounted Library nudges its local
 * view state). The one-shot focus moment (a Take's window start) rides
 * beside the selection for the timeline's focusS.
 */

export const OPEN_SESSION_EVENT = 'manadj:open-session';

let selectedUuid: string | null = null;
let pendingFocusS: number | null = null;
let pendingSpanS: number | null = null;
let pendingFlash: { start: number; end: number } | null = null;

export function getSelectedSessionUuid(): string | null {
  return selectedUuid;
}

/** Durable selection write (the Library's session pane authority). */
export function selectSession(uuid: string | null): void {
  selectedUuid = uuid;
  if (uuid === null) {
    pendingFocusS = null;
    pendingSpanS = null;
    pendingFlash = null;
  }
}

export interface SessionMomentRequest {
  sessionUuid: string;
  /** Capture-clock seconds to center on (a Take's window start, the replay
   * playhead); null just opens the Session's timeline. */
  atS: number | null;
  /** Zoom request (sessions 16): show at most this many seconds around the
   * moment — the timeline raises pxPerSec to viewportW/spanS (never below
   * fit). Null keeps the current/fit zoom. */
  spanS?: number | null;
  /** Momentary region highlight (gh#170 provenance deep-link): the
   * timeline pulses this capture-clock span once on arrival — the
   * routine's source region announcing itself. */
  flash?: { start: number; end: number } | null;
}

/** REQUEST (history's "view in Session", ownership chip): select durably,
 * stash the moment, nudge. Callers switch the app mode to 'library'
 * themselves (App listens for the event and does exactly that). */
export function requestSessionMoment(req: SessionMomentRequest): void {
  selectedUuid = req.sessionUuid;
  pendingFocusS = req.atS;
  pendingSpanS = req.spanS ?? null;
  pendingFlash = req.flash ?? null;
  focusVersion += 1;
  window.dispatchEvent(new CustomEvent(OPEN_SESSION_EVENT));
}

export interface SessionFocus {
  atS: number | null;
  spanS: number | null;
  flash: { start: number; end: number } | null;
  /** Bumps on every request — panes re-apply focus when it changes.
   * (Keep-alive views, perf-layout 09: BOTH Library instances can be
   * mounted at once, so a clearing one-shot consume would race them; a
   * peek + version lets every mounted pane apply the same moment.) */
  version: number;
}

let focusVersion = 0;

/** PEEK (non-clearing): the latest focus request. Panes track `version`
 * and re-center whenever it bumps — on mount AND while staying mounted. */
export function peekSessionFocus(): SessionFocus {
  return { atS: pendingFocusS, spanS: pendingSpanS, flash: pendingFlash, version: focusVersion };
}
