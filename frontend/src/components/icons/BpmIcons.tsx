/**
 * Grow/Shrink icons (deck-controls PRD, "Icon language"; glossary:
 * Grow/Shrink): ADR 0016 made visible — a BPM step is a grid operation, so
 * the step buttons show the grid shrinking (beats closer together = BPM
 * up) or growing (beats further apart = BPM down) instead of generic ±
 * steppers.
 */

/** Shrink — arrows pointing inward at a beat line: tighter spacing, BPM up. */
export function BpmShrinkIcon() {
  return (
    <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true" focusable="false">
      <line x1="8" y1="2.5" x2="8" y2="13.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M1.5 4 L6 8 L1.5 12 Z" fill="currentColor" stroke="none" />
      <path d="M14.5 4 L10 8 L14.5 12 Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Grow — arrows pointing outward from a beat line: wider spacing, BPM down. */
export function BpmGrowIcon() {
  return (
    <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true" focusable="false">
      <line x1="8" y1="2.5" x2="8" y2="13.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5.5 4 L1 8 L5.5 12 Z" fill="currentColor" stroke="none" />
      <path d="M10.5 4 L15 8 L10.5 12 Z" fill="currentColor" stroke="none" />
    </svg>
  );
}
