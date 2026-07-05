/**
 * Linkable hint predicate (linked-pairs 02): a pair with a favorited
 * Transition and no Link is "linkable" — the toggle suggests promoting
 * it. Direction-agnostic: a favorite in either direction counts (Linked
 * is symmetric; Transitions are directional).
 */
import { describe, expect, it } from 'vitest';
import { buildTransitionIndex } from '../editor/transitionIndex';
import type { PairStore } from '../editor/pairStore';
import type { SavedTransition } from '../editor/pairStore';
import { pairHasFavoritedTransition } from './linkable';

const saved = (favorite = false): SavedTransition => ({
  uuid: `u${Math.random()}`,
  name: 'drop swap',
  favorite,
  transition: { startSec: 30, durationSec: 20, bInSec: 31, lanes: {} } as SavedTransition['transition'],
});

const index = (store: PairStore) => buildTransitionIndex(store);

describe('pairHasFavoritedTransition', () => {
  it('true when the A→B direction has a favorite', () => {
    const idx = index({ '3:7': { items: [saved(true)], active: 0 } });
    expect(pairHasFavoritedTransition(idx, 3, 7)).toBe(true);
    expect(pairHasFavoritedTransition(idx, 7, 3)).toBe(true); // symmetric read
  });

  it('true when only the reverse direction has a favorite', () => {
    const idx = index({ '7:3': { items: [saved(true)], active: 0 } });
    expect(pairHasFavoritedTransition(idx, 3, 7)).toBe(true);
  });

  it('false when the pair has only unfavorited Transitions', () => {
    const idx = index({
      '3:7': { items: [saved(false)], active: 0 },
      '7:3': { items: [saved(false)], active: 0 },
    });
    expect(pairHasFavoritedTransition(idx, 3, 7)).toBe(false);
  });

  it('false when the pair has no Transitions at all', () => {
    const idx = index({ '3:9': { items: [saved(true)], active: 0 } });
    expect(pairHasFavoritedTransition(idx, 3, 7)).toBe(false);
  });

  it('false for null or self pairs', () => {
    const idx = index({ '3:3': { items: [saved(true)], active: 0 } });
    expect(pairHasFavoritedTransition(idx, null, 7)).toBe(false);
    expect(pairHasFavoritedTransition(idx, 3, null)).toBe(false);
    expect(pairHasFavoritedTransition(idx, 3, 3)).toBe(false);
  });
});
