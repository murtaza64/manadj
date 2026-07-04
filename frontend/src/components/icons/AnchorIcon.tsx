/**
 * Anchor icon (deck-controls PRD, "Icon language"): set-downbeat literally
 * sets the beatgrid's anchor (ADR 0016 — `anchor_time`), so the icon IS
 * the concept. Replaces the old "D" text button.
 */
export function AnchorIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">
      <circle cx="8" cy="3.2" r="1.7" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 4.9 V13.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5.2 7 H10.8" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M2 9.5 C 2.4 12.6, 4.8 13.9, 8 13.9 C 11.2 13.9, 13.6 12.6, 14 9.5 L11.9 10.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <path d="M2 9.5 L4.1 10.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}
