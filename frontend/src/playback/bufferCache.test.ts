/** Decoded-buffer LRU (mix-editor 28). AudioBuffer is opaque here. */
import { afterEach, describe, expect, it } from 'vitest';
import {
  _clearBufferCacheForTests,
  getCachedBuffer,
  invalidateCachedBuffer,
  putCachedBuffer,
} from './bufferCache';

const buf = (label: string) => ({ label }) as unknown as AudioBuffer;

afterEach(() => _clearBufferCacheForTests());

describe('bufferCache', () => {
  it('stores and retrieves by trackId', () => {
    const b = buf('one');
    putCachedBuffer(1, b);
    expect(getCachedBuffer(1)).toBe(b);
    expect(getCachedBuffer(2)).toBeUndefined();
  });

  it('evicts the least recently used beyond 4 entries', () => {
    for (let i = 1; i <= 4; i++) putCachedBuffer(i, buf(`${i}`));
    getCachedBuffer(1); // refresh 1 — 2 becomes LRU
    putCachedBuffer(5, buf('5'));
    expect(getCachedBuffer(2)).toBeUndefined();
    expect(getCachedBuffer(1)).toBeDefined();
    expect(getCachedBuffer(5)).toBeDefined();
  });

  it('re-putting refreshes recency and replaces the value', () => {
    for (let i = 1; i <= 4; i++) putCachedBuffer(i, buf(`${i}`));
    const fresh = buf('1-replaced');
    putCachedBuffer(1, fresh); // 2 is now LRU
    putCachedBuffer(5, buf('5'));
    expect(getCachedBuffer(1)).toBe(fresh);
    expect(getCachedBuffer(2)).toBeUndefined();
  });

  it('invalidate drops a single track', () => {
    putCachedBuffer(1, buf('one'));
    invalidateCachedBuffer(1);
    expect(getCachedBuffer(1)).toBeUndefined();
  });
});
