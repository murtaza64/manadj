/**
 * Tempo math for varispeed decks (pure — shared by DeckEngine and the UI).
 *
 * A deck's playback rate composes pitch (the fader, persistent) with bend
 * (momentary nudge): rate = (1 + pitch/100) × (1 + bend/100). Releasing bend
 * (bend = 0) therefore restores the exact pitch-only rate.
 */

/** Varispeed range, percent — the pitch fader's reach. */
export const PITCH_RANGE_PERCENT = 8;

/**
 * The engine-level pitch clamp (ADR 0022): range POLICY lives with
 * callers — the Performance fader/MIDI geometry clamps writes to
 * ±PITCH_RANGE_PERCENT, the Transition editor's tempo-match to its wider
 * editor range — and the engine accepts anything up to this hard ceiling
 * (beat alignment on extreme pairs needs the reach).
 */
export const MAX_PITCH_RANGE_PERCENT = 25;

/** Momentary nudge amount, percent (UI constant — tune by ear). */
export const NUDGE_BEND_PERCENT = 2;

export function composeRate(pitchPercent: number, bendPercent: number): number {
  return (1 + pitchPercent / 100) * (1 + bendPercent / 100);
}

/** Audible tempo at a pitch setting (bend is momentary and excluded). */
export function effectiveBpm(baseBpm: number, pitchPercent: number): number {
  return baseBpm * (1 + pitchPercent / 100);
}

/** Pitch where an unlocked Deck's sounding key has audibly drifted from
 * the Track's Key — about half a semitone (a semitone is ~5.95%). */
export const KEY_DRIFT_PITCH_PERCENT = 3;

/**
 * The KEY readout is lying (key-lock 04): Key Lock is off, so varispeed has
 * shifted the sounding key by ≥ ~half a semitone — Key-compatibility
 * judgments are off. Bend is momentary and excluded (same anti-wobble
 * reasoning as effectiveBpm). No computed "actual key": rejected in the
 * PRD as false precision.
 */
export function keyDrifted(keyLockOn: boolean, pitchPercent: number): boolean {
  return !keyLockOn && Math.abs(pitchPercent) >= KEY_DRIFT_PITCH_PERCENT;
}

export type BpmMatchResult =
  | { kind: 'match'; pitchPercent: number }
  | { kind: 'out-of-reach' };

/**
 * BPM match (tempo only — phase stays a hand skill): the pitch that makes
 * this deck's tempo equal the other deck's *effective* BPM, or its
 * double/half-time feel. Candidates {other, other×2, other/2}; a candidate
 * is reachable when the required pitch is within ±PITCH_RANGE_PERCENT.
 * The direct match wins whenever it reaches; otherwise the reachable
 * candidate needing the least pitch. (At ±8% at most one candidate can
 * ever reach — they sit a factor of 2 apart — but the preference rule is
 * kept as specced in case the range widens.)
 *
 * BPM-less tracks are the caller's problem (the signature demands numbers);
 * a zero/nonsense own BPM degrades safely to out-of-reach.
 */
export function bpmMatch(ownBaseBpm: number, otherEffectiveBpm: number): BpmMatchResult {
  // Tolerate float noise at the exact range edge (108/100 lands a hair over
  // 8%), then clamp the result back into the fader's true reach.
  const EDGE_EPS = 1e-6;
  const candidates = [otherEffectiveBpm, otherEffectiveBpm * 2, otherEffectiveBpm / 2];
  const reachable = candidates
    .map((bpm) => (bpm / ownBaseBpm - 1) * 100)
    .filter((pitch) => Math.abs(pitch) <= PITCH_RANGE_PERCENT + EDGE_EPS);
  if (reachable.length === 0) return { kind: 'out-of-reach' };
  // candidates[0] is the direct match; map/filter preserve order, so if it
  // reached, it is first. Otherwise pick the smallest pitch move.
  const direct = (otherEffectiveBpm / ownBaseBpm - 1) * 100;
  const pitch =
    reachable[0] === direct
      ? direct
      : reachable.reduce((a, b) => (Math.abs(b) < Math.abs(a) ? b : a));
  const pitchPercent = Math.max(-PITCH_RANGE_PERCENT, Math.min(PITCH_RANGE_PERCENT, pitch));
  return { kind: 'match', pitchPercent };
}
