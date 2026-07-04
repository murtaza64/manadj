import { describe, expect, it } from 'vitest';

import { clampToViewport } from '../components/ContextMenu';
import { TRACKS_MIME, isTrackDrag, readTrackDragPayload, setTrackDragPayload } from './trackDrag';

/** Minimal DataTransfer stand-in (node has no DataTransfer). */
function fakeDataTransfer(): DataTransfer {
  const store = new Map<string, string>();
  return {
    setData: (k: string, v: string) => void store.set(k, v),
    getData: (k: string) => store.get(k) ?? '',
    get types() {
      return [...store.keys()];
    },
    effectAllowed: 'none',
  } as unknown as DataTransfer;
}

describe('track drag payload', () => {
  it('round-trips an ordered id list', () => {
    const dt = fakeDataTransfer();
    setTrackDragPayload(dt, [30, 10, 20]);
    expect(readTrackDragPayload(dt)).toEqual([30, 10, 20]);
    expect(isTrackDrag(dt)).toBe(true);
  });

  it('keeps the legacy single-id entry for older drop targets', () => {
    const dt = fakeDataTransfer();
    setTrackDragPayload(dt, [30, 10]);
    expect(dt.getData('trackId')).toBe('30');
  });

  it('falls back to the legacy payload', () => {
    const dt = fakeDataTransfer();
    dt.setData('trackId', '42');
    expect(readTrackDragPayload(dt)).toEqual([42]);
  });

  it('rejects malformed payloads', () => {
    const dt = fakeDataTransfer();
    dt.setData(TRACKS_MIME, '{"not": "a list"}');
    expect(readTrackDragPayload(dt)).toEqual([]);
    const dt2 = fakeDataTransfer();
    expect(isTrackDrag(dt2)).toBe(false);
    expect(readTrackDragPayload(dt2)).toEqual([]);
  });
});

describe('clampToViewport', () => {
  it('leaves a fitting menu alone', () => {
    expect(clampToViewport(100, 100, 200, 300, 1000, 800)).toEqual({ x: 100, y: 100 });
  });

  it('pulls an overflowing menu back inside', () => {
    expect(clampToViewport(900, 700, 200, 300, 1000, 800)).toEqual({ x: 800, y: 500 });
  });

  it('never goes negative', () => {
    expect(clampToViewport(-10, 790, 2000, 300, 1000, 800)).toEqual({ x: 0, y: 500 });
  });
});
