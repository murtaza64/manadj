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
  linkedIdsOf,
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

  it('no-ops when the state already matches (no notify churn, once booted)', () => {
    applyLinkRows([{ low_track_id: 3, high_track_id: 7 }]); // booted
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

  it('writes through to the pair endpoint', () => {
    setLinked(7, 3, true);
    const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBe(1);
    const [url, init] = calls[0];
    expect(String(url)).toContain('/track-links/pair/7/3');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ linked: true });
  });

  it('a toggle racing the boot load survives it (optimistic overlay)', () => {
    // The user links before the boot GET resolves; the arriving rows must
    // not silently revert the toggle (the PUT already persisted it).
    setLinked(7, 3, true);
    setLinked(4, 5, false); // pre-boot unlink of a pair the boot will bring
    applyLinkRows([{ low_track_id: 4, high_track_id: 5 }]); // boot resolves late
    expect(isLinked(snapshotLinks(), 3, 7)).toBe(true);
    expect(isLinked(snapshotLinks(), 4, 5)).toBe(false);
  });
});

describe('linkedIdsOf', () => {
  it('collects the other end of every Link touching the track', () => {
    applyLinkRows([
      { low_track_id: 1, high_track_id: 2 },
      { low_track_id: 1, high_track_id: 3 },
      { low_track_id: 4, high_track_id: 5 },
    ]);
    expect(linkedIdsOf(snapshotLinks(), 1)).toEqual(new Set([2, 3]));
    expect(linkedIdsOf(snapshotLinks(), 5)).toEqual(new Set([4]));
    expect(linkedIdsOf(snapshotLinks(), 9)).toEqual(new Set());
  });
});
