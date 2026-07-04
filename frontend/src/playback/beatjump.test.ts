import { describe, expect, it } from 'vitest';
import {
  BEATJUMP_DEFAULT,
  BEATJUMP_MAX,
  BEATJUMP_MIN,
  PERFORMANCE_BEATJUMP_DEFAULT,
  clampBeatjump,
  doubleBeatjump,
  halveBeatjump,
} from './beatjump';

describe('beatjump size', () => {
  it('defaults to 32 within the 1-128 bounds', () => {
    expect(BEATJUMP_DEFAULT).toBe(32);
    expect(BEATJUMP_MIN).toBe(1);
    expect(BEATJUMP_MAX).toBe(128);
  });

  it('keeps the editor alias on the one shared default (until slice 05)', () => {
    expect(PERFORMANCE_BEATJUMP_DEFAULT).toBe(BEATJUMP_DEFAULT);
  });

  it('halves down to the floor and stops', () => {
    expect(halveBeatjump(32)).toBe(16);
    expect(halveBeatjump(2)).toBe(1);
    expect(halveBeatjump(1)).toBe(1);
  });

  it('doubles up to the ceiling and stops', () => {
    expect(doubleBeatjump(32)).toBe(64);
    expect(doubleBeatjump(64)).toBe(128);
    expect(doubleBeatjump(128)).toBe(128);
  });

  it('clamps arbitrary values into bounds', () => {
    expect(clampBeatjump(0)).toBe(1);
    expect(clampBeatjump(500)).toBe(128);
    expect(clampBeatjump(48)).toBe(48);
  });
});
