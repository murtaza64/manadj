/**
 * Shared inline-SVG control icons (deck-controls PRD, "Icon language"):
 * left/right-coded operations stop sharing glyphs — the icon says which
 * OPERATION. Beatjump is the DASHED SKIP ARROW (re-glyphed 2026-07-05,
 * replacing the leap arc, which read as undo/redo at 13px): a straight
 * transport arrow whose broken middle IS the skipped audio. Nudge/bend
 * stays the ◀◀/▶▶ text glyph; halve/double is plain text (`1/2` / `x2`).
 */

/** Jump-forward: lead-in, the skip gap, then the landing arrow. */
export function JumpForwardIcon({ size = 13 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" focusable="false">
      <path
        d="M1.5 8 H6.2 M9.2 8 H12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path d="M14.6 8 L11.4 6 L11.4 10 Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Jump-back: mirror of the forward skip. */
export function JumpBackIcon({ size = 13 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" focusable="false">
      <path
        d="M14.5 8 H9.8 M6.8 8 H4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path d="M1.4 8 L4.6 6 L4.6 10 Z" fill="currentColor" stroke="none" />
    </svg>
  );
}
