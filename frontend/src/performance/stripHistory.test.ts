/** Strip history (performance-mode 09): past = as heard, future = live. */
import { describe, expect, it } from 'vitest';
import { createStripHistory } from './stripHistory';
import type { StripValues } from './stripHistory';

const v = (gain: number, low = 1, mid = 1, high = 1, fader = 1): StripValues => ({ gain, low, mid, high, fader });
const LIVE = v(0.5, 0.5, 0.5, 0.5, 0.5);

describe('createStripHistory', () => {
  it('past returns recorded steps, frontier and beyond return live', () => {
    const h = createStripHistory();
    h.record(0, true, v(1));
    h.record(10, true, v(1, 0, 1, 1)); // bass killed at t=10
    h.record(20, true, v(1, 0, 1, 1));
    expect(h.at(5, LIVE)).toEqual(v(1));
    expect(h.at(15, LIVE)).toEqual(v(1, 0, 1, 1));
    expect(h.at(20, LIVE)).toBe(LIVE); // frontier
    expect(h.at(99, LIVE)).toBe(LIVE); // future
  });

  it('unchanged values do not grow the series (step dedupe)', () => {
    const h = createStripHistory();
    h.record(0, true, v(1));
    for (let t = 1; t <= 100; t++) h.record(t, true, v(1));
    h.record(101, true, v(0.25));
    expect(h.at(50, LIVE)).toEqual(v(1));
    expect(h.at(100.5, LIVE)).toEqual(v(1));
  });

  it('paused moves are not recorded; last-played values stand', () => {
    const h = createStripHistory();
    h.record(0, true, v(1));
    h.record(10, true, v(1));
    h.record(10, false, v(0)); // fader slammed while paused
    expect(h.at(5, LIVE)).toEqual(v(1));
    // Resume with the new strip: recorded from the frontier on.
    h.record(10.1, true, v(0));
    expect(h.at(10.05, LIVE)).toEqual(v(1));
    expect(h.at(10.1, LIVE)).toBe(LIVE); // frontier is live
  });

  it('seeking backward truncates the overwritten stretch', () => {
    const h = createStripHistory();
    h.record(0, true, v(1));
    h.record(10, true, v(1, 0, 1, 1));
    h.record(30, true, v(1, 0, 1, 1));
    h.record(8, true, v(1)); // loop wrap / seek back to 8
    // The re-heard pass rewrote 8..: the kill at t=10 is gone.
    h.record(12, true, v(1));
    expect(h.at(11, LIVE)).toEqual(v(1));
    // Before the seek target the original pass survives.
    expect(h.at(5, LIVE)).toEqual(v(1));
  });

  it('pre-history time returns live; clear resets', () => {
    const h = createStripHistory();
    h.record(50, true, v(0.25));
    h.record(60, true, v(0.25));
    expect(h.at(10, LIVE)).toBe(LIVE); // before coverage
    expect(h.at(55, LIVE)).toEqual(v(0.25));
    h.clear();
    expect(h.at(55, LIVE)).toBe(LIVE);
  });
});
