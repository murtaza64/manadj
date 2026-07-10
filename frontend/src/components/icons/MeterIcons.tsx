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
