/**
 * Drop-index math for insertion-line drag & drop (playlist-editing 06).
 *
 * Pure: callers extract row rectangles from the DOM and pass them in.
 * An insertion index i means "insert before the row currently at index i"
 * (i === rowCount appends).
 */

export interface RowRect {
  top: number;
  height: number;
}

/** Insertion index from the pointer's Y position over the row stack.
 * Above a row's midline inserts before it; past every midline appends. */
export function insertionIndexFromPointer(pointerY: number, rows: readonly RowRect[]): number {
  for (let i = 0; i < rows.length; i++) {
    if (pointerY < rows[i].top + rows[i].height / 2) return i;
  }
  return rows.length;
}

/** The Y coordinate to draw the insertion line at (row-stack coordinates). */
export function indicatorY(index: number, rows: readonly RowRect[]): number {
  if (rows.length === 0) return 0;
  if (index >= rows.length) {
    const last = rows[rows.length - 1];
    return last.top + last.height;
  }
  return rows[index].top;
}

/**
 * Reorder `order` by moving `movedIds` (in the given order) to `insertIndex`
 * (an index into the CURRENT order, before removal). Returns the new order.
 * Ids not present in `order` are ignored.
 */
export function applyReorder(
  order: readonly number[],
  movedIds: readonly number[],
  insertIndex: number
): number[] {
  const present = new Set(order);
  const moving = movedIds.filter((id) => present.has(id));
  const movingSet = new Set(moving);
  const remaining = order.filter((id) => !movingSet.has(id));
  // The insertion point shifts up by the number of moved rows above it.
  const movedAbove = order.slice(0, insertIndex).filter((id) => movingSet.has(id)).length;
  const target = Math.max(0, Math.min(remaining.length, insertIndex - movedAbove));
  return [...remaining.slice(0, target), ...moving, ...remaining.slice(target)];
}

/** Split a dropped id list against current membership: ids to insert
 * (preserving payload order) vs ids already present. */
export function splitByMembership(
  droppedIds: readonly number[],
  memberIds: ReadonlySet<number>
): { newIds: number[]; presentIds: number[] } {
  const newIds: number[] = [];
  const presentIds: number[] = [];
  for (const id of droppedIds) {
    (memberIds.has(id) ? presentIds : newIds).push(id);
  }
  return { newIds, presentIds };
}
