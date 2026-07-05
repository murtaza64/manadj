/**
 * Set store — promotion re-pointing mirror (sets 08, ADR 0023): after
 * the server rewrites Take pins at the promotion endpoint, loaded Sets
 * must mirror the rewrite locally (client-authoritative entries — a
 * later wholesale PUT would otherwise clobber the migration).
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
import {
  _resetSetStoreForTests,
  degradeDeletedPinsLocal,
  getSetEntries,
  replaceSetEntries,
  repointTakePinsLocal,
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
