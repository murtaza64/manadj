/**
 * Set-building suggestions (sets 10) — pure ranking beside the Follow
 * model, on the ONE total edge order (match-score PRD): Known strata,
 * then Match score descending, Affinity floor as the cut. Expected
 * scores are independent literals from the PRD's weights (key-only
 * edges: same 25, relative 20, up 17.5, down 15, clash 0; floor 15),
 * never recomputed through the code under test.
 *
 * Engine key ids (keyTable.generated.ts): 19=10m(Cm) 18=10d(Eb)
 * 21=11m(Gm) 17=9m(Fm) 9=5m(C#m).
 */
import { describe, expect, it } from 'vitest';

import type { Track } from '../types';
import { edgeRank, suggestAppend, suggestInsert, weakerRank } from './suggest';

function track(fields: Partial<Track> = {}): Track {
  return {
    id: 1,
    filename: '/t/1.mp3',
    tags: [],
    ...fields,
  } as unknown as Track;
}

const NONE = () => null;

describe('edgeRank — one ordered edge, from → to', () => {
  it('known strength rides the rank and bypasses the floor', () => {
    const clash = edgeRank(track({ key: 19 }), track({ key: 9 }), 0);
    expect(clash.known).toBe(0);
    expect(clash.admitted).toBe(true); // Known bypasses the floor
    expect(edgeRank(track({ key: 19 }), track({ key: 19 }), 2).known).toBe(2);
  });

  it('key relation follows the EDGE direction: up out, down back', () => {
    // 10m → 11m is one up (17.5); the reverse edge is one down (15).
    expect(edgeRank(track({ key: 19 }), track({ key: 21 }), null).score).toBe(17.5);
    expect(edgeRank(track({ key: 21 }), track({ key: 19 }), null).score).toBe(15);
  });

  it('the floor cuts clashing and keyless bare edges', () => {
    expect(edgeRank(track({ key: 19 }), track({ key: 9 }), null).admitted).toBe(false);
    expect(edgeRank(track({ key: 19 }), track({}), null).admitted).toBe(false);
    // Every compatible key relation admits by itself — down sits exactly
    // on the floor.
    expect(edgeRank(track({ key: 21 }), track({ key: 19 }), null).admitted).toBe(true);
  });
});

describe('suggestAppend — candidates out of the last Track', () => {
  // Last track 10m (Cm). Known strengths are OUT OF the last track.
  const last = track({ id: 100, key: 19 });

  it('orders Known first, then score; the floor cuts unrelated edges', () => {
    const candidates = [
      track({ id: 1, key: 9 }), // clash: cut by the floor
      track({ id: 2, key: 21 }), // one up: 17.5
      track({ id: 3, key: 17 }), // one down: 15
      track({ id: 4, key: 19 }), // same: 25
      track({ id: 5, key: 18 }), // relative: 20
      track({ id: 6, key: 9 }), // favorited Transition out of last → Known
    ];
    const known = (id: number) => (id === 6 ? 0 : null);
    const ranked = suggestAppend(candidates, new Set(), last, known);
    expect(ranked.map((s) => s.track.id)).toEqual([6, 4, 5, 2, 3]);
    expect(ranked[0].rank.known).toBe(0);
    expect(ranked.slice(1).map((s) => s.rank.score)).toEqual([25, 20, 17.5, 15]);
  });

  it('a many-signal candidate outranks a bare same-key one', () => {
    const shared = { artist: 'Noisia', tags: [{ id: 1, name: 't1' }] } as Partial<Track>;
    const reference = track({ id: 100, key: 19, ...shared });
    const bareSameKey = track({ id: 1, key: 19 });
    const clashButClose = track({ id: 2, key: 9, ...shared });
    const ranked = suggestAppend([bareSameKey, clashButClose], new Set(), reference, NONE);
    expect(ranked.map((s) => s.track.id)).toEqual([2, 1]);
  });

  it('excludes Tracks already in the Set', () => {
    const candidates = [track({ id: 1, key: 19 }), track({ id: 2, key: 19 })];
    const ranked = suggestAppend(candidates, new Set([1, 100]), last, NONE);
    expect(ranked.map((s) => s.track.id)).toEqual([2]);
  });

  it('is stable within ties (incoming order holds)', () => {
    const candidates = [track({ id: 7, key: 19 }), track({ id: 8, key: 19 })];
    expect(suggestAppend(candidates, new Set(), last, NONE).map((s) => s.track.id)).toEqual([
      7, 8,
    ]);
  });
});

