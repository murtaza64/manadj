/** Decoded-buffer byte-budget LRU (mix-editor 28; stems #211). AudioBuffer
 * is faked with just the fields the byte math reads. */
import { afterEach, describe, expect, it } from 'vitest';
import {
  _cachedBytesForTests,
  _clearBufferCacheForTests,
  getCachedBuffer,
  getCachedStems,
  invalidateCachedBuffer,
  putCachedBuffer,
  putCachedStems,
} from './bufferCache';

/** A fake decode of `mb` megabytes (stereo float32). */
const buf = (label: string, mb = 80) =>
  ({ label, length: (mb * 2 ** 20) / 8, numberOfChannels: 2 }) as unknown as AudioBuffer;

const stems = (label: string, mbEach = 80) =>
  ['vocals', 'drums', 'bass', 'other'].map((s) => buf(`${label}-${s}`, mbEach));

afterEach(() => _clearBufferCacheForTests());

describe('bufferCache', () => {
  it('stores and retrieves by trackId', () => {
    const b = buf('one');
    putCachedBuffer(1, b);
    expect(getCachedBuffer(1)).toBe(b);
    expect(getCachedBuffer(2)).toBeUndefined();
  });

  it('evicts the least recently used beyond the byte budget', () => {
    // 80 MB singles: budget (1.25 GiB) fits 16 — the old count budget
    // never evicted this early; the byte budget must.
    for (let i = 1; i <= 16; i++) putCachedBuffer(i, buf(`${i}`));
    getCachedBuffer(2); // refresh 2 — 1 is now the LRU
    putCachedBuffer(17, buf('17'));
    expect(getCachedBuffer(1)).toBeUndefined(); // oldest fell out
    expect(getCachedBuffer(2)).toBeDefined(); // refreshed survivor
    expect(getCachedBuffer(17)).toBeDefined();
  });

  it('a stems entry weighs ~4 singles (stems #211)', () => {
    // 4×80 MB stems entries: five of them bust the 1.25 GiB budget where
    // the old 4-entry count budget would happily hold ~1.6 GB.
    for (let i = 1; i <= 5; i++) putCachedStems(i, stems(`${i}`));
    expect(getCachedStems(1)).toBeUndefined();
    expect(getCachedStems(5)).toBeDefined();
    expect(_cachedBytesForTests()).toBeLessThanOrEqual(1.25 * 2 ** 30);
  });

  it('keeps the newest entry even when it alone exceeds the budget', () => {
    putCachedStems(1, stems('huge', 400)); // 1.6 GB entry
    expect(getCachedStems(1)).toBeDefined();
  });

  it('single and stems coexist under one trackId', () => {
    const single = buf('one');
    const four = stems('one');
    putCachedBuffer(1, single);
    putCachedStems(1, four);
    expect(getCachedBuffer(1)).toBe(single);
    expect(getCachedStems(1)).toBe(four);
  });

  it('re-putting refreshes recency and replaces the value', () => {
    for (let i = 1; i <= 16; i++) putCachedBuffer(i, buf(`${i}`));
    const fresh = buf('1-replaced');
    putCachedBuffer(1, fresh); // 2 is now LRU
    putCachedBuffer(17, buf('17'));
    expect(getCachedBuffer(1)).toBe(fresh);
    expect(getCachedBuffer(2)).toBeUndefined();
  });

  it('invalidate drops both shapes for a track', () => {
    putCachedBuffer(1, buf('one'));
    putCachedStems(1, stems('one'));
    invalidateCachedBuffer(1);
    expect(getCachedBuffer(1)).toBeUndefined();
    expect(getCachedStems(1)).toBeUndefined();
  });
});
