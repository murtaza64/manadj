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
      {/* Shackle: closed = both legs seated in the body; open = attached
          at the right only, left leg swung up in the air (classic unlock
          silhouette). */}
      {locked ? (
        <path d="M4 5.5 V3.8 A2 2 0 0 1 8 3.8 V5.5" />
      ) : (
        <path d="M8 5.5 V3.6 A2 2 0 0 0 4 3.6 V2.2" />
      )}
    </svg>
  );
}
