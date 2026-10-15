/**
 * Chord match (chord-match #388): how closely two Tracks' drop chord
 * progressions agree — an affinity signal in the Match score and a row
 * row icon. Pure functions over the harmony wire (GET /api/harmony/loops).
 *
 * Each loop arrives as its chord residual: the 8-bar x 12 drop loop minus
 * its mean chroma (key/drone removed), unit-normalised per bar, int8. The
 * match is the mean per-bar cosine, maximised over the 8 bar rotations
 * (drops may start mid-progression). Only Tracks whose loop moves
 * (backend MOVEMENT_MIN) are on the wire; a missing loop on either side =
 * undefined = neutral, never negative, like every Match score signal.
 *
 * Library null over melodic pairs (spike + sandbox): median 0.15, p90
 * 0.30, p99 0.50 — the curve is 0 below CHORD_MATCH_MIN and saturates at
 * CHORD_MATCH_FULL.
 */

export const LOOP_BARS = 8;
const BINS = 12;

/** Contribution curve: 0 below, linear, 1 at and above. */
export const CHORD_MATCH_MIN = 0.3;
export const CHORD_MATCH_FULL = 0.7;
/** Rows show the chord-match icon at or above this match (intensity =
 * chordContribution, so it fades in from here). */
export const CHORD_BADGE_MIN = 0.4;

/** Track id → chord residual (LOOP_BARS * 12, row-major by bar). */
export type ChordLoops = ReadonlyMap<number, Float32Array>;

export interface HarmonyLoopsWire {
  bars: number;
  loops: Record<string, string>;
}

/** Decode the bulk wire: base64 int8 → per-bar unit vectors. */
export function decodeChordLoops(wire: HarmonyLoopsWire): ChordLoops {
  const out = new Map<number, Float32Array>();
  for (const [id, b64] of Object.entries(wire.loops)) {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    if (bytes.length !== LOOP_BARS * BINS) continue;
    const ints = new Int8Array(bytes.buffer);
    const loop = new Float32Array(LOOP_BARS * BINS);
    for (let bar = 0; bar < LOOP_BARS; bar++) {
      let norm = 0;
      for (let k = 0; k < BINS; k++) norm += ints[bar * BINS + k] ** 2;
      norm = Math.sqrt(norm) || 1;
      for (let k = 0; k < BINS; k++) loop[bar * BINS + k] = ints[bar * BINS + k] / norm;
    }
    out.set(Number(id), loop);
  }
  return out;
}

/** Mean per-bar cosine of two residuals, best of the 8 bar rotations. */
export function chordMatch(a: Float32Array, b: Float32Array): number {
  let best = -Infinity;
  for (let r = 0; r < LOOP_BARS; r++) {
    let sum = 0;
    for (let bar = 0; bar < LOOP_BARS; bar++) {
      const ia = bar * BINS;
      const ib = ((bar + r) % LOOP_BARS) * BINS;
      for (let k = 0; k < BINS; k++) sum += a[ia + k] * b[ib + k];
    }
    best = Math.max(best, sum / LOOP_BARS);
  }
  return best;
}

/** The pair's chord match, or undefined when either loop is missing. */
export function chordMatchOf(
  loops: ChordLoops | undefined,
  referenceId: number,
  candidateId: number,
): number | undefined {
  if (!loops || referenceId === candidateId) return undefined;
  const a = loops.get(referenceId);
  const b = loops.get(candidateId);
  return a && b ? chordMatch(a, b) : undefined;
}

/** Score contribution 0..1; undefined (no loops) is neutral 0. */
export function chordContribution(match: number | undefined): number {
  if (match === undefined) return 0;
  if (match <= CHORD_MATCH_MIN) return 0;
  if (match >= CHORD_MATCH_FULL) return 1;
  return (match - CHORD_MATCH_MIN) / (CHORD_MATCH_FULL - CHORD_MATCH_MIN);
}
