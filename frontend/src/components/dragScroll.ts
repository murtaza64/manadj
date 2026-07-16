/**
 * Edge auto-scroll for HTML5 drag-over (playlist drag-reorder): dragging
 * near a scrollable pane's top/bottom edge scrolls it, so a track can be
 * reordered past the visible rows.
 *
 * Speed is TIME-NORMALIZED (px/s scaled by the elapsed time between
 * dragover events), not per-event: Chromium fires dragover per mousemove
 * (~60 Hz) while the pointer moves but only ~every 350ms when stationary —
 * a fixed per-event step was uncontrollably fast under motion (hands-on
 * rejected). The elapsed time is capped so a stationary refire cannot
 * jump. Pure math; the caller owns the DOM and the event timestamps.
 */

/** Distance from the pane edge (px) where auto-scroll engages. */
export const DRAG_EDGE_ZONE_PX = 48;
/** Scroll speed at the very edge (px/s); ramps linearly from 0 at the
 * zone boundary. ~4 rows/s at 28px rows — controllable, not sluggish. */
export const DRAG_EDGE_MAX_SPEED_PX_PER_S = 110;
/** Elapsed-time cap (ms): stationary dragover refires (~350ms) must not
 * convert into a jump. */
export const DRAG_EDGE_MAX_ELAPSED_MS = 50;

/**
 * Scroll delta (px, fractional) for a pointer at `clientY` over a pane
 * spanning [`paneTop`, `paneBottom`] (viewport coords), `elapsedMs` since
 * the previous dragover. Negative = scroll up; 0 outside the edge zones.
 */
export function dragEdgeScrollDelta(
  clientY: number,
  paneTop: number,
  paneBottom: number,
  elapsedMs: number
): number {
  const dt = Math.min(Math.max(elapsedMs, 0), DRAG_EDGE_MAX_ELAPSED_MS) / 1000;
  const fromTop = clientY - paneTop;
  const fromBottom = paneBottom - clientY;
  if (fromTop < DRAG_EDGE_ZONE_PX) {
    const ramp = (DRAG_EDGE_ZONE_PX - Math.max(0, fromTop)) / DRAG_EDGE_ZONE_PX;
    return -ramp * DRAG_EDGE_MAX_SPEED_PX_PER_S * dt;
  }
  if (fromBottom < DRAG_EDGE_ZONE_PX) {
    const ramp = (DRAG_EDGE_ZONE_PX - Math.max(0, fromBottom)) / DRAG_EDGE_ZONE_PX;
    return ramp * DRAG_EDGE_MAX_SPEED_PX_PER_S * dt;
  }
  return 0;
}
