/**
 * Dormant pins (sets 07) — pure functions under vitest.
 *
 * Reordering (or removal) never destroys a pin: `reconcileOrderChange`
 * is the single rule for what happens to pins when a Set's track order
 * changes. Kept exported and pure on purpose — issue 18's multi-row
 * blocks reuse the same restore/degrade logic.
 */
import { describe, expect, it } from 'vitest';
import type { AdjacencyPin } from './adjacency';
import {
  previewAdjacencyFutures,
  reconcileOrderChange,
  type DormantPin,
  type OrderedEntry,
} from './dormancy';

const tr = (uuid: string): AdjacencyPin => ({ kind: 'transition', uuid });
const tk = (uuid: string): AdjacencyPin => ({ kind: 'take', uuid });
const en = (trackId: number, pin: AdjacencyPin | null = null): OrderedEntry => ({ trackId, pin });
const dp = (aTrackId: number, bTrackId: number, pin: AdjacencyPin): DormantPin => ({
  aTrackId,
  bTrackId,
  pin,
});

describe('reconcileOrderChange', () => {
  it('keeps a pin whose ordered pair stays adjacent through a reorder', () => {
    const { entries, dormant } = reconcileOrderChange(
      [en(1, tr('tr-1')), en(2), en(3)],
      [],
      [3, 1, 2]
    );
    expect(entries).toEqual([en(3), en(1, tr('tr-1')), en(2)]);
    expect(dormant).toEqual([]);
  });

  it('breaks pins into Dormant pins and restores them when reordered back (Transitions and Takes)', () => {
    const original = [en(1, tr('tr-1')), en(2, tk('tk-1')), en(3)];

    const away = reconcileOrderChange(original, [], [2, 1, 3]);
    expect(away.entries).toEqual([en(2), en(1), en(3)]);
    expect(away.dormant).toEqual([dp(1, 2, tr('tr-1')), dp(2, 3, tk('tk-1'))]);

    const back = reconcileOrderChange(away.entries, away.dormant, [1, 2, 3]);
    expect(back.entries).toEqual([en(1, tr('tr-1')), en(2, tk('tk-1')), en(3)]);
    expect(back.dormant).toEqual([]);
  });

  it('round-trips a Hard-cut pin like any pin (sets 26): breaks Dormant, restores on re-adjacency', () => {
    const hardcut: AdjacencyPin = { kind: 'hardcut' };
    const original = [en(1, hardcut), en(2), en(3)];

    const away = reconcileOrderChange(original, [], [2, 1, 3]);
    expect(away.entries).toEqual([en(2), en(1), en(3)]);
    expect(away.dormant).toEqual([dp(1, 2, hardcut)]);

    const back = reconcileOrderChange(away.entries, away.dormant, [1, 2, 3]);
    expect(back.entries).toEqual([en(1, hardcut), en(2), en(3)]);
    expect(back.dormant).toEqual([]);
  });

  it('is strictly per ordered pair: the reversed pair does not restore', () => {
    const { entries, dormant } = reconcileOrderChange([en(1), en(2)], [dp(2, 1, tr('tr-1'))], [1, 2]);
    expect(entries).toEqual([en(1), en(2)]);
    expect(dormant).toEqual([dp(2, 1, tr('tr-1'))]);
  });

  it('removal breaks both adjacencies around the removed track; re-adding restores', () => {
    const original = [en(1, tr('tr-1')), en(2, tk('tk-1')), en(3)];

    const removed = reconcileOrderChange(original, [], [1, 3]);
    expect(removed.entries).toEqual([en(1), en(3)]);
    expect(removed.dormant).toEqual([dp(1, 2, tr('tr-1')), dp(2, 3, tk('tk-1'))]);

    const restored = reconcileOrderChange(removed.entries, removed.dormant, [1, 2, 3]);
    expect(restored.entries).toEqual([en(1, tr('tr-1')), en(2, tk('tk-1')), en(3)]);
    expect(restored.dormant).toEqual([]);
  });

  it('insert between a pinned pair sends the pin Dormant instead of riding the new adjacency', () => {
    const { entries, dormant } = reconcileOrderChange([en(1, tr('tr-1')), en(2)], [], [1, 9, 2]);
    expect(entries).toEqual([en(1), en(9), en(2)]);
    expect(dormant).toEqual([dp(1, 2, tr('tr-1'))]);
  });

  it('a fresh break overwrites an older Dormant memory for the same pair', () => {
    const { dormant } = reconcileOrderChange(
      [en(1, tr('tr-new')), en(2)],
      [dp(1, 2, tr('tr-old'))],
      [2, 1]
    );
    expect(dormant).toEqual([dp(1, 2, tr('tr-new'))]);
  });

  it('keeps Dormant memories whose tracks left the Set entirely', () => {
    const { entries, dormant } = reconcileOrderChange(
      [en(1), en(2)],
      [dp(7, 8, tk('tk-7'))],
      [1, 2]
    );
    expect(entries).toEqual([en(1), en(2)]);
    expect(dormant).toEqual([dp(7, 8, tk('tk-7'))]);
  });

  it('ignores a (meaningless) pin on the last entry instead of stashing it', () => {
    const { entries, dormant } = reconcileOrderChange([en(1), en(2, tr('tr-x'))], [], [2, 1]);
    expect(entries).toEqual([en(2), en(1)]);
    expect(dormant).toEqual([]);
  });

  it('restores onto a newly added track (manual pin memory honored on re-add)', () => {
    // Track 2 was removed earlier; its Take pin waits as a Dormant pin.
    const { entries, dormant } = reconcileOrderChange(
      [en(1), en(3)],
      [dp(1, 2, tk('tk-1'))],
      [1, 2, 3]
    );
    expect(entries).toEqual([en(1, tk('tk-1')), en(2), en(3)]);
    expect(dormant).toEqual([]);
  });

  it('an active pin on a still-adjacent pair wins over a stale Dormant memory', () => {
    const { entries, dormant } = reconcileOrderChange(
      [en(1, tr('tr-active')), en(2)],
      [dp(1, 2, tr('tr-stale'))],
      [1, 2]
    );
    expect(entries).toEqual([en(1, tr('tr-active')), en(2)]);
    // The stale memory is dropped — a pair never carries two pins.
    expect(dormant).toEqual([]);
  });
});

