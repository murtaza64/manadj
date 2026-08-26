/**
 * Routine draft model (gh#170 pass 2): jump-edit trace transforms (the
 * loop doctrine's repeat expansion, removal-restores-continuity), lane
 * overrides through the replay build, tolerant parsing.
 */
import { describe, expect, it } from 'vitest';
import {
  buildPlannedRoutine,
  slotLanesAt,
  traceStateAt,
  type RoutineEventInput,
  type RoutinePlanInput,
  type RoutineTracePoint,
} from '../sets/routinePlan';
import {
  applyJumpEditsToTrace,
  expandAuthoredJump,
  parseEdits,
  emptyEdits,
} from './routineDraft';

const pt = (
  beat: number,
  pos: number,
  over: Partial<RoutineTracePoint> = {}
): RoutineTracePoint => ({
  beat,
  pos,
  jump: false,
  moving: true,
  ratePerBeat: 0.5,
  ...over,
});

/** A steady beatmatched trace 0..64 beats, pos 10..42 (rate 0.5). */
const steady = (): RoutineTracePoint[] => [pt(0, 10), pt(64, 42)];

describe('expandAuthoredJump', () => {
  it('a single jump is itself', () => {
    expect(
      expandAuthoredJump({ id: 'a', slot: 0, beat: 16, deltaSec: -2 }, () => 0.5, 64)
    ).toEqual([{ beat: 16, deltaSec: -2 }]);
  });

  it('a backward jump with repeat recurs at its displacement period (the loop doctrine)', () => {
    // −2s at 0.5 track-sec/beat = a 4-beat loop.
    const out = expandAuthoredJump(
      { id: 'a', slot: 0, beat: 16, deltaSec: -2, repeat: 3 },
      () => 0.5,
      64
    );
    expect(out.map((e) => e.beat)).toEqual([16, 20, 24]);
    expect(out.every((e) => e.deltaSec === -2)).toBe(true);
  });

  it('repeat is backward-only (a forward jump has no natural period)', () => {
    const out = expandAuthoredJump(
      { id: 'a', slot: 0, beat: 16, deltaSec: 2, repeat: 3 },
      () => 0.5,
      64
    );
    expect(out).toHaveLength(1);
  });
});

describe('applyJumpEditsToTrace', () => {
  it('an authored jump inserts a landing and displaces the tail', () => {
    const out = applyJumpEditsToTrace(
      steady(),
      [{ id: 'a', slot: 0, beat: 32, deltaSec: -4 }],
      [],
      64
    );
    // Ride to the instant: pos(32) = 10 + 32·0.5 = 26; land at 22.
    const landing = out.find((p) => p.jump);
    expect(landing?.beat).toBe(32);
    expect(landing?.pos).toBeCloseTo(22);
    // The tail shifts by −4: the final point reads 38, and the evaluator
    // rides continuously between.
    expect(out[out.length - 1].pos).toBeCloseTo(38);
    expect(traceStateAt(out, 48).pos).toBeCloseTo(10 + 48 * 0.5 - 4);
    // Before the jump: untouched.
    expect(traceStateAt(out, 16).pos).toBeCloseTo(18);
  });

  it('a repeated backward jump loops the same passage k times', () => {
    // −2s at rate 0.5 = 4-beat period, repeat 3 → landings at 16/20/24.
    const out = applyJumpEditsToTrace(
      steady(),
      [{ id: 'a', slot: 0, beat: 16, deltaSec: -2, repeat: 3 }],
      [],
      64
    );
    expect(out.filter((p) => p.jump).map((p) => p.beat)).toEqual([16, 20, 24]);
    // Each wrap replays the same 2s of audio: pos just after each landing
    // is the same.
    for (const b of [16, 20, 24]) {
      const justAfter = out.find((p) => p.jump && p.beat === b)!;
      expect(justAfter.pos).toBeCloseTo(16, 5);
    }
    // After the loop block the tail is 6s behind the unedited trace.
    expect(traceStateAt(out, 48).pos).toBeCloseTo(10 + 48 * 0.5 - 6);
  });

  it('removing a recorded jump restores continuity', () => {
    // A recorded −8s seek at beat 32: ride-out 26, landing 18.
    const trace = [pt(0, 10), pt(32, 18, { jump: true }), pt(64, 34)];
    const out = applyJumpEditsToTrace(trace, [], [{ slot: 0, beat: 32 }], 64);
    expect(out.some((p) => p.jump)).toBe(false);
    // The landing rejoins the ridden-out position; the tail follows.
    expect(out.find((p) => p.beat === 32)?.pos).toBeCloseTo(26);
    expect(out[out.length - 1].pos).toBeCloseTo(42);
  });

  it('no edits = the same trace', () => {
    const t = steady();
    expect(applyJumpEditsToTrace(t, [], [], 64)).toBe(t);
  });
});

