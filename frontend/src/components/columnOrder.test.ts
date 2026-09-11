import { describe, expect, it } from 'vitest';
import { COLUMN_CONFIG } from './columnConfig';
import { getColumnLayout, normalizeColumnOrder, reorderColumns } from './columnOrder';

describe('column order', () => {
  it('keeps known saved IDs once and appends newly available columns', () => {
    const order = normalizeColumnOrder(['waveform', 'title', 'waveform', 'removed', null, 3]);
    expect(order.slice(0, 2)).toEqual(['waveform', 'title']);
    expect(order).toHaveLength(COLUMN_CONFIG.length);
    expect(new Set(order)).toEqual(new Set(COLUMN_CONFIG.map(column => column.id)));
    expect(normalizeColumnOrder({ title: 1 })).toEqual(COLUMN_CONFIG.map(column => column.id));
  });

  it('moves in either direction using the target edge, not stale source indices', () => {
    const order = ['title', 'artist', 'waveform', 'tags'];
    expect(reorderColumns(order, 'waveform', 'title', false)).toEqual(['waveform', 'title', 'artist', 'tags']);
    expect(reorderColumns(order, 'title', 'waveform', true)).toEqual(['artist', 'waveform', 'title', 'tags']);
    expect(reorderColumns(order, 'title', 'artist', false)).toBe(order);
    expect(reorderColumns(order, 'artist', 'artist', true)).toBe(order);
    expect(reorderColumns(order, 'invalid', 'artist', true)).toBe(order);
  });

  it('preserves hidden playlist # placement and resolves one frozen prefix', () => {
    const order = normalizeColumnOrder(['waveform', 'title', 'order', 'artist']);
    const library = getColumnLayout(order, false);
    const playlist = getColumnLayout(order, true);
    expect(library.slice(0, 3).map(column => column.id)).toEqual(['waveform', 'title', 'artist']);
    expect(playlist.slice(0, 4).map(column => column.id)).toEqual(['waveform', 'title', 'order', 'artist']);
    expect(library.filter(column => column.sticky)).toHaveLength(5);
    expect(playlist.filter(column => column.sticky)).toHaveLength(6);
    expect(library[4].showShadow).toBe(true);
    expect(library.slice(5).every(column => !column.sticky && !column.showShadow)).toBe(true);
  });
});
