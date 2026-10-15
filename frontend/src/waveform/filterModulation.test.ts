import { describe, expect, it } from 'vitest';
import { filterGroupGains } from './filterModulation';
import { DEFAULT_FILTER_SETTINGS } from '../playback/filterSettings';

describe('filterGroupGains', () => {
  const s = DEFAULT_FILTER_SETTINGS;
  it('is unity when open', () => {
    const g = filterGroupGains(s, 0);
    for (const v of g) expect(v).toBeGreaterThan(0.98);
  });
  it('an LPF thins the high group first, then the mid', () => {
    const half = filterGroupGains(s, -0.5);
    const full = filterGroupGains(s, -1);
    expect(half[2]).toBeLessThan(0.05);
    // Resonant hump near the cutoff: the mid group leads, the low trails.
    expect(half[1]).toBe(1);
    expect(half[0]).toBeGreaterThan(0.25);
    expect(full[2]).toBeLessThan(0.05);
    expect(full[1]).toBeLessThan(half[1]);
  });
  it('an HPF eats the low group', () => {
    const full = filterGroupGains(s, 1);
    expect(full[0]).toBeLessThan(0.05);
    expect(full[2]).toBe(1);
  });
});
