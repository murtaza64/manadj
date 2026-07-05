import { describe, expect, it } from 'vitest';
import { fillStretchWindow } from './windowFill';

function ramp(n: number): Float32Array {
  const data = new Float32Array(n);
  for (let i = 0; i < n; i++) data[i] = i + 1;
  return data;
}

describe('fillStretchWindow', () => {
  it('copies an interior window exactly', () => {
    const dest = new Float32Array(4);
    fillStretchWindow(dest, ramp(16), 5);
    expect(Array.from(dest)).toEqual([6, 7, 8, 9]);
  });

  it('zero-pads before frame 0 (fresh-start read-ahead)', () => {
    const dest = new Float32Array(6);
    fillStretchWindow(dest, ramp(16), -3);
    expect(Array.from(dest)).toEqual([0, 0, 0, 1, 2, 3]);
  });

  it('zero-pads past the end of the track (tail)', () => {
    const dest = new Float32Array(6);
    fillStretchWindow(dest, ramp(8), 5);
    expect(Array.from(dest)).toEqual([6, 7, 8, 0, 0, 0]);
  });

  it('handles a window entirely outside the track', () => {
    const dest = new Float32Array(4).fill(9);
    fillStretchWindow(dest, ramp(8), 100);
    expect(Array.from(dest)).toEqual([0, 0, 0, 0]);
    fillStretchWindow(dest, ramp(8), -100);
    expect(Array.from(dest)).toEqual([0, 0, 0, 0]);
  });

  it('clears stale contents when there is no data', () => {
    const dest = new Float32Array(4).fill(9);
    fillStretchWindow(dest, undefined, 0);
    expect(Array.from(dest)).toEqual([0, 0, 0, 0]);
  });

  it('window covering the whole short track pads both sides', () => {
    const dest = new Float32Array(8);
    fillStretchWindow(dest, ramp(3), -2);
    expect(Array.from(dest)).toEqual([0, 0, 1, 2, 3, 0, 0, 0]);
  });

  describe('loop fold (looping 03 — the stretch wrap happens at the read layer)', () => {
    const loop = { startFrames: 4, endFrames: 8 }; // content 5,6,7,8

    it('reads past the loop end come from the loop start', () => {
      const dest = new Float32Array(6);
      fillStretchWindow(dest, ramp(16), 6, loop);
      expect(Array.from(dest)).toEqual([7, 8, 5, 6, 7, 8]);
    });

    it('folds across multiple wraps within one window', () => {
      const dest = new Float32Array(10);
      fillStretchWindow(dest, ramp(16), 6, loop);
      expect(Array.from(dest)).toEqual([7, 8, 5, 6, 7, 8, 5, 6, 7, 8]);
    });

    it('reads before the loop end are untouched (playing into the region)', () => {
      const dest = new Float32Array(4);
      fillStretchWindow(dest, ramp(16), 2, loop);
      expect(Array.from(dest)).toEqual([3, 4, 5, 6]);
    });

    it('degenerate regions read linearly', () => {
      const dest = new Float32Array(4);
      fillStretchWindow(dest, ramp(16), 6, { startFrames: 8, endFrames: 8 });
      expect(Array.from(dest)).toEqual([7, 8, 9, 10]);
    });
  });
});
