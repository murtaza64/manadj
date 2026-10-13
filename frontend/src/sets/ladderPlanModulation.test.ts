/**
 * Ladder plan-driven waveform modulation (sets #171) — planStateAt lanes
 * through the real mixer curves into the shared ColumnModulation
 * contract, session-timeline parity: nominal strip renders unmodified
 * (scale 1, eq 1), planned fader ramps shrink the column, planned EQ
 * kills zero their band group.
 */
import { describe, expect, it } from 'vitest';
import type { Transition } from '../editor/mixModel';
import { planSet, type PlanInput } from './planner';
import { planColumnModulator } from './ladderPlanModulation';

function input(over: Partial<PlanInput> = {}): PlanInput {
  return {
    entries: [],
    tracks: {},
    transitionsByUuid: {},
    takesByUuid: {},
    ...over,
  };
}

const facts = (durationSec: number, hotCue1Sec: number | null = null, bpm: number | null = 120) => ({
  durationSec,
  bpm,
  hotCue1Sec,
});

const tr = (over: Partial<Transition> = {}): Transition => ({
  startSec: 60,
  durationSec: 20,
  bInSec: 8,
  tempoMatch: false,
  lanes: {},
  ...over,
});

/** The planner suite's two-track fixture: transition window at mix
 * 60..80, outgoing fader drawn 1→0, incoming eqLow parked at 0 (a kill —
 * the planner-suite variant parks it at 0.2; here we want the kill). */
const lanes: Transition['lanes'] = {
  faderA: [
    { x: 0, y: 1 },
    { x: 1, y: 0 },
  ],
  eqLowB: [{ x: 0, y: 0 }],
};
const twoTrackPlan = () =>
  planSet(
    input({
      entries: [
        { trackId: 1, pin: { kind: 'transition', uuid: 't1' } },
        { trackId: 2, pin: null },
      ],
      tracks: { 1: facts(90, 10), 2: facts(100) },
      transitionsByUuid: { t1: tr({ lanes }) },
    })
  );

describe('planColumnModulator', () => {
  it('solo stretch is the nominal strip: scale 1, eq all 1', () => {
    const plan = twoTrackPlan();
    // Deck A's clip: mix 0..80 (entry 0, exit at window end).
    const [a] = plan.entries;
    const mod = planColumnModulator(plan, 'A', [a.entryMixSec, a.exitMixSec], 800);
    const m = mod(200); // mix ~20 — mid solo stretch
    expect(m.scale).toBeCloseTo(1);
    expect(m.eq[0]).toBeCloseTo(1);
    expect(m.eq[1]).toBeCloseTo(1);
    expect(m.eq[2]).toBeCloseTo(1);
  });

  it('planned fader ramp shrinks the column through the audio taper', () => {
    const plan = twoTrackPlan();
    const [a] = plan.entries;
    const mod = planColumnModulator(plan, 'A', [a.entryMixSec, a.exitMixSec], 800);
    // Window midpoint (mix 70): outgoing fader reads 0.5 → gain taper
    // v² → scale 0.25 relative to nominal.
    const m = mod(700);
    expect(m.scale).toBeCloseTo(0.25, 2);
  });

  it('planned EQ kill zeroes the band group; other groups stay flat', () => {
    const plan = twoTrackPlan();
    const [, b] = plan.entries;
    const mod = planColumnModulator(plan, 'B', [b.entryMixSec, b.exitMixSec], 800);
    // Deck B's clip opens AT the window boundary (mix 60). Sample a column
    // past that edge (column 10 ≈ mix 61.15) so the assertion stays valid
    // when the authority-handoff ramp (sets #179) lands and legitimately
    // decays the kill step over ~150ms at the boundary itself.
    const m = mod(10);
    expect(m.eq[0]).toBe(0);
    expect(m.eq[1]).toBeCloseTo(1);
    expect(m.eq[2]).toBeCloseTo(1);
  });

  it('columns where the deck is not playing render silent (scale 0)', () => {
    const plan = twoTrackPlan();
    // Ask deck B about deck A's solo stretch: B is not playing at mix 20.
    const mod = planColumnModulator(plan, 'B', [0, 40], 400);
    expect(mod(200).scale).toBe(0);
  });
});
