/**
 * Match score (match-score PRD) — the pure scoring seam. Expected values
 * are independent literals from the PRD's curves and weights, never
 * recomputed through the code under test.
 *
 * Engine key ids (keyTable.generated.ts): 19=10m(Cm), 21=11m(Gm, +1),
 * 17=9m(Fm, −1), 18=10d(Eb, relative), 9=5m(C#m, unrelated), 1=1m, 23=12m.
 */
import { describe, expect, it } from 'vitest';
import type { Tag, Track } from '../types';
import {
  AFFINITY_FLOOR,
  affinitySubtotal,
  bpmContribution,
  compareRanks,
  energyContribution,
  foldedBpmDistancePercent,
  keyRelation,
  matchScore,
  passesAffinityFloor,
  rankAgainst,
  tagContribution,
  WEIGHTS,
} from './matchScore';

function tag(id: number): Tag {
  return { id, name: `t${id}` } as unknown as Tag;
}

function track(fields: Partial<Track> = {}): Track {
  return { id: 1, filename: '/t/1.mp3', tags: [], ...fields } as unknown as Track;
}

describe('keyRelation', () => {
  it('walks the wheel ladder', () => {
    expect(keyRelation(19, 19)).toBe('same');
    expect(keyRelation(19, 18)).toBe('relative');
    expect(keyRelation(19, 21)).toBe('up');
    expect(keyRelation(19, 17)).toBe('down');
    expect(keyRelation(19, 9)).toBe('other'); // clash, not punished
  });

  it('wraps the wheel at 12↔1', () => {
    expect(keyRelation(23, 1)).toBe('up'); // 12m → 1m
    expect(keyRelation(1, 23)).toBe('down'); // 1m → 12m
  });

  it('cross-mode non-relative is other', () => {
    expect(keyRelation(19, 20)).toBe('other'); // 10m vs 11d
  });

  it('missing keys are other (neutral, never punished)', () => {
    expect(keyRelation(undefined, 19)).toBe('other');
    expect(keyRelation(19, undefined)).toBe('other');
    expect(keyRelation(null, null)).toBe('other');
  });
});

describe('tagContribution', () => {
  it('is zero at zero and log-shaped: steep at first', () => {
    expect(tagContribution(0)).toBe(0);
    // First shared tag is worth ~a third of the whole tag budget.
    expect(tagContribution(1)).toBeGreaterThan(0.3);
    // Early steps dwarf late steps.
    const early = tagContribution(2) - tagContribution(1);
    const late = tagContribution(8) - tagContribution(7);
    expect(early).toBeGreaterThan(late * 2);
  });

  it('reaches 1.0 at the norm count and keeps growing (never flat)', () => {
    expect(tagContribution(8)).toBeCloseTo(1.0, 10);
    expect(tagContribution(9)).toBeGreaterThan(tagContribution(8));
    for (let n = 1; n <= 12; n++) {
      expect(tagContribution(n)).toBeGreaterThan(tagContribution(n - 1));
    }
  });
});

describe('energyContribution', () => {
  it('is asymmetric around the reference: rise slightly over drop', () => {
    expect(energyContribution(3, 3)).toBe(1.0);
    expect(energyContribution(3, 4)).toBe(0.9);
    expect(energyContribution(3, 2)).toBe(0.7);
  });

  it('cuts off at |ΔE| ≥ 2', () => {
    expect(energyContribution(3, 5)).toBe(0);
    expect(energyContribution(3, 1)).toBe(0);
  });

  it('missing energy is neutral', () => {
    expect(energyContribution(null, 3)).toBe(0);
    expect(energyContribution(3, undefined)).toBe(0);
  });
});

describe('bpmContribution (dyadic fold)', () => {
  it('is flat 1.0 within 2% of the center', () => {
    expect(bpmContribution(174, 174, 5)).toBe(1.0);
    expect(bpmContribution(174, 177, 5)).toBe(1.0); // 1.7%
  });

  it('decays linearly from the flat zone to the gate edge', () => {
    // threshold 5%: distance 3.5% sits halfway through the 2..5 decay.
    expect(bpmContribution(200, 207, 5)).toBeCloseTo(0.5, 10);
    expect(bpmContribution(200, 210, 5)).toBe(0); // at the edge
    expect(bpmContribution(200, 220, 5)).toBe(0); // beyond
  });

  it('half/double-time folds are first-class: 87 under 174 scores full', () => {
    expect(foldedBpmDistancePercent(174, 87)).toBe(0);
    expect(bpmContribution(174, 87, 5)).toBe(1.0);
    expect(bpmContribution(87, 174, 5)).toBe(1.0);
    // proximity measured on the fold, no half-time discount
    expect(bpmContribution(174, 88, 5)).toBeCloseTo(bpmContribution(174, 176, 5), 5);
  });

  it('missing BPM is neutral', () => {
    expect(bpmContribution(null, 174)).toBe(0);
    expect(bpmContribution(174, undefined)).toBe(0);
  });
});

