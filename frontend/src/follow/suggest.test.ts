/**
 * Set-building suggestions (sets 10) — pure ranking beside the Follow
 * model, in its suite's style: expected tiers are independent literals
 * from OpenKey theory and the PRD's tiering (known: favorited=0,
 * linked=1, saved=2; then same=3, relative=4, up=5, down=6, rest=7),
 * never recomputed through the code under test.
 *
 * Engine key ids (keyUtils): 19=10m(Cm) 18=10d(Eb) 21=11m(Gm) 17=9m(Fm)
 * 9=5m(C#m) 23=12m(Dm) 1=1m(Am).
 */
import { describe, expect, it } from 'vitest';

import type { Track } from '../types';
import { edgeTier, suggestAppend, suggestInsert } from './suggest';

function track(fields: Partial<Track> = {}): Track {
  return {
    id: 1,
    filename: '/t/1.mp3',
    tags: [],
    ...fields,
  } as unknown as Track;
}

const NONE = () => null;

describe('edgeTier — one ordered edge, from → to', () => {
  it('known strength trumps every key tier', () => {
    expect(edgeTier(track({ key: 19 }), track({ key: 9 }), 0)).toBe(0); // favorited
    expect(edgeTier(track({ key: 19 }), track({ key: 9 }), 1)).toBe(1); // linked
    expect(edgeTier(track({ key: 19 }), track({ key: 19 }), 2)).toBe(2); // saved beats same-key
  });

  it('key tiers follow the EDGE direction: up is from→to up the wheel', () => {
    // 10m → 11m is one up (tier 5); the reverse edge is one down (tier 6).
    expect(edgeTier(track({ key: 19 }), track({ key: 21 }), null)).toBe(5);
    expect(edgeTier(track({ key: 21 }), track({ key: 19 }), null)).toBe(6);
  });

  it('same, relative, unrelated, keyless', () => {
    expect(edgeTier(track({ key: 19 }), track({ key: 19 }), null)).toBe(3);
    expect(edgeTier(track({ key: 19 }), track({ key: 18 }), null)).toBe(4); // 10m→10d relative
    expect(edgeTier(track({ key: 19 }), track({ key: 9 }), null)).toBe(7); // 10m→5m unrelated
    expect(edgeTier(track({ key: 19 }), track({ key: undefined }), null)).toBe(7);
    expect(edgeTier(track({ key: undefined }), track({ key: 19 }), null)).toBe(7);
  });
});

describe('suggestAppend — candidates out of the last Track', () => {
  // Last track 10m (Cm). Known strengths are OUT OF the last track.
  const last = track({ id: 100, key: 19 });

  it('ranks by Follow tiering with direction respected', () => {
    const candidates = [
      track({ id: 1, key: 9 }), // unrelated → 7
      track({ id: 2, key: 21 }), // 11m: one up out of 10m → 5
      track({ id: 3, key: 17 }), // 9m: one down → 6
      track({ id: 4, key: 19 }), // same → 3
      track({ id: 5, key: 18 }), // relative → 4
      track({ id: 6, key: 9 }), // favorited Transition out of last → 0
    ];
    const known = (id: number) => (id === 6 ? 0 : null);
    const ranked = suggestAppend(candidates, new Set(), last, known);
    expect(ranked.map((s) => s.track.id)).toEqual([6, 4, 5, 2, 3, 1]);
    expect(ranked.map((s) => s.tier)).toEqual([0, 3, 4, 5, 6, 7]);
  });

  it('excludes Tracks already in the Set', () => {
    const candidates = [track({ id: 1, key: 19 }), track({ id: 2, key: 19 })];
    const ranked = suggestAppend(candidates, new Set([1, 100]), last, NONE);
    expect(ranked.map((s) => s.track.id)).toEqual([2]);
  });

  it('is stable within a tier (incoming order holds)', () => {
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

  it('a both-edges-Compatible candidate outranks one great edge + one clash', () => {
    const compatible = track({ id: 1, key: 19 }); // same key both ways: 3/3
    const oneGreat = track({ id: 2, key: 9 }); // favorited OUT of pred, clashes INTO succ: 0/7
    const knownOut = (id: number) => (id === 2 ? 0 : null);
    const ranked = suggestInsert([oneGreat, compatible], new Set(), pred, succ, knownOut, NONE);
    expect(ranked.map((s) => s.track.id)).toEqual([1, 2]);
    expect(ranked[0]).toMatchObject({ outTier: 3, inTier: 3 });
    expect(ranked[1]).toMatchObject({ outTier: 0, inTier: 7 });
  });

  it('ties on the weaker edge break by the stronger edge', () => {
    // Both candidates' weaker edge is 4 (relative key); one is Linked out
    // of the predecessor (stronger edge 1 beats 4).
    const plain = track({ id: 1, key: 18 }); // 10d: relative both ways → 4/4
    const linkedOut = track({ id: 2, key: 18 }); // linked out of pred → 1/4
    const knownOut = (id: number) => (id === 2 ? 1 : null);
    const ranked = suggestInsert([plain, linkedOut], new Set(), pred, succ, knownOut, NONE);
    expect(ranked.map((s) => s.track.id)).toEqual([2, 1]);
  });

  it('the into-successor lookup scores only the incoming edge', () => {
    // Saved Transition candidate→succ (strength 2) lifts the in-edge only.
    const cand = track({ id: 1, key: 9 }); // unrelated key both ways
    const knownInto = (id: number) => (id === 1 ? 2 : null);
    const [s] = suggestInsert([cand], new Set(), pred, succ, NONE, knownInto);
    expect(s).toMatchObject({ outTier: 7, inTier: 2 });
  });

  it('key direction holds per edge: up out of pred, down into succ', () => {
    // pred 10m, succ 10m, candidate 11m: 10m→11m up (5), 11m→10m down (6).
    const [s] = suggestInsert([track({ id: 1, key: 21 })], new Set(), pred, succ, NONE, NONE);
    expect(s).toMatchObject({ outTier: 5, inTier: 6 });
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
