/**
 * Edge auto-scroll for HTML5 drag-over (playlist drag-reorder): dragging
 * near — or PAST — a scrollable pane's top/bottom edge scrolls it, so a
 * track can be reordered past the visible rows.
 *
 * Speed is TIME-NORMALIZED (px/s scaled by elapsed time), not per-event.
 * The caller drives this from a requestAnimationFrame loop fed by the
 * last known drag pointer position (Library.tsx), NOT from dragover
 * cadence: Chromium fires dragover per mousemove (~60 Hz) while the
 * pointer moves but only ~every 350ms when stationary, so event-driven
 * scrolling crawled (~15 px/s effective) the moment the hand stopped at
 * the edge — the original "clunky" symptom. The elapsed-time cap keeps a
 * throttled/late frame from converting into a jump.
 *
 * Past the edge the ramp keeps growing (up to
 * DRAG_EDGE_OVERSHOOT_RAMP_MAX×): overshooting the pane is the natural
 * "scroll faster" gesture, and it now works because the caller tracks
 * the pointer at the window level rather than relying on the pane
 * receiving dragover. Pure math; the caller owns the DOM and the clock.
 */

/** Distance from the pane edge (px) where auto-scroll engages. */
export const DRAG_EDGE_ZONE_PX = 48;
/** Scroll speed at the very edge (px/s); ramps linearly from 0 at the
 * zone boundary. ~4 rows/s at 28px rows — controllable, not sluggish. */
export const DRAG_EDGE_MAX_SPEED_PX_PER_S = 110;
/** Elapsed-time cap (ms): a late frame must not convert into a jump. */
export const DRAG_EDGE_MAX_ELAPSED_MS = 50;
/** Loop kill switch (ms): dragover fires at least ~every 350ms while a
 * drag is alive anywhere in the window, so a pointer this stale means the
 * drag ended without a catchable drop/dragend (released off-window,
 * source in another app, …) — the scroll loop must not run away. */
export const DRAG_POINTER_STALE_MS = 700;
/** Speed multiplier cap past the pane edge: the ramp keeps growing beyond
 * the edge at the same slope (1× at the edge, this at
 * `(RAMP_MAX - 1) * ZONE` px past it) — drag further out to scroll
 * faster, up to ~16 rows/s. */
export const DRAG_EDGE_OVERSHOOT_RAMP_MAX = 4;

/**
 * Scroll delta (px, fractional) for a pointer at `clientY` against a pane
 * spanning [`paneTop`, `paneBottom`] (viewport coords), `elapsedMs` since
 * the previous frame. Negative = scroll up; 0 outside the edge zones.
 * `clientY` may be beyond the pane (overshoot).
 */
export function dragEdgeScrollDelta(
  clientY: number,
  paneTop: number,
  paneBottom: number,
  elapsedMs: number
): number {
  const dt = Math.min(Math.max(elapsedMs, 0), DRAG_EDGE_MAX_ELAPSED_MS) / 1000;
  const ramp = (edgeDistance: number) =>
    Math.min((DRAG_EDGE_ZONE_PX - edgeDistance) / DRAG_EDGE_ZONE_PX, DRAG_EDGE_OVERSHOOT_RAMP_MAX);
  const fromTop = clientY - paneTop;
  const fromBottom = paneBottom - clientY;
  if (fromTop < DRAG_EDGE_ZONE_PX) {
    return -ramp(fromTop) * DRAG_EDGE_MAX_SPEED_PX_PER_S * dt;
  }
  if (fromBottom < DRAG_EDGE_ZONE_PX) {
    return ramp(fromBottom) * DRAG_EDGE_MAX_SPEED_PX_PER_S * dt;
  }
  return 0;
}
