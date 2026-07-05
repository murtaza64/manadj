/**
 * Set store — promotion re-pointing mirror (sets 08, ADR 0023): after
 * the server rewrites Take pins at the promotion endpoint, loaded Sets
 * must mirror the rewrite locally (client-authoritative entries — a
 * later wholesale PUT would otherwise clobber the migration).
 *
 * Dormancy wiring (sets 07): every order-changing mutation routes
 * through the reconcile rule (the rule itself is covered in
 * dormancy.test.ts — here we test the store's plumbing: state, pushes,
 * per-Set isolation, and the local mirrors covering Dormant memories).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/client', () => ({
  api: {
    sets: {
      get: vi.fn(),
      replaceEntries: vi.fn().mockResolvedValue({}),
    },
  },
}));

import { api } from '../api/client';
import type { DormantPin } from './dormancy';
import {
  _resetSetStoreForTests,
  degradeDeletedPinsLocal,
  ensureSetEntriesLoaded,
  getSetDormantPins,
  getSetEntries,
  insertTrackIntoSet,
  removeTrackFromSet,
  reorderSetEntries,
  replaceSetEntries,
  repointTakePinsLocal,
  setAdjacencyPin,
  setAdjacencyPins,
} from './setStore';

const mocked = api as unknown as {
  sets: { get: ReturnType<typeof vi.fn>; replaceEntries: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
  mocked.sets.replaceEntries.mockResolvedValue({});
  _resetSetStoreForTests();
});

describe('repointTakePinsLocal', () => {
  it('rewrites the matching Take pin to the Transition in every loaded Set', () => {
    replaceSetEntries(1, [
      { trackId: 10, pin: { kind: 'take', uuid: 'tk-1' } },
      { trackId: 11, pin: null },
    ]);
    replaceSetEntries(2, [
      { trackId: 10, pin: { kind: 'take', uuid: 'tk-1' } },
      { trackId: 12, pin: { kind: 'take', uuid: 'tk-2' } },
      { trackId: 13, pin: { kind: 'transition', uuid: 'tr-1' } },
    ]);

    repointTakePinsLocal('tk-1', 'tr-9');

    expect(getSetEntries(1)).toEqual([
      { trackId: 10, pin: { kind: 'transition', uuid: 'tr-9' } },
      { trackId: 11, pin: null },
    ]);
    // Other Take pins and Transition pins untouched.
    expect(getSetEntries(2)).toEqual([
      { trackId: 10, pin: { kind: 'transition', uuid: 'tr-9' } },
      { trackId: 12, pin: { kind: 'take', uuid: 'tk-2' } },
      { trackId: 13, pin: { kind: 'transition', uuid: 'tr-1' } },
    ]);
  });

  it('does not push — the server already rewrote its rows', () => {
    replaceSetEntries(1, [{ trackId: 10, pin: { kind: 'take', uuid: 'tk-1' } }]);
    mocked.sets.replaceEntries.mockClear();

    repointTakePinsLocal('tk-1', 'tr-9');

    expect(mocked.sets.replaceEntries).not.toHaveBeenCalled();
  });

  it('is a no-op when nothing references the Take', () => {
    replaceSetEntries(1, [{ trackId: 10, pin: { kind: 'transition', uuid: 'tr-1' } }]);

    repointTakePinsLocal('tk-1', 'tr-9');

    expect(getSetEntries(1)).toEqual([{ trackId: 10, pin: { kind: 'transition', uuid: 'tr-1' } }]);
  });
});

describe('dormancy wiring (sets 07)', () => {
  const dormantOf = (setId: number) => getSetDormantPins(setId) ?? [];

  it('reorder away and back restores the exact prior pins, pushing dormant wholesale', () => {
    replaceSetEntries(1, [
      { trackId: 10, pin: { kind: 'transition', uuid: 'tr-1' } },
      { trackId: 11, pin: { kind: 'take', uuid: 'tk-1' } },
      { trackId: 12, pin: null },
    ]);
    mocked.sets.replaceEntries.mockClear();

    reorderSetEntries(1, [11, 10, 12]);

    expect(getSetEntries(1)).toEqual([
      { trackId: 11, pin: null },
      { trackId: 10, pin: null },
      { trackId: 12, pin: null },
    ]);
    expect(dormantOf(1)).toEqual([
      { aTrackId: 10, bTrackId: 11, pin: { kind: 'transition', uuid: 'tr-1' } },
      { aTrackId: 11, bTrackId: 12, pin: { kind: 'take', uuid: 'tk-1' } },
    ]);
    // The wholesale PUT carries the dormant list.
    expect(mocked.sets.replaceEntries).toHaveBeenLastCalledWith(
      1,
      [
        { track_id: 11, pin_kind: null, pin_uuid: null },
        { track_id: 10, pin_kind: null, pin_uuid: null },
        { track_id: 12, pin_kind: null, pin_uuid: null },
      ],
      [
        { a_track_id: 10, b_track_id: 11, pin_kind: 'transition', pin_uuid: 'tr-1' },
        { a_track_id: 11, b_track_id: 12, pin_kind: 'take', pin_uuid: 'tk-1' },
      ]
    );

    reorderSetEntries(1, [10, 11, 12]);

    expect(getSetEntries(1)).toEqual([
      { trackId: 10, pin: { kind: 'transition', uuid: 'tr-1' } },
      { trackId: 11, pin: { kind: 'take', uuid: 'tk-1' } },
      { trackId: 12, pin: null },
    ]);
    expect(dormantOf(1)).toEqual([]);
  });

  it('never leaks Dormant pins to other loaded Sets', () => {
    replaceSetEntries(1, [
      { trackId: 10, pin: { kind: 'transition', uuid: 'tr-1' } },
      { trackId: 11, pin: null },
    ]);
    replaceSetEntries(2, [
      { trackId: 10, pin: { kind: 'transition', uuid: 'tr-2' } },
      { trackId: 11, pin: null },
    ]);

    reorderSetEntries(1, [11, 10]);

    expect(dormantOf(1)).toEqual([
      { aTrackId: 10, bTrackId: 11, pin: { kind: 'transition', uuid: 'tr-1' } },
    ]);
    expect(dormantOf(2)).toEqual([]);
    expect(getSetEntries(2)![0].pin).toEqual({ kind: 'transition', uuid: 'tr-2' });
  });

  it('insert sends the predecessor pin Dormant instead of riding the new pair (issue 10 reconciled)', () => {
    replaceSetEntries(1, [
      { trackId: 10, pin: { kind: 'transition', uuid: 'tr-1' } },
      { trackId: 11, pin: null },
    ]);

    insertTrackIntoSet(1, 99, 1);

    expect(getSetEntries(1)).toEqual([
      { trackId: 10, pin: null },
      { trackId: 99, pin: null },
      { trackId: 11, pin: null },
    ]);
    expect(dormantOf(1)).toEqual([
      { aTrackId: 10, bTrackId: 11, pin: { kind: 'transition', uuid: 'tr-1' } },
    ]);
  });

  it('remove breaks both pins Dormant; re-adding the track restores them', async () => {
    replaceSetEntries(1, [
      { trackId: 10, pin: { kind: 'transition', uuid: 'tr-1' } },
      { trackId: 11, pin: { kind: 'take', uuid: 'tk-1' } },
      { trackId: 12, pin: null },
    ]);

    removeTrackFromSet(1, 11);
    expect(getSetEntries(1)).toEqual([
      { trackId: 10, pin: null },
      { trackId: 12, pin: null },
    ]);
    expect(dormantOf(1)).toEqual([
      { aTrackId: 10, bTrackId: 11, pin: { kind: 'transition', uuid: 'tr-1' } },
      { aTrackId: 11, bTrackId: 12, pin: { kind: 'take', uuid: 'tk-1' } },
    ]);

    // Re-insert between them: both memories wake.
    insertTrackIntoSet(1, 11, 1);
    expect(getSetEntries(1)).toEqual([
      { trackId: 10, pin: { kind: 'transition', uuid: 'tr-1' } },
      { trackId: 11, pin: { kind: 'take', uuid: 'tk-1' } },
      { trackId: 12, pin: null },
    ]);
    expect(dormantOf(1)).toEqual([]);
  });

  it('an explicit pin retires the Dormant memory for the same ordered pair', () => {
    replaceSetEntries(
      1,
      [
        { trackId: 10, pin: null },
        { trackId: 11, pin: null },
      ],
      [{ aTrackId: 10, bTrackId: 11, pin: { kind: 'transition', uuid: 'tr-old' } }] as DormantPin[]
    );

    setAdjacencyPin(1, 10, { kind: 'transition', uuid: 'tr-new' });

    expect(getSetEntries(1)![0].pin).toEqual({ kind: 'transition', uuid: 'tr-new' });
    expect(dormantOf(1)).toEqual([]);
  });

  it('repointTakePinsLocal rewrites Dormant Take memories too, without pushing', () => {
    replaceSetEntries(
      1,
      [{ trackId: 10, pin: null }],
      [{ aTrackId: 10, bTrackId: 11, pin: { kind: 'take', uuid: 'tk-1' } }]
    );
    mocked.sets.replaceEntries.mockClear();

    repointTakePinsLocal('tk-1', 'tr-9');

    expect(dormantOf(1)).toEqual([
      { aTrackId: 10, bTrackId: 11, pin: { kind: 'transition', uuid: 'tr-9' } },
    ]);
    expect(mocked.sets.replaceEntries).not.toHaveBeenCalled();
  });

  it('set-wide auto-fill accept retires Dormant memories for the pinned pairs', () => {
    replaceSetEntries(
      1,
      [
        { trackId: 10, pin: null },
        { trackId: 11, pin: null },
        { trackId: 12, pin: null },
      ],
      [
        { aTrackId: 10, bTrackId: 11, pin: { kind: 'transition', uuid: 'tr-old' } },
        { aTrackId: 20, bTrackId: 21, pin: { kind: 'take', uuid: 'tk-x' } },
      ]
    );

    setAdjacencyPins(1, new Map([[10, { kind: 'transition', uuid: 'tr-new' } as const]]));

    expect(getSetEntries(1)![0].pin).toEqual({ kind: 'transition', uuid: 'tr-new' });
    // Only the pinned pair's memory retires; unrelated memories survive.
    expect(dormantOf(1)).toEqual([
      { aTrackId: 20, bTrackId: 21, pin: { kind: 'take', uuid: 'tk-x' } },
    ]);
  });

  it('load normalizes self-inconsistent server state through the reconcile rule', async () => {
    mocked.sets.get.mockResolvedValue({
      id: 1,
      entries: [
        { track_id: 10, position: 0, pin_kind: null, pin_uuid: null },
        { track_id: 11, position: 1, pin_kind: null, pin_uuid: null },
      ],
      // A memory for a currently-adjacent unpinned pair: wakes on read.
      dormant: [
        { a_track_id: 10, b_track_id: 11, pin_kind: 'take', pin_uuid: 'tk-1' },
      ],
    });

    await ensureSetEntriesLoaded(1);

    expect(getSetEntries(1)).toEqual([
      { trackId: 10, pin: { kind: 'take', uuid: 'tk-1' } },
      { trackId: 11, pin: null },
    ]);
    expect(dormantOf(1)).toEqual([]);
    // Local-only: normalization never pushes.
    expect(mocked.sets.replaceEntries).not.toHaveBeenCalled();
  });

  it('degradeDeletedPinsLocal drops Dormant memories of the artifact, kind-aware', () => {
    replaceSetEntries(
      1,
      [{ trackId: 10, pin: null }],
      [
        { aTrackId: 10, bTrackId: 11, pin: { kind: 'take', uuid: 'shared' } },
        { aTrackId: 11, bTrackId: 12, pin: { kind: 'transition', uuid: 'shared' } },
      ]
    );
    mocked.sets.replaceEntries.mockClear();

    degradeDeletedPinsLocal('take', 'shared');

    expect(dormantOf(1)).toEqual([
      { aTrackId: 11, bTrackId: 12, pin: { kind: 'transition', uuid: 'shared' } },
    ]);
    expect(mocked.sets.replaceEntries).not.toHaveBeenCalled();
  });
});

describe('degradeDeletedPinsLocal (sets 12)', () => {
  it('nulls matching pins in every loaded Set, kind-aware, without pushing', () => {
    replaceSetEntries(1, [
      { trackId: 10, pin: { kind: 'take', uuid: 'tk-1' } },
      { trackId: 11, pin: { kind: 'transition', uuid: 'tk-1' } }, // same uuid, other kind
      { trackId: 12, pin: null },
    ]);
    replaceSetEntries(2, [{ trackId: 10, pin: { kind: 'take', uuid: 'tk-1' } }]);
    mocked.sets.replaceEntries.mockClear();

    degradeDeletedPinsLocal('take', 'tk-1');

    expect(getSetEntries(1)).toEqual([
      { trackId: 10, pin: null },
      { trackId: 11, pin: { kind: 'transition', uuid: 'tk-1' } },
      { trackId: 12, pin: null },
    ]);
    expect(getSetEntries(2)).toEqual([{ trackId: 10, pin: null }]);
    // Local-only: the deletion endpoint already nulled the rows.
    expect(mocked.sets.replaceEntries).not.toHaveBeenCalled();
  });
});
