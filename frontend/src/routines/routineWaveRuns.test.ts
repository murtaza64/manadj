/**
 * Slot trace → draw runs, including the out-of-span CONTEXT extension
 * (#205 design round): a slot rolling at the window open extrapolates its
 * motion backward, the exit slot's play-out extends forward — the pair
 * editor's whole-tracks view, generalized through the trace.
 */
import { describe, expect, it } from 'vitest';
import { traceDrawRuns } from './routineWaveRuns';
import type { RoutineTracePoint } from '../sets/routinePlan';

const pt = (
  beat: number,
  pos: number,
  over: Partial<RoutineTracePoint> = {}
): RoutineTracePoint => ({ beat, pos, jump: false, moving: true, ratePerBeat: 0.5, ...over });

describe('traceDrawRuns — span behavior (unchanged without context)', () => {
  it('covers [0, duration] for a simple moving trace', () => {
    const runs = traceDrawRuns([pt(0, 30), pt(32, 46)], 32);
    expect(runs).toEqual([{ b0: 0, b1: 32, ph0: 30, ph1: 46, held: false }]);
  });
  it('pre-first-point park is a held run from beat 0', () => {
    const runs = traceDrawRuns([pt(16, 10), pt(32, 18)], 32);
    expect(runs[0]).toEqual({ b0: 0, b1: 16, ph0: 10, ph1: 10, held: true });
  });
});

describe('traceDrawRuns — out-of-span context (#205)', () => {
  it('a slot rolling at the window open extrapolates BACKWARD', () => {
    const runs = traceDrawRuns([pt(0, 30), pt(32, 46)], 32, {
      beforeBeats: 16,
      afterBeats: 0,
    });
    // 16 beats at 0.5 track-sec/beat = 8 track seconds of lead material.
    expect(runs[0]).toEqual({ b0: -16, b1: 0, ph0: 22, ph1: 30 });
  });

  it('a later-entering (parked) slot gets NO invented backward material', () => {
    const runs = traceDrawRuns([pt(16, 10), pt(32, 18)], 32, {
      beforeBeats: 16,
      afterBeats: 0,
    });
    expect(runs[0]).toEqual({ b0: 0, b1: 16, ph0: 10, ph1: 10, held: true });
  });

  it('a slot still moving at the end extends FORWARD by afterBeats', () => {
    const runs = traceDrawRuns([pt(0, 30), pt(32, 46)], 32, {
      beforeBeats: 0,
      afterBeats: 64,
    });
    const lastRun = runs[runs.length - 1];
    expect(lastRun.b1).toBe(96); // 32 + 64
    expect(lastRun.ph1).toBeCloseTo(46 + 0.5 * 64, 10);
  });

  it('a slot parked at its last point does not extend (released deck)', () => {
    const runs = traceDrawRuns(
      [pt(0, 30), pt(16, 38, { moving: false, ratePerBeat: 0 })],
      32,
      { beforeBeats: 0, afterBeats: 64 }
    );
    const lastRun = runs[runs.length - 1];
    expect(lastRun).toEqual({ b0: 16, b1: 32, ph0: 38, ph1: 38, held: true });
  });
});