describe('affinity floor', () => {
  const reference = track({
    id: 999,
    key: 19,
    bpm: 174,
    energy: 3,
    artist: 'Noisia',
    tags: [tag(1), tag(2), tag(3)],
  });

  it('the weakest compatible key alone passes — the floor definition', () => {
    expect(AFFINITY_FLOOR).toBe(WEIGHTS.key * 0.6);
    expect(passesAffinityFloor(reference, track({ key: 17 }))).toBe(true); // −1 wheel
  });

  it('a shared artist alone passes', () => {
    expect(passesAffinityFloor(reference, track({ artist: 'Noisia & Phace' }))).toBe(true);
  });

  it('two shared tags pass exactly; one does not', () => {
    expect(affinitySubtotal(reference, track({ tags: [tag(1), tag(2)] }))).toBeCloseTo(
      AFFINITY_FLOOR,
      10
    );
    expect(passesAffinityFloor(reference, track({ tags: [tag(1), tag(2)] }))).toBe(true);
    expect(passesAffinityFloor(reference, track({ tags: [tag(1)] }))).toBe(false);
  });

  it('BPM + energy comfort alone never admits (context orders, never admits)', () => {
    const comfortable = track({ bpm: 174, energy: 3 }); // no key/tags/artist
    expect(matchScore(reference, comfortable)).toBe(WEIGHTS.energy + WEIGHTS.bpm);
    expect(passesAffinityFloor(reference, comfortable)).toBe(false);
  });

  it('a keyless candidate with artist + tags passes — the PRD headline case', () => {
    const keyless = track({ artist: 'Noisia', tags: [tag(1), tag(2), tag(3)] });
    expect(passesAffinityFloor(reference, keyless)).toBe(true);
    // …and outscores a bare same-key candidate.
    expect(matchScore(reference, keyless)).toBeGreaterThan(
      matchScore(reference, track({ key: 19 }))
    );
  });
});

describe('matchScore composition', () => {
  const reference = track({
    id: 999,
    key: 19,
    bpm: 174,
    energy: 3,
    artist: 'Noisia',
    tags: [1, 2, 3, 4, 5, 6, 7, 8].map(tag),
  });

  it('a full match across all five signals scores the full budget', () => {
    const twin = track({
      key: 19,
      bpm: 174,
      energy: 3,
      artist: 'Noisia',
      tags: [1, 2, 3, 4, 5, 6, 7, 8].map(tag),
    });
    expect(matchScore(reference, twin)).toBeCloseTo(100, 10);
  });

  it('an empty candidate scores zero — unboosted, never punished', () => {
    expect(matchScore(reference, track({}))).toBe(0);
  });

  it('key clash earns nothing and costs nothing relative to missing key', () => {
    const clash = track({ key: 9, tags: [tag(1), tag(2)] });
    const keyless = track({ tags: [tag(1), tag(2)] });
    expect(matchScore(reference, clash)).toBe(matchScore(reference, keyless));
  });
});

describe('rankAgainst + compareRanks (the one total edge order)', () => {
  const referenceA = {
    track: track({ id: 100, key: 19, bpm: 174, tags: [tag(1)] }),
    knownStrength: (id: number) => (id === 7 ? 2 : null),
  };
  const referenceB = {
    track: track({ id: 200, key: 9, bpm: 140, tags: [tag(2), tag(3)] }),
    knownStrength: () => null,
  };

  it('Known bypasses the floor and pins above any score', () => {
    const bare = track({ id: 7 }); // no signals at all, but Known to A
    const rank = rankAgainst(bare, [referenceA, referenceB]);
    expect(rank.known).toBe(2);
    expect(rank.admitted).toBe(true);
    const scored = rankAgainst(
      track({ id: 8, key: 19, bpm: 174, tags: [tag(1)], artist: undefined }),
      [referenceA, referenceB]
    );
    expect(scored.known).toBeNull();
    expect(compareRanks(rank, scored)).toBeLessThan(0); // Known first
  });

  it('dual-follow: best position wins on both axes', () => {
    const candidate = track({ id: 9, key: 9, tags: [tag(2), tag(3)] }); // matches B, not A
    const rank = rankAgainst(candidate, [referenceA, referenceB]);
    expect(rank.admitted).toBe(true); // B admits (same key + two tags)
    expect(rank.score).toBe(matchScore(referenceB.track, candidate));
  });

  it('Known strata order internally; Compatible orders by score descending', () => {
    const favorited = { known: 0, score: 0, admitted: true };
    const saved = { known: 2, score: 100, admitted: true };
    const strong = { known: null, score: 80, admitted: true };
    const weak = { known: null, score: 20, admitted: true };
    expect(compareRanks(favorited, saved)).toBeLessThan(0); // strength beats score
    expect(compareRanks(saved, strong)).toBeLessThan(0); // any Known over any score
    expect(compareRanks(strong, weak)).toBeLessThan(0);
    expect([weak, favorited, strong, saved].sort(compareRanks).map((r) => r.score)).toEqual([
      0, 100, 80, 20,
    ]);
  });
});
