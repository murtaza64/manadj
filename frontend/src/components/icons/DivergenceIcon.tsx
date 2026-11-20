/** A shared source-divergence mark. Arrow direction is opt-in and requires
 * caller-verified field provenance, not file dates or preferred write direction. */
export function DivergenceIcon({ newer = 'unknown', label, size = 12 }: {
  newer?: 'left' | 'right' | 'unknown'; label: string; size?: number;
}) {
  return <svg className="divergence-icon" data-newer={newer} width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label={label}>
    <title>{label}</title>
    {newer === 'unknown' ? <path d="M2 3h3l6 10h3M2 13h3L11 3h3" /> : newer === 'right' ? <path d="M2 3h3l6 5H7m4 0-6 5H2m9-5h3m-3-3 3 3-3 3" /> : <path d="M14 3h-3L5 8h4m-4 0 6 5h3M5 8H2m3-3L2 8l3 3" />}
  </svg>;
}
