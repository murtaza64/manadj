/**
 * Grid-nudge icons (deck-controls PRD, "Icon language"): grid-ticks-with-
 * arrow — a few vertical beat ticks plus a small arrow showing which way
 * the grid shifts. Clearly a GRID op, unlike the plain ◀/▶ it replaces.
 */

/** Grid ticks + arrow pointing left — nudge grid earlier. */
export function GridNudgeLeftIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">
      <path
        d="M8.5 2.5 V13.5 M11.75 2.5 V13.5 M15 2.5 V13.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <path d="M5.5 4.5 L1 8 L5.5 11.5 Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Grid ticks + arrow pointing right — nudge grid later. */
export function GridNudgeRightIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">
      <path
        d="M1 2.5 V13.5 M4.25 2.5 V13.5 M7.5 2.5 V13.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <path d="M10.5 4.5 L15 8 L10.5 11.5 Z" fill="currentColor" stroke="none" />
    </svg>
  );
}
