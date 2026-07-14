/**
 * Metric-ladder authoring icons (metric-ladder 02): a flag on a downbeat
 * tick — "the count restarts here". The delete variant carries a minus.
 */

/** Flag on a tick — mark a Reset at the playhead's downbeat. */
export function ResetMarkIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">
      <path d="M4 2.5 V13.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M4 3 H12 L9.5 5.25 L12 7.5 H4 Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Flag with a minus — delete the nearest Reset mark. */
export function ResetMarkDeleteIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">
      <path d="M4 2.5 V13.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M4 3 H12 L9.5 5.25 L12 7.5 H4 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
      />
      <path d="M8 12 H15" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

/** A drop landing on a baseline — the three-artifact Drop-anchor gesture. */
export function DropAnchorIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">
      <path
        d="M8 1.5 C6.5 4 4.5 6.2 4.5 8.6 A3.5 3.5 0 0 0 11.5 8.6 C11.5 6.2 9.5 4 8 1.5 Z"
        fill="currentColor"
      />
      <path d="M2 13.5 H14" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