describe('previewAdjacencyFutures', () => {
  const noTransitions = () => false;

  it('marks unchanged adjacencies null (unaffected by the hypothetical order)', () => {
    const futures = previewAdjacencyFutures(
      [en(1, tr('tr-1')), en(2), en(3)],
      [],
      [1, 2, 3],
      noTransitions
    );
    expect(futures).toEqual([null, null]);
  });

  it('marks a pair with a Dormant pin will-restore', () => {
    const futures = previewAdjacencyFutures(
      [en(2), en(1), en(3)],
      [dp(1, 2, tr('tr-1'))],
      [1, 2, 3],
      noTransitions
    );
    // (2,3) was not adjacent in [2,1,3] either — it is affected too.
    expect(futures).toEqual(['will-restore', 'unresolved']);
  });

  it('marks a new pair with a library Transition auto-resolves, else unresolved', () => {
    const futures = previewAdjacencyFutures(
      [en(1), en(2), en(3)],
      [],
      [2, 1, 3],
      (a, b) => a === 2 && b === 1
    );
    expect(futures).toEqual(['auto-resolves', 'unresolved']);
  });

  it('a Dormant pin outranks an available library Transition (will-restore)', () => {
    const futures = previewAdjacencyFutures(
      [en(1), en(2)],
      [dp(2, 1, tk('tk-1'))],
      [2, 1],
      () => true
    );
    expect(futures).toEqual(['will-restore']);
  });
});
