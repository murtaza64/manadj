import { expect, it } from 'vitest';
import { resizedShares } from './FitColumnHeaders';
it('resizes only neighbouring columns, conserving total table width', () => {
  const source = [5, 28, 17, 8, 7, 16, 19];
  const next = resizedShares(source, 1, 9);
  expect(next).toEqual([5, 37, 8, 8, 7, 16, 19]);
  expect(source[1]).toBe(28);
  for (const delta of [-1000, -30, -3, 0, 1, 30, 1000]) {
    const result = resizedShares(source, 1, delta);
    expect(result.reduce((a, b) => a + b, 0)).toBe(100);
    expect(result[1]).toBeGreaterThanOrEqual(4);
    expect(result[2]).toBeGreaterThanOrEqual(4);
  }
});
