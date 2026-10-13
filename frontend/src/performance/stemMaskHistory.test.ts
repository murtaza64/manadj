import { describe, expect, it } from 'vitest';
import { ALL_ON, stemMaskHistoryFor } from './stemMaskHistory';
import type { StemMask } from './stemMaskHistory';

const KILL_DRUMS: StemMask = [1, 0, 1, 1];

describe('stemMaskHistory', () => {
  it('past shows recorded masks, frontier and beyond show live', () => {
    const h = stemMaskHistoryFor('A');
    h.clear();
    h.record(0, true, ALL_ON);
    h.record(10, true, KILL_DRUMS);
    h.record(20, true, KILL_DRUMS);
    expect(h.at(5, KILL_DRUMS)).toBe(ALL_ON);
    expect(h.at(15, ALL_ON)).toBe(KILL_DRUMS);
    expect(h.at(25, ALL_ON)).toBe(ALL_ON); // ahead of frontier: live
  });

  it('seeking backward rewrites the overwritten stretch', () => {
    const h = stemMaskHistoryFor('B');
    h.clear();
    h.record(0, true, ALL_ON);
    h.record(10, true, KILL_DRUMS);
    h.record(20, true, KILL_DRUMS);
    h.record(5, true, ALL_ON); // seek back — history past 5 dropped
    h.record(12, true, ALL_ON);
    expect(h.at(11, ALL_ON)).toBe(ALL_ON); // the re-heard pass, not the kill
  });

  it('paused moves are not recorded', () => {
    const h = stemMaskHistoryFor('C');
    h.clear();
    h.record(10, false, KILL_DRUMS);
    expect(h.at(5, ALL_ON)).toBe(ALL_ON);
  });
});
