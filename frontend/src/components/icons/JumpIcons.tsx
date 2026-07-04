/**
 * Shared inline-SVG control icons (deck-controls PRD, "Icon language"):
 * left/right-coded operations stop sharing glyphs — the icon says which
 * OPERATION. Beatjump carries the curved jump arrow; nudge/bend is the
 * ◀◀/▶▶ text glyph; halve/double is plain text (`1/2` / `x2`).
 */

/** Curved jump arrow, pointing back (↶ shape) — beatjump back. */
export function JumpBackIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">
      <path
        d="M13 11 C 13 4.5, 3.5 4.5, 3.5 9.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path d="M1.2 8.2 L5.8 8.2 L3.5 12.6 Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Curved jump arrow, pointing forward (↷ shape) — beatjump forward. */
export function JumpForwardIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">
      <path
        d="M3 11 C 3 4.5, 12.5 4.5, 12.5 9.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path d="M10.2 8.2 L14.8 8.2 L12.5 12.6 Z" fill="currentColor" stroke="none" />
    </svg>
  );
}
