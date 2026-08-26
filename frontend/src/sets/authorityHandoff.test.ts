/**
 * Authority-handoff ramp (sets #179), pure under vitest: when lane
 * authority passes hands (window open/close, routine span edges), a
 * hand-edited artifact may leave the incoming authority's first value
 * off the outgoing's last one — planStateAt decays that residual step
 * over AUTHORITY_HANDOFF_RAMP_SEC instead of stepping. Continuous
 * handoffs read byte-identical to the raw verdict; everything outside
 * the ramp horizon does too; hard cuts stay deliberate cuts.
 */
import { describe, expect, it } from 'vitest';
import type { Transition } from '../editor/mixModel';
import {
  AUTHORITY_HANDOFF_RAMP_SEC,
  planSet,
  planStateAt,
  planStateAtRaw,
  type PlanInput,
} from './planner';
import type { RoutineEventInput, RoutinePlanInput } from './routinePlan';

const RAMP = AUTHORITY_HANDOFF_RAMP_SEC;

const facts = (durationSec: number, bpm: number | null = 120) => ({
  durationSec,
  bpm,
  hotCue1Sec: null,
});

const tr = (over: Partial<Transition> = {}): Transition => ({
  startSec: 60,
  durationSec: 20,
  bInSec: 8,
  tempoMatch: false,
  lanes: {},
  ...over,
});

/** Two tracks joined by one pinned window at mix 60..80 (Riding, no
 * tempo match → rateOutgoing 1, no Tempo return). */
function windowInput(transition: Transition): PlanInput {
  return {
    entries: [
      { trackId: 1, pin: { kind: 'transition', uuid: 'u1' } },
      { trackId: 2, pin: null },
    ],
    tracks: { 1: facts(100), 2: facts(200) },
    transitionsByUuid: { u1: transition },
    takesByUuid: {},
  };
}

describe('window-boundary handoffs', () => {
  // Hand-edited discontinuities on both boundaries: the outgoing fader
  // opens at 0.7 (solo authority left it at 1) and the incoming fader
  // closes at 0.5 (solo authority resumes at 1).
  const discontinuous = () =>
    planSet(
      windowInput(
        tr({
          lanes: {
            faderA: [
              { x: 0, y: 0.7 },
              { x: 1, y: 1 },
            ],
            faderB: [
              { x: 0, y: 0 },
              { x: 1, y: 0.5 },
            ],
          },
        })
      )
    );

  it('smooths the step at window CLOSE: incoming deck lerps from the authored last value to solo', () => {
    const plan = discontinuous();
    // At the boundary the ramp starts on the outgoing authority's value.
    expect(planStateAt(plan, 80).lanes.B.fader).toBeCloseTo(0.5, 3);
    // Mid-ramp: halfway between the residual and the solo verdict.
    expect(planStateAt(plan, 80 + RAMP / 2).lanes.B.fader).toBeCloseTo(0.75, 6);
    // Ramp end: exactly the raw verdict.
    expect(planStateAt(plan, 80 + RAMP).lanes.B.fader).toBe(1);
  });

  it('smooths the step at window OPEN: outgoing deck lerps from solo to the authored first value', () => {
    const plan = discontinuous();
    expect(planStateAt(plan, 60).lanes.A.fader).toBeCloseTo(1, 3);
    // Mid-ramp: the residual (1 − 0.7) half-decayed on top of the
    // authored curve's own (tiny) motion.
    const authoredMid = planStateAtRaw(plan, 60 + RAMP / 2).lanes.A.fader;
    expect(planStateAt(plan, 60 + RAMP / 2).lanes.A.fader).toBeCloseTo(authoredMid + 0.15, 6);
    expect(planStateAt(plan, 60 + RAMP).lanes.A.fader).toBeCloseTo(
      planStateAtRaw(plan, 60 + RAMP).lanes.A.fader,
      12
    );
  });

  it('is byte-identical to the raw verdict outside the ramp horizon', () => {
    const plan = discontinuous();
    const samples = [
      0,
      30,
      59.9, // just before the window opens
      60 + RAMP + 1e-6, // window interior, past the open ramp
      70,
      79.9, // window interior, before the close boundary
      80 + RAMP + 1e-6, // past the close ramp
      90,
      150,
    ];
    for (const t of samples) {
      expect(planStateAt(plan, t)).toEqual(planStateAtRaw(plan, t));
    }
  });

  it('leaves a continuous handoff unchanged everywhere, ramp horizon included', () => {
    // Continuous hands: outgoing fades 1→0, incoming rises 0→1 — both
    // boundaries meet the neighboring authority exactly.
    const plan = planSet(
      windowInput(
        tr({
          lanes: {
            faderA: [
              { x: 0, y: 1 },
              { x: 1, y: 0 },
            ],
            faderB: [
              { x: 0, y: 0 },
              { x: 1, y: 1 },
            ],
          },
        })
      )
    );
    for (let t = 59.5; t <= 81; t += 0.025) {
      expect(planStateAt(plan, t)).toEqual(planStateAtRaw(plan, t));
    }
  });

  it('never smooths a hard cut (a deliberate cut, not a handoff)', () => {
    const plan = planSet({
      entries: [
        { trackId: 1, pin: null },
        { trackId: 2, pin: null },
      ],
      tracks: { 1: facts(90), 2: facts(100) },
      transitionsByUuid: {},
      takesByUuid: {},
    });
    // The cut instant is mix 90: incoming solos at full immediately.
    for (const t of [90, 90 + RAMP / 2, 90 + RAMP]) {
      expect(planStateAt(plan, t)).toEqual(planStateAtRaw(plan, t));
      expect(planStateAt(plan, t).lanes.B.fader).toBe(1);
    }
  });
});

