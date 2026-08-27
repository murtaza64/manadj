/**
 * Routine-edit handoff (gh#170): a Set adjacency's routine pin, a history
 * row, or any other surface asks the app to open a Routine in the Routine
 * editor. Same-tab, in-memory — the openPair.ts pattern (the request
 * survives the view switch, not a reload).
 */

/** window CustomEvent: a Routine edit was requested (App switches view;
 * an already-mounted Routine editor picks it up directly). */
export const OPEN_ROUTINE_EVENT = 'manadj:open-routine';

export interface RoutineEditRequest {
  routineUuid: string;
}

let pending: RoutineEditRequest | null = null;

export function requestRoutineEdit(req: RoutineEditRequest): void {
  pending = req;
  window.dispatchEvent(new CustomEvent(OPEN_ROUTINE_EVENT));
}

/** One-shot: the editor consumes the pending request on mount/event. */
export function consumeRoutineEdit(): RoutineEditRequest | null {
  const req = pending;
  pending = null;
  return req;
}
