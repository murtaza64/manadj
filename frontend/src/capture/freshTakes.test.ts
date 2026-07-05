/**
 * Fresh-Take surfacing (sets 13): latest-per-pair store + the chip
 * matching rule. Pure module state, no DOM.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetFreshTakesForTests,
  clearFreshTake,
  freshTakeChip,
  recordFreshTake,
  snapshotFreshTakes,
  subscribeFreshTakes,
} from './freshTakes';

beforeEach(() => _resetFreshTakesForTests());

describe('latest-per-ordered-pair store', () => {
  it('records the latest take for an ordered pair (repeated attempts replace)', () => {
    recordFreshTake(1, 2, 'take-1');
    recordFreshTake(1, 2, 'take-2');
    recordFreshTake(1, 2, 'take-3');
    expect(snapshotFreshTakes()['1:2']).toEqual({ uuid: 'take-3' });
  });

  it('direction is meaning: a:b and b:a are distinct adjacencies', () => {
    recordFreshTake(1, 2, 'forward');
    recordFreshTake(2, 1, 'backward');
    expect(snapshotFreshTakes()['1:2']).toEqual({ uuid: 'forward' });
    expect(snapshotFreshTakes()['2:1']).toEqual({ uuid: 'backward' });
  });

  it('clear removes the pair entry; other pairs stay', () => {
    recordFreshTake(1, 2, 'a');
    recordFreshTake(3, 4, 'b');
    clearFreshTake(1, 2);
    expect(snapshotFreshTakes()['1:2']).toBeUndefined();
    expect(snapshotFreshTakes()['3:4']).toEqual({ uuid: 'b' });
  });

  it('notifies subscribers on record and clear, with fresh snapshot identity', () => {
    const fn = vi.fn();
    const unsub = subscribeFreshTakes(fn);
    const before = snapshotFreshTakes();
    recordFreshTake(1, 2, 'a');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(snapshotFreshTakes()).not.toBe(before);
    clearFreshTake(1, 2);
    expect(fn).toHaveBeenCalledTimes(2);
    unsub();
    recordFreshTake(1, 2, 'b');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('freshTakeChip (the "new take — pin?" matching rule)', () => {
  it('offers the latest fresh take on the matching adjacency', () => {
    recordFreshTake(1, 2, 'take-9');
    expect(freshTakeChip(snapshotFreshTakes(), 1, 2, null)).toEqual({ uuid: 'take-9' });
  });

  it('no chip on non-matching adjacencies', () => {
    recordFreshTake(1, 2, 'take-9');
    expect(freshTakeChip(snapshotFreshTakes(), 2, 3, null)).toBeNull();
  });

  it('suppressed once that take IS the pin (the click did its job)', () => {
    recordFreshTake(1, 2, 'take-9');
    expect(freshTakeChip(snapshotFreshTakes(), 1, 2, 'take-9')).toBeNull();
  });

  it('still offered when a DIFFERENT pin holds the adjacency (never auto-pinned)', () => {
    recordFreshTake(1, 2, 'take-9');
    expect(freshTakeChip(snapshotFreshTakes(), 1, 2, 'transition-1')).toEqual({
      uuid: 'take-9',
    });
  });
});
