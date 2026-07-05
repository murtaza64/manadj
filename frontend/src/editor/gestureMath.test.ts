import { describe, expect, it } from 'vitest';
import { beatsToSeconds } from './gestureMath';

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
