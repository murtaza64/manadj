import { describe, expect, it } from 'vitest';
import { HeardClockHistory, DISPLAY_HISTORY_MAX_SEGMENTS } from './heardClock';
import type { HeardClockSegment } from './heardClock';
const seg = (overrides: Partial<HeardClockSegment> = {}): HeardClockSegment => ({
  at: 10, position: 42, rate: 1, moving: true, loop: null, min: -30, max: 300, ...overrides,
});
describe('heard display history, not transport truth', () => {
  it('holds the launch point until the output delay passes', () => {
    const h = new HeardClockHistory(); h.record(seg());
    expect(h.read(10.1, .2)).toBe(42);
    expect(h.read(10.5, .2)).toBeCloseTo(42.3);
  });
  it('keeps the old seek position until the seek is heard', () => {
    const h = new HeardClockHistory(); h.record(seg()); h.record(seg({ at: 11, position: 100 }));
    expect(h.read(11.1, .2)).toBeCloseTo(42.9);
    expect(h.read(11.2, .2)).toBe(100);
    expect(h.read(11.3, .2)).toBeCloseTo(100.1);
  });
  it('uses the old rate across a pitch change, including a hidden view', () => {
    const h = new HeardClockHistory(); h.record(seg()); h.record(seg({ at: 11, position: 43, rate: 1.2 }));
    expect(h.read(11.1, .2)).toBeCloseTo(42.9);
    expect(h.read(12, .2)).toBeCloseTo(43.96);
    expect(h.read(100, .2)).toBeCloseTo(149.56);
  });
  it('wraps at the delayed instant, not by subtracting from an already folded position', () => {
    const h = new HeardClockHistory(); h.record(seg({ position: 7.9, loop: { start: 4, end: 8 } }));
    expect(h.read(10.2, .2)).toBeCloseTo(7.9);
    expect(h.read(10.4, .2)).toBeCloseTo(4.1);
    expect(h.read(50.4, .2)).toBeCloseTo(4.1);
  });
  it('retains the old loop until a release is heard', () => {
    const h = new HeardClockHistory(); h.record(seg({ position: 7.9, loop: { start: 4, end: 8 } }));
    h.record(seg({ at: 10.3, position: 4.2 }));
    expect(h.read(10.4, .2)).toBeCloseTo(4.1);
    expect(h.read(10.6, .2)).toBeCloseTo(4.3);
  });
  it('plays the stop tail then settles at paused engine position', () => {
    const h = new HeardClockHistory(); h.record(seg()); h.record(seg({ at: 11, position: 43, moving: false }));
    expect(h.read(11.1, .2)).toBeCloseTo(42.9);
    expect(h.read(11.3, .2)).toBe(43);
  });
  it('shows a short CUE stab after release, then returns once', () => {
    const h = new HeardClockHistory(); h.record(seg()); h.record(seg({ at: 10.05, position: 42, moving: false }));
    expect(h.read(10.1, .2)).toBe(42);
    expect(h.read(10.23, .2)).toBeCloseTo(42.03);
    expect(h.read(10.26, .2)).toBe(42);
  });
  it('supports zero/unknown latency and clips malformed latency safely', () => {
    const h = new HeardClockHistory(); h.record(seg());
    for (const lag of [0, NaN, -1]) expect(h.read(11, lag)).toBe(43);
    expect(h.read(13, 20)).toBe(43);
  });
  it('reads live calibration changes without changing stored positions', () => {
    const h = new HeardClockHistory(); h.record(seg());
    expect(h.read(11, .1)).toBeCloseTo(42.9);
    expect(h.read(11, .3)).toBeCloseTo(42.7);
    expect(h.read(11, 0)).toBe(43);
  });
  it('resets for a new context or source, no stale track position', () => {
    const h = new HeardClockHistory(); h.record(seg()); h.reset();
    expect(h.read(11, .2)).toBeNull();
    h.record(seg()); h.record(seg({ at: 0, position: 1 })); expect(h.read(.1, .2)).toBe(1);
  });
  it('copies loop values so later engine mutations do not change history', () => {
    const h = new HeardClockHistory(), s = seg({ loop: { start: 4, end: 8 } });
    h.record(s); s.loop!.start = 6; s.loop!.end = 10;
    expect(h.read(11, .2)).toBeCloseTo(42.8); // anchor already beyond loop: never re-enter
  });
  it('bounds history under high-frequency input and long sessions', () => {
    const h = new HeardClockHistory();
    for (let i = 0; i < 10000; i++) h.record(seg({ at: i / 10000, position: i / 10000 }));
    expect(h.size).toBe(DISPLAY_HISTORY_MAX_SEGMENTS);
    h.record(seg({ at: 20, position: 2 })); expect(h.size).toBe(2);
    expect(h.read(20.3, .2)).toBeCloseTo(2.1);
  });
  it('rejects nonfinite projection state', () => {
    const h = new HeardClockHistory();
    expect(() => h.record(seg({ rate: NaN }))).toThrow();
    expect(() => h.record(seg({ loop: { start: 8, end: 4 } }))).toThrow();
    expect(h.read(NaN, .2)).toBeNull();
  });
});
