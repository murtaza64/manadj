/**
 * Shared inline-SVG control icons (deck-controls PRD, "Icon language"):
 * left/right-coded operations stop sharing glyphs — the icon says which
 * OPERATION. Beatjump carries the curved jump arrow; nudge/bend is the
 * ◀◀/▶▶ text glyph; halve/double is plain text (`1/2` / `x2`).
 */

/** Jump-back arrow: a leap trajectory landing down-left — the arrowhead
 * angles along the terminal tangent (~50° below horizontal), so it reads
 * as a JUMP, not a rotate/redo glyph. */
export function JumpBackIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">
      <path
        d="M13.5 12 C 12 4.5, 6.5 3, 4.3 7.3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path d="M2.4 10.2 L6.0 8.4 L2.6 6.2 Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Jump-forward arrow: leap trajectory landing down-right. */
export function JumpForwardIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">
      <path
        d="M2.5 12 C 4 4.5, 9.5 3, 11.7 7.3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path d="M13.6 10.2 L10.0 8.4 L13.4 6.2 Z" fill="currentColor" stroke="none" />
    </svg>
  );
}