// ── Routine span edges ───────────────────────────────────────────────────
// The plannerRoutine.test.ts fixture shape: a 3-slot recording on 120 BPM
// tracks, 64 beats (32s at the ridden 120), entries at beats 0/16/32,
// slot-0 entry position 60s → span mix 60..92.

const tick = (beat: number, playheads: Record<string, number>): RoutineEventInput => ({
  kind: 'tick',
  beat,
  playheads,
});
const control = (
  beat: number,
  slot: number | null,
  ctl: string,
  value: number
): RoutineEventInput => ({ kind: 'control', beat, slot, control: ctl, value });

function recording(controls: RoutineEventInput[]): RoutinePlanInput {
  const events: RoutineEventInput[] = [];
  const entries = [0, 16, 32];
  const positions = [60, 0, 10];
  for (let b = 0; b <= 64; b += 4) {
    const playheads: Record<string, number> = {};
    for (const slot of [0, 1, 2]) {
      if (b >= entries[slot]) playheads[String(slot)] = positions[slot] + (b - entries[slot]) * 0.5;
    }
    events.push(tick(b, playheads));
  }
  events.push(...controls);
  events.sort((a, b) => (a.beat as number) - (b.beat as number));
  return {
    cast: [1, 2, 3],
    entryOffsetsBeats: entries,
    entryPositions: positions,
    durationBeats: 64,
    events,
  };
}

function routineInput(controls: RoutineEventInput[]): PlanInput {
  return {
    entries: [
      { trackId: 1, pin: null },
      { trackId: 2, pin: null },
      { trackId: 3, pin: null },
      { trackId: 9, pin: null },
    ],
    tracks: { 1: facts(240), 2: facts(240), 3: facts(240), 9: facts(240) },
    transitionsByUuid: {},
    takesByUuid: {},
    routines: [{ startEntryIndex: 0, routine: recording(controls) }],
  };
}

describe('routine-boundary handoffs', () => {
  it('smooths the entry edge: recorded slot-0 lanes off the solo value lerp in', () => {
    // The recording opens with slot 0's fader at 0.5 — off the solo 1 the
    // adopted deck carried into the span.
    const plan = planSet(routineInput([control(0, 0, 'fader', 0.5)]));
    const r = plan.routines[0];
    expect(r.mixStartSec).toBeCloseTo(60, 6);
    expect(planStateAtRaw(plan, r.mixStartSec).lanes.A.fader).toBe(0.5);
    expect(planStateAt(plan, r.mixStartSec).lanes.A.fader).toBeCloseTo(1, 3);
    expect(planStateAt(plan, r.mixStartSec + RAMP / 2).lanes.A.fader).toBeCloseTo(0.75, 6);
    // Just past the horizon (the boundary instant itself is FP-imprecise).
    const past = r.mixStartSec + RAMP + 1e-6;
    expect(planStateAt(plan, past)).toEqual(planStateAtRaw(plan, past));
  });

  it('smooths the exit edge: the exit deck lerps from its recorded last value to solo', () => {
    // The exit slot's recorded fader ends at 0.6; past the span the exit
    // deck solos at 1.
    const plan = planSet(routineInput([control(32, 2, 'fader', 0.6)]));
    const r = plan.routines[0];
    expect(r.mixEndSec).toBeCloseTo(92, 6);
    expect(planStateAtRaw(plan, r.mixEndSec).lanes.C.fader).toBe(1);
    expect(planStateAt(plan, r.mixEndSec).lanes.C.fader).toBeCloseTo(0.6, 3);
    expect(planStateAt(plan, r.mixEndSec + RAMP / 2).lanes.C.fader).toBeCloseTo(0.8, 6);
    const past = r.mixEndSec + RAMP + 1e-6;
    expect(planStateAt(plan, past)).toEqual(planStateAtRaw(plan, past));
  });

  it('a continuous exit (recorded fader ends where solo resumes) is unchanged through the edge', () => {
    // Continuous hands: the retiring slots fade to 0 (where their parked
    // decks resume), the exit slot ends at 1 (where its solo resumes).
    const plan = planSet(
      routineInput([
        control(16, 1, 'fader', 1),
        control(48, 0, 'fader', 0),
        control(56, 1, 'fader', 0),
        control(32, 2, 'fader', 1),
      ])
    );
    const r = plan.routines[0];
    for (let t = r.mixEndSec - 0.05; t <= r.mixEndSec + RAMP + 0.05; t += 0.01) {
      expect(planStateAt(plan, t)).toEqual(planStateAtRaw(plan, t));
    }
  });
});
