/**
 * Pure loop math (looping 03): the engine-clock fold that keeps the
 * reported playhead correct across wraps, and the size label.
 */
import { describe, expect, it } from 'vitest';
import { foldLoopPlayhead, formatLoopBeats } from './loop';

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
});
