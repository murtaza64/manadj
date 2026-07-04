/**
 * Multi-selection model for track tables (playlist-editing 02).
 *
 * Pure and framework-free. The selection is an ordered list of track ids
 * plus an anchor (the last-clicked track): Enter/double-click load the
 * anchor, shift-click ranges extend from it, and j/k navigation collapses
 * the selection back to a single row starting from it.
 *
 * "Selection order" is the order operations act in (e.g. multi-drag
 * inserts): click order for toggle accumulation, visible table order for
 * ranges and select-all.
 */

export interface Selection {
  /** Selected track ids, in selection order. */
  readonly ids: readonly number[];
  /** The last-clicked track: load target, navigation origin, range root. */
  readonly anchorId: number | null;
}

export const EMPTY_SELECTION: Selection = { ids: [], anchorId: null };

export function isSelected(sel: Selection, id: number): boolean {
  return sel.ids.includes(id);
}

/** Plain click: select exactly this row. */
export function click(_sel: Selection, id: number): Selection {
  return { ids: [id], anchorId: id };
}

/** Cmd-click: toggle membership. Adding makes the row the anchor. */
export function toggleClick(sel: Selection, id: number): Selection {
  if (sel.ids.includes(id)) {
    const ids = sel.ids.filter((x) => x !== id);
    const anchorId = sel.anchorId === id ? (ids[ids.length - 1] ?? null) : sel.anchorId;
    return { ids, anchorId };
  }
  return { ids: [...sel.ids, id], anchorId: id };
}

/**
 * Shift-click: select the range between the anchor and this row in visible
 * table order (replacing the selection). Without a usable anchor it
 * degrades to a plain click.
 */
export function rangeClick(sel: Selection, id: number, order: readonly number[]): Selection {
  const anchorIndex = sel.anchorId === null ? -1 : order.indexOf(sel.anchorId);
  const targetIndex = order.indexOf(id);
  if (anchorIndex === -1 || targetIndex === -1) return click(sel, id);
  const [lo, hi] = anchorIndex <= targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
  return { ids: order.slice(lo, hi + 1), anchorId: id };
}

/**
 * j/k navigation: collapse to a single row, moving from the anchor
 * (clamped to the list; first row when nothing was selected).
 */
export function navigate(sel: Selection, delta: 1 | -1, order: readonly number[]): Selection {
  if (order.length === 0) return sel;
  const currentIndex = sel.anchorId === null ? -1 : order.indexOf(sel.anchorId);
  const nextIndex =
    currentIndex === -1 ? 0 : Math.max(0, Math.min(order.length - 1, currentIndex + delta));
  return click(sel, order[nextIndex]);
}

/** Cmd-A: select every visible row in table order. The anchor survives if visible. */
export function selectAll(sel: Selection, order: readonly number[]): Selection {
  if (order.length === 0) return EMPTY_SELECTION;
  const anchorId =
    sel.anchorId !== null && order.includes(sel.anchorId)
      ? sel.anchorId
      : order[order.length - 1];
  return { ids: [...order], anchorId };
}

/**
 * Reconcile with a refreshed track list: drop ids no longer visible.
 * The anchor falls back to the last surviving selected row.
 */
export function prune(sel: Selection, order: readonly number[]): Selection {
  const visible = new Set(order);
  const ids = sel.ids.filter((id) => visible.has(id));
  if (ids.length === sel.ids.length) return sel;
  const anchorId =
    sel.anchorId !== null && visible.has(sel.anchorId)
      ? sel.anchorId
      : (ids[ids.length - 1] ?? null);
  return { ids, anchorId };
}
