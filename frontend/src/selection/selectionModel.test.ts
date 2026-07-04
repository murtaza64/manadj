import { describe, expect, it } from 'vitest';

import {
  EMPTY_SELECTION,
  click,
  isSelected,
  navigate,
  prune,
  rangeClick,
  selectAll,
  toggleClick,
  type Selection,
} from './selectionModel';

const ORDER = [10, 20, 30, 40, 50];

describe('click', () => {
  it('selects exactly the clicked row and anchors it', () => {
    const sel = click({ ids: [10, 20], anchorId: 20 }, 40);
    expect(sel).toEqual({ ids: [40], anchorId: 40 });
  });
});

describe('toggleClick', () => {
  it('accumulates in click order and moves the anchor to the added row', () => {
    let sel: Selection = EMPTY_SELECTION;
    sel = toggleClick(sel, 30);
    sel = toggleClick(sel, 10);
    expect(sel).toEqual({ ids: [30, 10], anchorId: 10 });
  });

  it('removes a selected row, keeping the anchor if it survives', () => {
    const sel = toggleClick({ ids: [30, 10], anchorId: 10 }, 30);
    expect(sel).toEqual({ ids: [10], anchorId: 10 });
  });

  it('falls back to the last selected row when the anchor is removed', () => {
    const sel = toggleClick({ ids: [30, 10], anchorId: 10 }, 10);
    expect(sel).toEqual({ ids: [30], anchorId: 30 });
  });

  it('empties cleanly', () => {
    const sel = toggleClick({ ids: [30], anchorId: 30 }, 30);
    expect(sel).toEqual({ ids: [], anchorId: null });
  });
});

describe('rangeClick', () => {
  it('selects anchor..target in table order, downward', () => {
    const sel = rangeClick({ ids: [20], anchorId: 20 }, 40, ORDER);
    expect(sel).toEqual({ ids: [20, 30, 40], anchorId: 40 });
  });

  it('selects target..anchor in table order, upward', () => {
    const sel = rangeClick({ ids: [40], anchorId: 40 }, 20, ORDER);
    expect(sel).toEqual({ ids: [20, 30, 40], anchorId: 20 });
  });

  it('replaces any prior selection', () => {
    const sel = rangeClick({ ids: [50, 10], anchorId: 10 }, 30, ORDER);
    expect(sel).toEqual({ ids: [10, 20, 30], anchorId: 30 });
  });

  it('degrades to a plain click without a usable anchor', () => {
    expect(rangeClick(EMPTY_SELECTION, 30, ORDER)).toEqual({ ids: [30], anchorId: 30 });
    // anchor not in the current order (e.g. filtered away)
    expect(rangeClick({ ids: [99], anchorId: 99 }, 30, ORDER)).toEqual({ ids: [30], anchorId: 30 });
  });

  it('range across a re-sorted order uses the current visible order', () => {
    const reversed = [...ORDER].reverse(); // 50..10
    const sel = rangeClick({ ids: [20], anchorId: 20 }, 40, reversed);
    expect(sel).toEqual({ ids: [40, 30, 20], anchorId: 40 });
  });
});

describe('navigate', () => {
  it('collapses a multi-selection to a single row from the anchor', () => {
    const sel = navigate({ ids: [20, 30, 40], anchorId: 40 }, 1, ORDER);
    expect(sel).toEqual({ ids: [50], anchorId: 50 });
  });

  it('clamps at the edges', () => {
    expect(navigate({ ids: [10], anchorId: 10 }, -1, ORDER)).toEqual({ ids: [10], anchorId: 10 });
    expect(navigate({ ids: [50], anchorId: 50 }, 1, ORDER)).toEqual({ ids: [50], anchorId: 50 });
  });

  it('starts at the first row when nothing is selected', () => {
    expect(navigate(EMPTY_SELECTION, 1, ORDER)).toEqual({ ids: [10], anchorId: 10 });
  });

  it('is a no-op on an empty list', () => {
    expect(navigate(EMPTY_SELECTION, 1, [])).toBe(EMPTY_SELECTION);
  });
});

describe('selectAll', () => {
  it('selects all visible rows in table order, keeping a visible anchor', () => {
    const sel = selectAll({ ids: [30], anchorId: 30 }, ORDER);
    expect(sel).toEqual({ ids: ORDER, anchorId: 30 });
  });

  it('anchors the last row when there was no visible anchor', () => {
    expect(selectAll(EMPTY_SELECTION, ORDER).anchorId).toBe(50);
    expect(selectAll(EMPTY_SELECTION, []).anchorId).toBe(null);
  });
});

describe('prune', () => {
  it('drops ids that are no longer visible', () => {
    const sel = prune({ ids: [10, 99, 30], anchorId: 30 }, ORDER);
    expect(sel).toEqual({ ids: [10, 30], anchorId: 30 });
  });

  it('moves the anchor to the last survivor when it vanishes', () => {
    const sel = prune({ ids: [10, 99], anchorId: 99 }, ORDER);
    expect(sel).toEqual({ ids: [10], anchorId: 10 });
  });

  it('returns the same object when nothing changed', () => {
    const sel: Selection = { ids: [10, 30], anchorId: 30 };
    expect(prune(sel, ORDER)).toBe(sel);
  });
});

describe('isSelected', () => {
  it('reflects membership', () => {
    expect(isSelected({ ids: [10, 30], anchorId: 30 }, 30)).toBe(true);
    expect(isSelected({ ids: [10, 30], anchorId: 30 }, 20)).toBe(false);
  });
});
