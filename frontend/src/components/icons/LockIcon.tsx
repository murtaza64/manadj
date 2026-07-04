/** Padlock, open/closed (deck-controls PRD icon language). */
export function LockIcon({ locked, size = 12 }: { locked: boolean; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      aria-hidden
    >
      {/* Body */}
      <rect x="2.5" y="5.5" width="7" height="5" rx="0.5" fill="currentColor" stroke="none" />
      {/* Shackle: closed loops into the body; open hangs off to the right
          (right leg outside the body, visibly disengaged). */}
      {locked ? (
        <path d="M4 5.5 V3.8 A2 2 0 0 1 8 3.8 V5.5" />
      ) : (
        <path d="M5.5 5.5 V3.6 A2 2 0 0 1 9.5 3.6 V4.8" />
      )}
    </svg>
  );
}
