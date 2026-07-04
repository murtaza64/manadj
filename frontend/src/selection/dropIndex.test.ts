import { describe, expect, it } from 'vitest';

import {
  applyReorder,
  indicatorY,
  insertionIndexFromPointer,
  splitByMembership,
  type RowRect,
} from './dropIndex';

/** Five 20px rows starting at y=0. */
const ROWS: RowRect[] = Array.from({ length: 5 }, (_, i) => ({ top: i * 20, height: 20 }));

describe('insertionIndexFromPointer', () => {
  it('above the first midline inserts at 0', () => {
    expect(insertionIndexFromPointer(5, ROWS)).toBe(0);
  });

  it('below a midline inserts after that row', () => {
    expect(insertionIndexFromPointer(15, ROWS)).toBe(1);
    expect(insertionIndexFromPointer(50, ROWS)).toBe(3); // exactly on row 2's midline → after
  });

  it('past every midline appends', () => {
    expect(insertionIndexFromPointer(95, ROWS)).toBe(5);
    expect(insertionIndexFromPointer(500, ROWS)).toBe(5);
  });

  it('empty list appends at 0', () => {
    expect(insertionIndexFromPointer(50, [])).toBe(0);
  });
});

describe('indicatorY', () => {
  it('draws at the target row top, or after the last row for append', () => {
    expect(indicatorY(0, ROWS)).toBe(0);
    expect(indicatorY(3, ROWS)).toBe(60);
    expect(indicatorY(5, ROWS)).toBe(100);
    expect(indicatorY(0, [])).toBe(0);
  });
});

describe('applyReorder', () => {
  const ORDER = [1, 2, 3, 4, 5];

  it('moves a single row down (insertion index counts pre-removal rows)', () => {
    // Drag row 2 to sit before row 5 (insert index 4).
    expect(applyReorder(ORDER, [2], 4)).toEqual([1, 3, 4, 2, 5]);
  });

  it('moves a single row up', () => {
    expect(applyReorder(ORDER, [4], 1)).toEqual([1, 4, 2, 3, 5]);
  });

  it('moves a contiguous block without change when dropped onto itself', () => {
    expect(applyReorder(ORDER, [2, 3], 2)).toEqual(ORDER);
    expect(applyReorder(ORDER, [2, 3], 1)).toEqual(ORDER);
  });

  it('moves a discontiguous multi-selection in payload order', () => {
    // Move 1 and 4 (selection order [4, 1]) before row 3 (index 2).
    expect(applyReorder(ORDER, [4, 1], 2)).toEqual([2, 4, 1, 3, 5]);
  });

  it('appends at the end', () => {
    expect(applyReorder(ORDER, [1], 5)).toEqual([2, 3, 4, 5, 1]);
  });

  it('ignores ids not in the order', () => {
    expect(applyReorder(ORDER, [99, 3], 0)).toEqual([3, 1, 2, 4, 5]);
  });
});

describe('splitByMembership', () => {
  it('partitions preserving payload order', () => {
    expect(splitByMembership([5, 1, 6, 2], new Set([1, 2, 3]))).toEqual({
      newIds: [5, 6],
      presentIds: [1, 2],
    });
  });
});
