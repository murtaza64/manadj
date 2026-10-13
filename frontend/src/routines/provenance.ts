/**
 * Routine provenance deep-link (gh#170 follow-up): every routine surface
 * offers "open in Session timeline" one click away — the deep-link
 * doctrine (history ⇄ Session timeline already deep-link for pair
 * Takes; same idiom: requestSessionMoment). All three tiers resolve:
 *
 *   candidate         → its own session + window
 *   Routine Take      → its own session + window
 *   persisted Routine → through its ORIGIN Routine Take's session
 *
 * The moment centers + zooms on the span and pulses its region guide
 * once (the flash rides the request).
 */
import { requestSessionMoment } from '../sessions/openSession';

export interface RoutineSource {
  sessionUuid: string;
  startS: number;
  endS: number;
}

/** Resolve a persisted Routine's source through the takes list (the
 * origin take carries the session reference). Null = origin gone. */
export function routineSourceFromTakes(
  routineUuid: string,
  takes: readonly {
    session_uuid: string;
    window_start_s: number;
    window_end_s: number;
    promoted_routine_uuid: string | null;
  }[]
): RoutineSource | null {
  const take = takes.find((t) => t.promoted_routine_uuid === routineUuid);
  if (!take) return null;
  return {
    sessionUuid: take.session_uuid,
    startS: take.window_start_s,
    endS: take.window_end_s,
  };
}

/** Navigate: Session timeline centered + zoomed on the span, region
 * guide flashed. (App flips to the Library on the event.) */
export function openRoutineSource(src: RoutineSource): void {
  const span = Math.max(src.endS - src.startS, 1);
  requestSessionMoment({
    sessionUuid: src.sessionUuid,
    atS: src.startS + span / 2,
    spanS: span * 1.6,
    flash: { start: src.startS, end: src.endS },
  });
}
