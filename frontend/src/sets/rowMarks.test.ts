/** Loaded/playing row marks (sets 35): live occupancy → identity wash,
 * playing → deck-neutral state. */
import { describe, expect, it } from 'vitest';
import { DECK_COLORS } from '../theme/deckColors';
import { isRowPlaying, loadedDecks, loadedWash, type DeckOccupancyMap } from './rowMarks';

const occ = (
  a: Partial<DeckOccupancyMap['A']> = {},
  b: Partial<DeckOccupancyMap['B']> = {},
  c: Partial<DeckOccupancyMap['C']> = {},
  d: Partial<DeckOccupancyMap['D']> = {}
): DeckOccupancyMap => ({
  A: { trackId: null, playing: false, ...a },
  B: { trackId: null, playing: false, ...b },
  C: { trackId: null, playing: false, ...c },
  D: { trackId: null, playing: false, ...d },
});

describe('loadedDecks', () => {
  it('marks the deck actually holding the track (live occupancy, not plan parity)', () => {
    expect(loadedDecks(7, occ({ trackId: 7 }))).toEqual(['A']);
    expect(loadedDecks(7, occ({}, { trackId: 7 }))).toEqual(['B']);
    expect(loadedDecks(7, occ({ trackId: 3 }, { trackId: 9 }))).toEqual([]);
  });

  it('both decks at once when both hold the track', () => {
    expect(loadedDecks(7, occ({ trackId: 7 }, { trackId: 7 }))).toEqual(['A', 'B']);
  });

  it('orders all holding Decks A→B→C→D', () => {
    expect(
      loadedDecks(7, occ({ trackId: 7 }, {}, { trackId: 7 }, { trackId: 7 }))
    ).toEqual(['A', 'C', 'D']);
  });

  it('empty decks mark nothing', () => {
    expect(loadedDecks(7, occ())).toEqual([]);
  });
});

describe('isRowPlaying', () => {
  it('true only when a deck holding THIS track plays', () => {
    expect(isRowPlaying(7, occ({ trackId: 7, playing: true }))).toBe(true);
    expect(isRowPlaying(7, occ({ trackId: 7, playing: false }))).toBe(false);
    // another track playing elsewhere says nothing about this row
    expect(isRowPlaying(7, occ({ trackId: 3, playing: true }, { trackId: 7 }))).toBe(false);
  });

  it('mid-window: both rows play at once (each against its own deck)', () => {
    const both = occ({ trackId: 7, playing: true }, { trackId: 9, playing: true });
    expect(isRowPlaying(7, both)).toBe(true);
    expect(isRowPlaying(9, both)).toBe(true);
  });
});

describe('loadedWash', () => {
  it('identity wash carries the holding deck color', () => {
    expect(loadedWash(['A'])).toContain(DECK_COLORS.A);
    expect(loadedWash(['B'])).toContain(DECK_COLORS.B);
    expect(loadedWash(['C'])).toContain(DECK_COLORS.C);
    expect(loadedWash(['D'])).toContain(DECK_COLORS.D);
  });

  it('multi-Deck gradients keep stable A→B→C→D color order', () => {
    const wash = loadedWash(['A', 'B', 'C', 'D'])!;
    expect([DECK_COLORS.A, DECK_COLORS.B, DECK_COLORS.C, DECK_COLORS.D].map((color) =>
      wash.indexOf(color)
    )).toEqual([...wash.matchAll(/#[0-9a-f]{6}/gi)].map((match) => match.index));
  });

  it('two-deck load reads as an A→B gradient', () => {
    const wash = loadedWash(['A', 'B'])!;
    expect(wash).toContain('linear-gradient');
    expect(wash).toContain(DECK_COLORS.A);
    expect(wash).toContain(DECK_COLORS.B);
  });

  it('unloaded rows keep their ordinary background', () => {
    expect(loadedWash([])).toBeUndefined();
  });
});