describe('suggestInsert — both edges, ranked by the weaker', () => {
  // Insert between two 10m (Cm) tracks unless stated otherwise.
  const pred = track({ id: 100, key: 19 });
  const succ = track({ id: 101, key: 19 });

  it('one great edge + one inadmissible edge is CUT — both edges must clear the floor', () => {
    const compatible = track({ id: 1, key: 19 }); // same key both ways
    const oneGreat = track({ id: 2, key: 9 }); // favorited OUT of pred, clash INTO succ
    const knownOut = (id: number) => (id === 2 ? 0 : null);
    const ranked = suggestInsert([oneGreat, compatible], new Set(), pred, succ, knownOut, NONE);
    expect(ranked.map((s) => s.track.id)).toEqual([1]);
  });

  it('ranks by the weaker edge, tie-breaking by the stronger', () => {
    // Both candidates' weaker edge is relative (20); one is Linked out of
    // the predecessor — the stronger edge (Known) breaks the tie.
    const plain = track({ id: 1, key: 18 }); // relative both ways: 20/20
    const linkedOut = track({ id: 2, key: 18 }); // Known out of pred, relative in
    const knownOut = (id: number) => (id === 2 ? 1 : null);
    const ranked = suggestInsert([plain, linkedOut], new Set(), pred, succ, knownOut, NONE);
    expect(ranked.map((s) => s.track.id)).toEqual([2, 1]);
  });

  it('weakerRank picks the edge that ranks later in the shared order', () => {
    const outRank = { known: null, score: 25, admitted: true };
    const inRank = { known: null, score: 15, admitted: true };
    expect(weakerRank({ outRank, inRank })).toBe(inRank);
    expect(weakerRank({ outRank: inRank, inRank: outRank })).toBe(inRank);
    // A Known edge is never the weaker one against an admitted heuristic.
    const knownEdge = { known: 2, score: 0, admitted: true };
    expect(weakerRank({ outRank: knownEdge, inRank })).toBe(inRank);
  });

  it('the into-successor lookup lifts only the incoming edge', () => {
    // Saved Transition candidate→succ: in-edge Known; out-edge clashes →
    // still cut (both edges must be admitted).
    const cand = track({ id: 1, key: 9 });
    const knownInto = (id: number) => (id === 1 ? 2 : null);
    expect(suggestInsert([cand], new Set(), pred, succ, NONE, knownInto)).toEqual([]);
    // With an admissible out-edge, the in-edge carries its Known rank.
    const candUp = track({ id: 2, key: 21 }); // pred 10m → 11m: up (admitted)
    const knownInto2 = (id: number) => (id === 2 ? 2 : null);
    const [s] = suggestInsert([candUp], new Set(), pred, succ, NONE, knownInto2);
    expect(s.outRank.score).toBe(17.5);
    expect(s.inRank.known).toBe(2);
  });

  it('key direction holds per edge: up out of pred, down into succ', () => {
    // pred 10m, succ 10m, candidate 11m: out up (17.5), in down (15).
    const [s] = suggestInsert([track({ id: 1, key: 21 })], new Set(), pred, succ, NONE, NONE);
    expect(s.outRank.score).toBe(17.5);
    expect(s.inRank.score).toBe(15);
  });

  it('excludes Tracks already in the Set and is stable within ties', () => {
    const candidates = [
      track({ id: 1, key: 19 }),
      track({ id: 2, key: 19 }),
      track({ id: 3, key: 19 }),
    ];
    const ranked = suggestInsert(candidates, new Set([2]), pred, succ, NONE, NONE);
    expect(ranked.map((s) => s.track.id)).toEqual([1, 3]);
  });
});
