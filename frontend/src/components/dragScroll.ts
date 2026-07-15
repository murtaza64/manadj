/**
 * Edge auto-scroll for HTML5 drag-over (playlist drag-reorder): dragging
 * near a scrollable pane's top/bottom edge scrolls it, so a track can be
 * reordered past the visible rows. Chromium re-fires dragover continuously
 * (~350ms stationary, per movement otherwise), so applying a per-event
 * delta yields steady scrolling without a timer. Pure math; the caller
 * owns the DOM.
 */

/** Distance from the pane edge (px) where auto-scroll engages. */
export const DRAG_EDGE_ZONE_PX = 48;
/** Max scroll per dragover event (px) — reached at the very edge. */
export const DRAG_EDGE_MAX_STEP_PX = 24;

/**
 * Scroll delta for a pointer at `clientY` over a pane spanning
 * [`paneTop`, `paneBottom`] (viewport coords). Negative = scroll up,
 * 0 outside the edge zones; speed ramps linearly toward the edge.
 */
export function dragEdgeScrollDelta(
  clientY: number,
  paneTop: number,
  paneBottom: number
): number {
  const fromTop = clientY - paneTop;
  const fromBottom = paneBottom - clientY;
  if (fromTop < DRAG_EDGE_ZONE_PX) {
    const ramp = (DRAG_EDGE_ZONE_PX - Math.max(0, fromTop)) / DRAG_EDGE_ZONE_PX;
    return -Math.ceil(ramp * DRAG_EDGE_MAX_STEP_PX);
  }
  if (fromBottom < DRAG_EDGE_ZONE_PX) {
    const ramp = (DRAG_EDGE_ZONE_PX - Math.max(0, fromBottom)) / DRAG_EDGE_ZONE_PX;
    return Math.ceil(ramp * DRAG_EDGE_MAX_STEP_PX);
  }
  return 0;
}
