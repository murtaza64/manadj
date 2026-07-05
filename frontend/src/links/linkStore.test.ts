/**
 * Link store seam (linked-pairs 01): symmetric Linked pairs.
 *
 * Linked is one fact per unordered pair of distinct Tracks — the store's
 * canonical key normalizes order, so every read and write is symmetric.
 * Persistence glue (boot GET / write-through PUT) is thin IO around the
 * snapshot; these tests exercise the snapshot behavior.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetLinkStoreForTests,
  applyLinkRows,
  isLinked,
  linkKeyOf,
  setLinked,
  snapshotLinks,
  subscribeLinks,
} from './linkStore';

beforeEach(() => {
  _resetLinkStoreForTests();
  // Fake at the network seam: the optimistic snapshot is under test; the
  // write-through must never reach a real backend (or its real DB).
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{"linked": true}', { status: 200 }))
  );
});

describe('linkKeyOf (canonical unordered pair)', () => {
  it('normalizes order', () => {
    expect(linkKeyOf(7, 3)).toBe('3:7');
    expect(linkKeyOf(3, 7)).toBe('3:7');
  });
});

describe('isLinked', () => {
  it('reads symmetrically', () => {
    applyLinkRows([{ low_track_id: 3, high_track_id: 7 }]);
    const links = snapshotLinks();
    expect(isLinked(links, 3, 7)).toBe(true);
    expect(isLinked(links, 7, 3)).toBe(true);
    expect(isLinked(links, 3, 9)).toBe(false);
  });

  it('a Track is never Linked to itself', () => {
    applyLinkRows([{ low_track_id: 3, high_track_id: 7 }]);
    expect(isLinked(snapshotLinks(), 3, 3)).toBe(false);
  });
});

describe('setLinked (optimistic toggle)', () => {
  it('updates the snapshot synchronously and notifies, either input order', () => {
    const seen: number[] = [];
    subscribeLinks(() => seen.push(snapshotLinks().size));

    setLinked(7, 3, true);
    expect(isLinked(snapshotLinks(), 3, 7)).toBe(true);
    expect(seen).toEqual([1]);

    setLinked(3, 7, false); // other order clears the same fact
    expect(isLinked(snapshotLinks(), 7, 3)).toBe(false);
    expect(seen).toEqual([1, 0]);
  });

  it('no-ops when the state already matches (no notify churn)', () => {
    setLinked(3, 7, true);
    const before = snapshotLinks();
    const seen: unknown[] = [];
    subscribeLinks(() => seen.push(null));

    setLinked(7, 3, true);
    expect(snapshotLinks()).toBe(before); // same snapshot object — no write
    expect(seen).toEqual([]);
  });

  it('ignores self-pairs', () => {
    setLinked(5, 5, true);
    expect(snapshotLinks().size).toBe(0);
  });

  it('links accumulate across pairs', () => {
    setLinked(1, 2, true);
    setLinked(2, 3, true);
    setLinked(1, 2, false);
    expect(isLinked(snapshotLinks(), 2, 3)).toBe(true);
    expect(isLinked(snapshotLinks(), 1, 2)).toBe(false);
  });
});
