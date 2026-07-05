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
});
