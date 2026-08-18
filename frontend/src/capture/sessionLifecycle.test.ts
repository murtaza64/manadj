/**
 * Ten-minute silence split clock (sessions 11) — the pure fake-clock seam.
 *
 * Feed it Master-audibility observations on the capture clock; it reports
 * the split instant: ten continuous minutes with no Master-audible Deck.
 * Any audible observation resets the full clock; the split fires exactly
 * once per silence period (the recorder stays dormant afterwards — the
 * next Session opens via lazy activation, not via this clock).
 */
import { describe, expect, it } from 'vitest';
import { SILENCE_SPLIT_S, SilenceSplitClock } from './sessionLifecycle';

describe('SilenceSplitClock (sessions 11)', () => {
  it('exposes the ten-minute threshold', () => {
    expect(SILENCE_SPLIT_S).toBe(600);
  });

  it('does not fire at 9:59 of continuous silence, fires at 10:00', () => {
    const clock = new SilenceSplitClock(0);
    let fired = false;
    for (let t = 1; t <= 599; t += 1) fired = clock.note(false, t) || fired;
    expect(fired).toBe(false);
    expect(clock.note(false, 600)).toBe(true);
  });

  it('counts silence from the last audible instant, not from construction', () => {
    const clock = new SilenceSplitClock(0);
    clock.note(true, 50); // performance
    expect(clock.note(false, 300)).toBe(false); // silent since 300…
    expect(clock.note(false, 649)).toBe(false); // was audible at 50: 599s silent
    expect(clock.note(false, 650)).toBe(false); // silence began at the FIRST
    expect(clock.note(false, 899)).toBe(false); // silent observation (300)
    expect(clock.note(false, 900)).toBe(true); // 300 + 600
  });

  it('any audible observation before the threshold resets the full clock', () => {
    const clock = new SilenceSplitClock(0);
    expect(clock.note(false, 599)).toBe(false);
    clock.note(true, 599.5); // a deck came back just in time
    expect(clock.note(false, 600)).toBe(false); // new silence period from 600
    expect(clock.note(false, 1199)).toBe(false); // 599s of new silence
    expect(clock.note(false, 1200)).toBe(true); // full ten minutes again
  });

  it('fires exactly once per silence period (dormant afterwards)', () => {
    const clock = new SilenceSplitClock(0);
    expect(clock.note(false, 600)).toBe(true);
    expect(clock.note(false, 1200)).toBe(false);
    expect(clock.note(false, 99999)).toBe(false);
  });

  it('re-arms after performance resumes', () => {
    const clock = new SilenceSplitClock(0);
    expect(clock.note(false, 600)).toBe(true); // first split
    clock.note(true, 700); // live again
    expect(clock.note(false, 701)).toBe(false); // silence resumes at 701
    expect(clock.note(false, 1300)).toBe(false);
    expect(clock.note(false, 1301)).toBe(true); // second split, fresh clock
  });

  it('boot straight into silence fires at threshold from the start time', () => {
    const clock = new SilenceSplitClock(100);
    expect(clock.note(false, 699)).toBe(false);
    expect(clock.note(false, 700)).toBe(true);
  });
});
