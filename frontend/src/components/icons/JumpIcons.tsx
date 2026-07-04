/**
 * Shared inline-SVG control icons (deck-controls PRD, "Icon language"):
 * left/right-coded operations stop sharing glyphs — the icon says which
 * OPERATION. Beatjump carries the curved jump arrow; nudge/bend is the
 * ◀◀/▶▶ text glyph; halve/double is plain text (`1/2` / `x2`).
 */

/** Jump-back arrow: a symmetric leap trajectory — launch and landing at
 * the same height, arc symmetric about center, arrowhead angled along the
 * descending tangent (mirror of the launch angle) so it reads as a JUMP,
 * not a rotate/redo glyph. */
export function JumpBackIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">
      <path
        d="M13.5 10.5 C 11.5 3.2, 5.2 2.7, 3.5 7.05"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path d="M2.5 10.5 L5.3 7.6 L1.7 6.5 Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Jump-forward arrow: symmetric leap trajectory landing down-right. */
export function JumpForwardIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">
      <path
        d="M2.5 10.5 C 4.5 3.2, 10.8 2.7, 12.5 7.05"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path d="M13.5 10.5 L10.7 7.6 L14.3 6.5 Z" fill="currentColor" stroke="none" />
    </svg>
  );
}
