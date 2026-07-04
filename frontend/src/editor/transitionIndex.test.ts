/**
 * Transition-library 02 — index correctness (direction, sources,
 * Preferred-pair derivation).
 */
import { describe, expect, it } from 'vitest';
import { defaultMix } from './mixModel';
import { buildTransitionIndex, transitionsFrom, transitionsInto } from './transitionIndex';
import type { PairStore } from './pairStore';

const item = (name: string, favorite = false) => ({
  name,
  transition: { ...defaultMix().transition, durationSec: 8 },
  favorite,
});

describe('buildTransitionIndex', () => {
  const store: PairStore = {
    '1:2': { items: [item('a'), item('b', true)], active: 0 },
    '2:1': { items: [item('reverse')], active: 0 },
    '1:3': { items: [item('sketch')], active: 0 },
  };
  const index = buildTransitionIndex(store);

  it('is direction-aware: A→B saved does not mark B→A', () => {
    expect(transitionsFrom(index, 1).has(2)).toBe(true);
    expect(transitionsFrom(index, 2).has(1)).toBe(true); // its own entry
    expect(transitionsFrom(index, 3).size).toBe(0); // nothing outgoing from 3
    expect(transitionsInto(index, 3).has(1)).toBe(true);
    expect(transitionsInto(index, 1).has(2)).toBe(true); // only via 2:1
    expect(transitionsInto(index, 1).has(3)).toBe(false);
  });

  it('derives Preferred per ordered pair (≥1 favorite)', () => {
    expect(transitionsFrom(index, 1).get(2)?.preferred).toBe(true);
    expect(transitionsFrom(index, 2).get(1)?.preferred).toBe(false); // reverse pair unaffected
    expect(transitionsFrom(index, 1).get(3)?.preferred).toBe(false);
  });

  it('counts transitions per pair', () => {
    expect(transitionsFrom(index, 1).get(2)?.count).toBe(2);
    expect(transitionsFrom(index, 1).get(3)?.count).toBe(1);
  });

  it('handles unknown/null tracks with an empty result', () => {
    expect(transitionsFrom(index, 99).size).toBe(0);
    expect(transitionsFrom(index, null).size).toBe(0);
    expect(transitionsInto(index, undefined).size).toBe(0);
  });

  it('ignores empty entries and malformed keys', () => {
    const idx = buildTransitionIndex({
      '5:6': { items: [], active: 0 },
      'garbage': { items: [item('x')], active: 0 },
    });
    expect(idx.from.size).toBe(0);
  });
});
