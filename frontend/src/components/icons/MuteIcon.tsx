/** Speaker / speaker-with-slash (deck-controls PRD icon language). */
export function MuteIcon({ muted, size = 12 }: { muted: boolean; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden
    >
      {/* Speaker body */}
      <path d="M1.5 4.5 H3.5 L6.5 2 V10 L3.5 7.5 H1.5 Z" fill="currentColor" stroke="none" />
      {muted ? (
        // Slash
        <path d="M8 3.5 L11 8.5 M11 3.5 L8 8.5" />
      ) : (
        // Sound waves
        <>
          <path d="M8.2 4.5 Q9.2 6 8.2 7.5" />
          <path d="M9.6 3.4 Q11.2 6 9.6 8.6" />
        </>
      )}
    </svg>
  );
}
