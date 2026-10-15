/**
 * Chord match (chord-match #388): the pure term + its place in the Match
 * score. Expected values are literals from the curve, not recomputed.
 */
import { describe, expect, it } from 'vitest';
import type { Track } from '../types';
import {
  CHORD_BADGE_MIN,
  chordContribution,
  chordMatch,
  chordMatchOf,
  decodeChordLoops,
  LOOP_BARS,
  type ChordLoops,
} from './chordMatch';
import { AFFINITY_FLOOR, affinitySubtotal, matchScore, matchedSignals, WEIGHTS } from './matchScore';
import { suggestAppend } from './suggest';

/** A residual whose bar i is the unit vector on pitch class pcs[i]. */
function loop(pcs: number[]): Float32Array {
  const out = new Float32Array(LOOP_BARS * 12);
  pcs.forEach((pc, bar) => (out[bar * 12 + pc] = 1));
  return out;
}

const PROG = [7, 7, 2, 2, 9, 9, 11, 11]; // G G D D A A B B
const rotate = (pcs: number[], r: number) => pcs.map((_, i) => pcs[(i + r) % pcs.length]);

function track(id: number, fields: Partial<Track> = {}): Track {
  return { id, filename: `/t/${id}.mp3`, tags: [], ...fields } as unknown as Track;
}

describe('chordMatch', () => {
  it('is 1 for identical loops and invariant to bar rotation', () => {
    expect(chordMatch(loop(PROG), loop(PROG))).toBeCloseTo(1);
    expect(chordMatch(loop(PROG), loop(rotate(PROG, 3)))).toBeCloseTo(1);
    expect(chordMatch(loop(rotate(PROG, 5)), loop(PROG))).toBeCloseTo(1);
  });

  it('scores partial agreement as the best-rotation bar fraction', () => {
    // 4 of 8 bars agree at the best rotation
    expect(chordMatch(loop(PROG), loop([7, 7, 2, 2, 0, 0, 0, 0]))).toBeCloseTo(0.5);
  });

  it('is undefined (neutral) when either loop is missing', () => {
    const loops: ChordLoops = new Map([[1, loop(PROG)]]);
    expect(chordMatchOf(loops, 1, 2)).toBeUndefined();
    expect(chordMatchOf(loops, 2, 1)).toBeUndefined();
    expect(chordMatchOf(undefined, 1, 2)).toBeUndefined();
    expect(chordMatchOf(loops, 1, 1)).toBeUndefined();
  });
});

describe('chordContribution', () => {
  it('is 0 up to 0.3, linear to 1 at 0.7, flat above, never negative', () => {
    expect(chordContribution(undefined)).toBe(0);
    expect(chordContribution(-0.4)).toBe(0);
    expect(chordContribution(0.3)).toBe(0);
    expect(chordContribution(0.5)).toBeCloseTo(0.5);
    expect(chordContribution(0.7)).toBe(1);
    expect(chordContribution(0.95)).toBe(1);
  });
});

describe('decodeChordLoops', () => {
  it('decodes base64 int8 bars to unit vectors', () => {
    const ints = new Int8Array(96);
    ints[0] = 127; // bar 0 → C
    ints[12 + 9] = -64; // bar 1 → -A, renormalised to -1
    const b64 = btoa(String.fromCharCode(...new Uint8Array(ints.buffer)));
    const loops = decodeChordLoops({ bars: 8, loops: { '42': b64, '7': 'AAAA' } });
    expect([...loops.keys()]).toEqual([42]); // wrong length dropped
    const l = loops.get(42)!;
    expect(l[0]).toBeCloseTo(1);
    expect(l[21]).toBeCloseTo(-1);
  });
});

describe('Chord match in the Match score', () => {
  const ref = track(1, { key: 19 });
  const cand = track(2, { key: 9 }); // unrelated key: no key bonus
  const loops: ChordLoops = new Map([
    [1, loop(PROG)],
    [2, loop(rotate(PROG, 2))],
  ]);

  it('adds its weight as an affinity signal and admits on its own', () => {
    expect(affinitySubtotal(ref, cand)).toBe(0);
    expect(affinitySubtotal(ref, cand, loops)).toBeCloseTo(WEIGHTS.chord);
    expect(WEIGHTS.chord).toBeGreaterThanOrEqual(AFFINITY_FLOOR);
    expect(matchScore(ref, cand, undefined, loops) - matchScore(ref, cand)).toBeCloseTo(WEIGHTS.chord);
  });

  it('leaves drone pairs (no loops on the wire) unchanged', () => {
    const drone = track(3, { key: 19 });
    expect(matchScore(ref, drone, undefined, loops)).toBe(matchScore(ref, drone));
  });

  it('reports the best match as a signal for the row icon', () => {
    const signals = matchedSignals(cand, [{ track: ref, knownStrength: () => null }], loops);
    expect(signals.chord).toBeCloseTo(1);
    expect(signals.chord!).toBeGreaterThanOrEqual(CHORD_BADGE_MIN);
    expect(matchedSignals(cand, [{ track: ref, knownStrength: () => null }]).chord).toBeUndefined();
  });

  it('feeds Set suggestions: a chord match admits a key-clashing edge', () => {
    const none = () => null;
    expect(suggestAppend([cand], new Set(), ref, none)).toEqual([]);
    expect(suggestAppend([cand], new Set(), ref, none, loops).map((s) => s.track.id)).toEqual([2]);
  });
});
