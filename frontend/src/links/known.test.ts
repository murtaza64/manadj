/**
 * Known-tier helpers (linked-pairs 04): Known = Linked ∪ saved Transition
 * (glossary). Strength within the tier: favorited Transition, then
 * Linked, then unfavorited Transition — a pair takes its best.
 */
import { describe, expect, it } from 'vitest';
import { buildTransitionIndex, transitionsFrom } from '../editor/transitionIndex';
import type { PairStore, SavedTransition } from '../editor/pairStore';
import { KNOWN_FAVORITED, KNOWN_LINKED, KNOWN_SAVED, knownStrengthOf } from './known';
import { linkKeyOf } from './linkStore';

const saved = (favorite = false): SavedTransition => ({
  uuid: `u${Math.random()}`,
  name: 'drop swap',
  favorite,
  transition: { startSec: 30, durationSec: 20, bInSec: 31, lanes: {} } as SavedTransition['transition'],
});

const fromRef = (store: PairStore, refId: number) =>
  transitionsFrom(buildTransitionIndex(store), refId);

const links = (...pairs: [number, number][]) => new Set(pairs.map(([a, b]) => linkKeyOf(a, b)));

describe('knownStrengthOf (pair takes its best)', () => {
  it('favorited Transition outranks everything', () => {
    const from = fromRef({ '1:2': { items: [saved(true)], active: 0 } }, 1);
    expect(knownStrengthOf(from, links([1, 2]), 1, 2)).toBe(KNOWN_FAVORITED);
  });

  it('Linked outranks an unfavorited Transition', () => {
    const from = fromRef({ '1:2': { items: [saved(false)], active: 0 } }, 1);
    expect(knownStrengthOf(from, links([1, 2]), 1, 2)).toBe(KNOWN_LINKED);
  });

  it('an unfavorited Transition alone is Known at the weakest strength', () => {
    const from = fromRef({ '1:2': { items: [saved(false)], active: 0 } }, 1);
    expect(knownStrengthOf(from, links(), 1, 2)).toBe(KNOWN_SAVED);
  });

  it('a bare Link is Known', () => {
    const from = fromRef({}, 1);
    expect(knownStrengthOf(from, links([2, 1]), 1, 2)).toBe(KNOWN_LINKED);
  });

  it('unrelated pairs are not Known', () => {
    const from = fromRef({ '1:9': { items: [saved(true)], active: 0 } }, 1);
    expect(knownStrengthOf(from, links([1, 8]), 1, 2)).toBe(null);
  });

  it('the Transition direction is FROM the reference (follow semantics)', () => {
    // A Transition 2→1 does not make 2 a "next track" candidate for 1.
    const from = fromRef({ '2:1': { items: [saved(true)], active: 0 } }, 1);
    expect(knownStrengthOf(from, links(), 1, 2)).toBe(null);
  });

  it('strengths order favorited < linked < saved (ascending = stronger first)', () => {
    expect(KNOWN_FAVORITED).toBeLessThan(KNOWN_LINKED);
    expect(KNOWN_LINKED).toBeLessThan(KNOWN_SAVED);
  });
});
