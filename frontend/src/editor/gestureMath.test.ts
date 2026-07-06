import { describe, expect, it } from 'vitest';
import { beatsToSeconds, slideBeatsToSeconds } from './gestureMath';
import { slideB } from './mixModel';
import type { Transition } from './mixModel';

describe('beatsToSeconds', () => {
  it('converts N beats at a base BPM to seconds', () => {
    expect(beatsToSeconds(4, 120)).toBe(2);
    expect(beatsToSeconds(1, 60)).toBe(1);
  });

  it('is signed — back jumps are negative beats', () => {
    expect(beatsToSeconds(-8, 120)).toBe(-4);
  });

  it('handles fractional sizes (the shared size halves below 1)', () => {
    expect(beatsToSeconds(0.5, 120)).toBe(0.25);
  });
});

describe('slideBeatsToSeconds (apparent-motion polarity, mix-editor 32)', () => {
  const tr: Transition = {
    startSec: 30,
    durationSec: 20,
    bInSec: 10,
    tempoMatch: false,
    lanes: {},
  };
  /** Mix position of B's content origin — the drawn block's reference
   * point (DawTimeline: originMix = startSec − bInSec/rateB). */
  const blockOrigin = (t: Pick<Transition, 'startSec' | 'bInSec'>, rateB: number) =>
    t.startSec - t.bInSec / rateB;

  it('negates the beat delta (▶ = negative model δ)', () => {
    expect(slideBeatsToSeconds(4, 120)).toBe(-2);
    expect(slideBeatsToSeconds(-4, 120)).toBe(2);
  });

  it('▶ moves the drawn block RIGHT, unlocked (bInSec −= δ)', () => {
    const rateB = 1.25;
    const next = { ...tr, ...slideB(tr, slideBeatsToSeconds(4, 120), false, rateB) };
    expect(next.bInSec).toBe(tr.bInSec - 2);
    expect(blockOrigin(next, rateB)).toBeGreaterThan(blockOrigin(tr, rateB));
  });

  it('▶ moves the drawn block RIGHT, locked (startSec += δ/rateB)', () => {
    const rateB = 1.25;
    const next = { ...tr, ...slideB(tr, slideBeatsToSeconds(4, 120), true, rateB) };
    expect(next.startSec).toBeCloseTo(tr.startSec + 2 / rateB);
    expect(next.bInSec).toBe(tr.bInSec);
    expect(blockOrigin(next, rateB)).toBeGreaterThan(blockOrigin(tr, rateB));
  });

  it('◀ moves the drawn block LEFT in both lock modes', () => {
    const rateB = 1;
    const delta = slideBeatsToSeconds(-4, 120);
    const unlocked = { ...tr, ...slideB(tr, delta, false, rateB) };
    const locked = { ...tr, ...slideB(tr, delta, true, rateB) };
    expect(blockOrigin(unlocked, rateB)).toBeLessThan(blockOrigin(tr, rateB));
    expect(blockOrigin(locked, rateB)).toBeLessThan(blockOrigin(tr, rateB));
  });
});
