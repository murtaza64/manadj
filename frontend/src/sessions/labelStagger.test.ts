/** Gesture-label staggering (sessions 21): greedy row assignment. */
import { describe, expect, it } from 'vitest';
import { staggerRows } from './labelStagger';

describe('staggerRows', () => {
  it('non-overlapping labels all stay on the base row', () => {
    const rows = staggerRows(
      [
        { x0: 0, x1: 10 },
        { x0: 10, x1: 20 },
        { x0: 30, x1: 40 },
      ],
      3
    );
    expect(rows).toEqual([0, 0, 0]);
  });

  it('overlapping labels fan down one row at a time', () => {
    const rows = staggerRows(
      [
        { x0: 0, x1: 20 },
        { x0: 5, x1: 25 },
        { x0: 10, x1: 30 },
      ],
      3
    );
    expect(rows).toEqual([0, 1, 2]);
  });

  it('a freed row is reused (no gratuitous motion after a cluster)', () => {
    const rows = staggerRows(
      [
        { x0: 0, x1: 20 },
        { x0: 5, x1: 12 },
        { x0: 25, x1: 35 }, // row 0 free again (20 <= 25)
      ],
      3
    );
    expect(rows).toEqual([0, 1, 0]);
  });

  it('rows never overlap horizontally within the row budget', () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ x0: i * 4, x1: i * 4 + 14 }));
    const rows = staggerRows(items, 4);
    const lastEnd: Record<number, number> = {};
    let overflowed = false;
    items.forEach((it, i) => {
      const r = rows[i];
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(4);
      if ((lastEnd[r] ?? -Infinity) > it.x0) overflowed = true;
      lastEnd[r] = Math.max(lastEnd[r] ?? -Infinity, it.x1);
    });
    // 14px-wide labels every 4px need 4 concurrent rows — within budget,
    // no same-row overlap is allowed.
    expect(overflowed).toBe(false);
  });

  it('over budget, drops onto the earliest-freeing row (bounded overlap)', () => {
    const rows = staggerRows(
      [
        { x0: 0, x1: 30 },
        { x0: 1, x1: 20 },
        { x0: 2, x1: 40 },
      ],
      2
    );
    // Third label overlaps, but lands on the row freeing earliest (row 1,
    // ends at 20) rather than fanning past the budget.
    expect(rows).toEqual([0, 1, 1]);
  });

  it('empty input yields empty output', () => {
    expect(staggerRows([], 3)).toEqual([]);
  });
});
