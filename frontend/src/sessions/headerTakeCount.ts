/**
 * The Session header's Take count (gh#329): the live per-session Take list
 * once it has loaded, else the Session row's server-side `take_count` —
 * never a premature 0 while the app-wide Take list is still in flight.
 */
export function headerTakeCount(
  sessionTakes: readonly unknown[] | undefined,
  rowTakeCount: number
): number {
  return sessionTakes ? sessionTakes.length : rowTakeCount;
}
