import { chordContribution } from './chordMatch';
import './ChordMatchIcon.css';

/** Chord-match mark (chord-match #388): a note icon whose intensity is the
 * match's confidence (its score contribution). No number — the Match
 * score already carries the magnitude. */
export function ChordMatchIcon({ match, size = 10 }: { match: number; size?: number }) {
  const opacity = 0.3 + 0.7 * chordContribution(match);
  return (
    <span
      className="chord-match-icon"
      style={{ opacity }}
      title={`Chord match ${Math.round(match * 100)}%: drop chord progressions match`}
      role="img"
      aria-label="Chord match"
    >
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" fill="currentColor" />
        <circle cx="18" cy="16" r="3" fill="currentColor" />
      </svg>
    </span>
  );
}
