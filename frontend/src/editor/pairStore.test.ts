/**
 * Transition-library 01 — materialization rules (lazy persistence).
 */
import { describe, expect, it } from 'vitest';
import { defaultMix } from './mixModel';
import {
  freshTransition,
  isPristine,
  nextFreeNumber,
  pruneStore,
  toStoredEntry,
} from './pairStore';
import type { SavedTransition } from './pairStore';

const pristine = (name = 'Transition 1'): SavedTransition => ({
  name,
  transition: defaultMix().transition,
});

describe('isPristine (what counts as a real edit)', () => {
  it('a fresh default-shaped, default-named transition is pristine', () => {
    expect(isPristine(pristine())).toBe(true);
    expect(isPristine(pristine('Transition 12'))).toBe(true);
  });

  it('a lane point materializes', () => {
    const item = pristine();
    item.transition = {
      ...item.transition,
      lanes: { faderA: [{ x: 0, y: 1 }] },
    };
    expect(isPristine(item)).toBe(false);
  });

  it('anchor changes materialize (start, length, entry, tempo match)', () => {
    for (const patch of [
      { startSec: 31 },
      { durationSec: 8 },
      { bInSec: -2 },
      { tempoMatch: false },
    ]) {
      const item = pristine();
      item.transition = { ...item.transition, ...patch };
      expect(isPristine(item)).toBe(false);
    }
  });

  it('hiding a lane materializes', () => {
    const item = pristine();
    item.transition = { ...item.transition, hiddenLanes: ['faderA'] };
    expect(isPristine(item)).toBe(false);
  });

  it('rename and favorite materialize', () => {
    expect(isPristine({ ...pristine(), name: 'bass swap' })).toBe(false);
    expect(isPristine({ ...pristine(), favorite: true })).toBe(false);
  });

  it('an empty drawn-lanes object still counts as pristine', () => {
    const item = pristine();
    item.transition = { ...item.transition, lanes: {}, hiddenLanes: [] };
    expect(isPristine(item)).toBe(true);
  });
});

describe('freshTransition / nextFreeNumber', () => {
  it('reuses freed default-name numbers', () => {
    expect(nextFreeNumber([])).toBe(1);
    expect(nextFreeNumber([pristine('Transition 1'), pristine('Transition 3')])).toBe(2);
    expect(nextFreeNumber([{ ...pristine(), name: 'bass swap' }])).toBe(1);
  });

  it('creates a pristine item', () => {
    expect(isPristine(freshTransition([]))).toBe(true);
    expect(freshTransition([pristine('Transition 1')]).name).toBe('Transition 2');
  });
});

describe('toStoredEntry (persisting filters pristine items)', () => {
  const edited = (name: string): SavedTransition => ({
    name,
    transition: { ...defaultMix().transition, durationSec: 8 },
  });

  it('a purely pristine session stores nothing', () => {
    expect(toStoredEntry([pristine()], 0)).toBeNull();
  });

  it('drops pristine items and remaps active to the same item', () => {
    const a = edited('keeper');
    const stored = toStoredEntry([pristine(), a], 1);
    expect(stored).toEqual({ items: [a], active: 0 });
  });

  it('clamps active when the active item itself is pristine', () => {
    const a = edited('keeper');
    const stored = toStoredEntry([a, pristine()], 1);
    expect(stored).toEqual({ items: [a], active: 0 });
  });
});

describe('pruneStore (legacy honesty on load)', () => {
  it('drops pristine-shaped saves and empty pairs, keeps edited ones', () => {
    const edited: SavedTransition = {
      name: 'Transition 1',
      transition: { ...defaultMix().transition, startSec: 12 },
    };
    const { store, changed } = pruneStore({
      '1:2': { items: [pristine()], active: 0 },
      '3:4': { items: [pristine(), edited], active: 1 },
    });
    expect(changed).toBe(true);
    expect(store['1:2']).toBeUndefined();
    expect(store['3:4']).toEqual({ items: [edited], active: 0 });
  });

  it('reports unchanged when nothing was pruned', () => {
    const edited: SavedTransition = { name: 'x', transition: defaultMix().transition };
    const { changed } = pruneStore({ '1:2': { items: [edited], active: 0 } });
    expect(changed).toBe(false);
  });
});
