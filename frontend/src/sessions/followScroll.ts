/**
 * Replay follow-scroll (sessions 17): once the playhead crosses into the
 * viewport's last FOLLOW_ZONE fraction, the viewport rides along with it —
 * pinned so the head sits AT the zone edge, which makes the scroll rate
 * exactly the playhead's own px rate (stable by construction). Pure math;
 * the view owns the manual-scroll disarm.
 */

/** The playhead may roam the first 80% freely; the last 20% follows. */
export const FOLLOW_ZONE = 0.8;

/** A manual scroll disarms following for THIS long after the LAST manual
 * scroll event (each scroll refreshes the window). Quiet hands re-arm
 * automatically — a permanent disarm meant one nudge silently ended
 * following for the rest of a long replay. */
export const REARM_AFTER_MS = 20_000;

/**
 * The scrollLeft that keeps a following viewport pinned to the playhead,
 * or null when no scroll should happen: head not yet in the zone, no
 * scrollable area left, or the target would move backwards (a head jump
 * BACK into view never yanks the viewport).
 */
export function followScrollTarget(
  headX: number,
  scrollLeft: number,
  viewportW: number,
  scrollWidth: number
): number | null {
  const zoneEdge = scrollLeft + FOLLOW_ZONE * viewportW;
  if (headX <= zoneEdge) return null;
  const maxScroll = Math.max(0, scrollWidth - viewportW);
  if (scrollLeft >= maxScroll) return null;
  const target = Math.min(maxScroll, headX - FOLLOW_ZONE * viewportW);
  return target > scrollLeft ? target : null;
}
