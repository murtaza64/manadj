/**
 * Routine cast cache (sets 160): pin uuid → cast, fed by whichever
 * surface loads Routine metadata (the Set pane's routines query, the
 * pin picker's pin acts). The set store's dormancy reconciliation reads
 * it imperatively — reconcile is synchronous and pure, so the cast
 * lookup has to be a plain module cache, not a hook. Unknown uuids
 * return null (reconcile then keeps the pin riding on its head entry
 * rather than guessing Dormant — see dormancy.ts).
 */

const castByUuid = new Map<string, number[]>();

export function setRoutineCast(uuid: string, cast: readonly number[]): void {
  castByUuid.set(uuid, [...cast]);
}

export function primeRoutineCasts(rows: readonly { uuid: string; cast: readonly number[] }[]): void {
  for (const r of rows) setRoutineCast(r.uuid, r.cast);
}

export function getRoutineCast(uuid: string): number[] | null {
  return castByUuid.get(uuid) ?? null;
}

/** Reset (tests only). */
export function _resetRoutineCastsForTests(): void {
  castByUuid.clear();
}