describe('build integration (the one seam: editor audition ≡ set replay)', () => {
  const tick = (beat: number, playheads: Record<string, number>): RoutineEventInput => ({
    kind: 'tick',
    beat,
    playheads,
  });
  const input = (): RoutinePlanInput => {
    const events: RoutineEventInput[] = [];
    for (let b = 0; b <= 64; b += 4) {
      events.push(
        tick(b, {
          '0': 60 + b * 0.5,
          ...(b >= 16 ? { '1': (b - 16) * 0.5 } : {}),
          ...(b >= 32 ? { '2': 10 + (b - 32) * 0.5 } : {}),
        })
      );
    }
    events.push({ kind: 'control', beat: 16, slot: 1, control: 'fader', value: 1 });
    return {
      cast: [1, 2, 3],
      entryOffsetsBeats: [0, 16, 32],
      entryPositions: [60, 0, 10],
      durationBeats: 64,
      events,
    };
  };
  const ctx = {
    startEntryIndex: 0,
    mixStartSec: 0,
    targetBpm: 120,
    adoptedDeck: 'A' as const,
    busy: [],
    trackBpms: [120, 120, 120],
  };

  it('authored jumps ride into jumpMixSecs (the Conductor hard-sync feed)', () => {
    const edits = {
      ...emptyEdits(),
      jumps: [{ id: 'a', slot: 1, beat: 40, deltaSec: -2 }],
    };
    const { routine } = buildPlannedRoutine({ ...input(), edits }, ctx);
    // Beat 40 at 120 BPM = mix 20 s, on slot 1's deck only.
    expect(routine.slots[1].jumpMixSecs.map((t) => Math.round(t * 10) / 10)).toContain(20);
    expect(routine.slots[0].jumpMixSecs).toHaveLength(0);
  });

  it('authored lane envelopes replace the recorded steps and interpolate', () => {
    const edits = {
      ...emptyEdits(),
      lanes: {
        '1:fader': [
          { beat: 16, value: 0 },
          { beat: 24, value: 1 },
        ],
      },
    };
    const { routine } = buildPlannedRoutine({ ...input(), edits }, ctx);
    const slot1 = routine.slots[1];
    expect(slot1.lanes.authored?.fader).toBe(true);
    // Linear ramp, not a step: halfway through = 0.5.
    expect(slotLanesAt(slot1, 20).fader).toBeCloseTo(0.5);
    // Flat holds outside the envelope (the pair editor's edge extension).
    expect(slotLanesAt(slot1, 40).fader).toBe(1);
    // Other lanes stay recorded.
    expect(slot1.lanes.authored?.eqLow).toBeUndefined();
  });

  it('alignment nudges slide the trace rigidly (gh#190 item 6)', () => {
    const base = buildPlannedRoutine(input(), ctx).routine;
    const edits = { ...emptyEdits(), nudges: { '1': 0.25 } };
    const { routine } = buildPlannedRoutine({ ...input(), edits }, ctx);
    const b = base.slots[1];
    const n = routine.slots[1];
    // Every trace position shifts by exactly the nudge; beats untouched.
    expect(n.trace.map((p) => p.beat)).toEqual(b.trace.map((p) => p.beat));
    n.trace.forEach((p, i) => expect(p.pos).toBeCloseTo(b.trace[i].pos + 0.25));
    expect(n.entryTrackSec).toBeCloseTo(b.entryTrackSec + 0.25);
    // Other slots untouched.
    routine.slots[0].trace.forEach((p, i) =>
      expect(p.pos).toBeCloseTo(base.slots[0].trace[i].pos)
    );
  });
});

describe('parseEdits', () => {
  it('round-trips a well-formed layer and drops garbage', () => {
    const parsed = parseEdits({
      lanes: { '0:fader': [{ beat: 4, value: 0.5 }, { beat: 2, value: 1 }, 'junk'] },
      jumps: [
        { id: 'a', slot: 1, beat: 8, deltaSec: -2, repeat: 4 },
        { slot: 'x', beat: 8 },
      ],
      removedRecordedJumps: [{ slot: 0, beat: 12.5 }, null],
    });
    expect(parsed.lanes['0:fader'].map((p) => p.beat)).toEqual([2, 4]); // sorted, junk dropped
    expect(parsed.jumps).toHaveLength(1);
    expect(parsed.jumps[0].repeat).toBe(4);
    expect(parsed.removedRecordedJumps).toEqual([{ slot: 0, beat: 12.5 }]);
  });

  it('null/garbage = empty', () => {
    expect(parseEdits(null).jumps).toEqual([]);
    expect(parseEdits('nope').lanes).toEqual({});
    expect(parseEdits(null).nudges).toEqual({});
  });

  it('parses nudges, dropping zeros and non-numbers (gh#190 item 6)', () => {
    const parsed = parseEdits({ nudges: { '0': 0.05, '1': 0, '2': 'x', '3': -0.1 } });
    expect(parsed.nudges).toEqual({ '0': 0.05, '3': -0.1 });
  });
});
