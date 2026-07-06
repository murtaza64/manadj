/**
 * Pure loop math (looping 03, midi-performance-ops 01): the engine-clock
 * fold that keeps the reported playhead correct across wraps, the size
 * label, and dyadic resize arithmetic.
 */
import { describe, expect, it } from 'vitest';
import {
  clampLoopBeats,
  foldLoopPlayhead,
  formatLoopBeats,
  LOOP_MAX_BEATS,
  LOOP_MIN_BEATS,
  resizeLoopBeats,
} from './loop';

describe('foldLoopPlayhead', () => {
  // Region [10, 12), anchored inside.
  it('leaves positions inside the region unchanged', () => {
    expect(foldLoopPlayhead(11.5, 10, 12, 10.5)).toBe(11.5);
  });

  it('leaves positions before the region unchanged (playing into it)', () => {
    expect(foldLoopPlayhead(9.5, 10, 12, 9.2)).toBe(9.5);
  });

  it('folds a position past the end back into the region', () => {
    expect(foldLoopPlayhead(12.3, 10, 12, 10.5)).toBeCloseTo(10.3, 10);
  });

  it('folds across many wraps without drift (modulo)', () => {
    // 100 loop lengths + 0.7 past the end.
    expect(foldLoopPlayhead(12 + 100 * 2 + 0.7, 10, 12, 10.5)).toBeCloseTo(10.7, 10);
  });

  it('does not fold when the clock anchor is beyond the region', () => {
    expect(foldLoopPlayhead(30, 10, 12, 25)).toBe(30);
  });

  it('degrades on an empty region', () => {
    expect(foldLoopPlayhead(15, 10, 10, 10)).toBe(15);
  });
});

describe('formatLoopBeats', () => {
  it('formats whole sizes plainly and sub-beat sizes as fractions', () => {
    expect(formatLoopBeats(4)).toBe('4');
    expect(formatLoopBeats(32)).toBe('32');
    expect(formatLoopBeats(0.5)).toBe('1/2');
    expect(formatLoopBeats(0.125)).toBe('1/8');
  });

  it('formats non-power-of-two dyadic sizes as reduced fractions', () => {
    expect(formatLoopBeats(0.75)).toBe('3/4');
    expect(formatLoopBeats(0.375)).toBe('3/8');
    expect(formatLoopBeats(1.5)).toBe('3/2');
    expect(formatLoopBeats(128)).toBe('128');
  });
});

describe('dyadic domain bounds', () => {
  it('spans 1/8 to 128 beats', () => {
    expect(LOOP_MIN_BEATS).toBe(0.125);
    expect(LOOP_MAX_BEATS).toBe(128);
  });

  it('clamps to the widened range', () => {
    expect(clampLoopBeats(256)).toBe(128);
    expect(clampLoopBeats(128)).toBe(128);
    expect(clampLoopBeats(0.0625)).toBe(0.125);
  });
});

describe('resizeLoopBeats', () => {
  it('halves and doubles as pure ×2 / ÷2', () => {
    expect(resizeLoopBeats(4, 'halve')).toBe(2);
    expect(resizeLoopBeats(4, 'double')).toBe(8);
  });

  it('sets an absolute length', () => {
    expect(resizeLoopBeats(4, { beats: 32 })).toBe(32);
    expect(resizeLoopBeats(4, { beats: 0.75 })).toBe(0.75);
  });

  it('clamps at the domain bounds (halve/double stop, never wrap)', () => {
    expect(resizeLoopBeats(128, 'double')).toBe(128);
    expect(resizeLoopBeats(0.125, 'halve')).toBe(0.125);
    expect(resizeLoopBeats(4, { beats: 512 })).toBe(128);
    expect(resizeLoopBeats(4, { beats: 0.01 })).toBe(0.125);
  });

  it('keeps the 3/4 ladder dyadic: 3/4 halves to 3/8, doubles to 3/2', () => {
    expect(resizeLoopBeats(0.75, 'halve')).toBe(0.375);
    expect(resizeLoopBeats(0.75, 'double')).toBe(1.5);
  });
});
