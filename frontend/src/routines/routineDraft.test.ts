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
  applyPauseEditsToTrace,
  expandAuthoredJump,
  parseEdits,
  emptyEdits,
} from './routineDraft';
import { recordedPauses } from './routineEditorModel';

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
      expandAuthoredJump({ id: 'a', slotId: '0', beat: 16, deltaSec: -2 }, () => 0.5, 64)
    ).toEqual([{ beat: 16, deltaSec: -2 }]);
  });

  it('a backward jump with repeat recurs at its displacement period (the loop doctrine)', () => {
    // −2s at 0.5 track-sec/beat = a 4-beat loop.
    const out = expandAuthoredJump(
      { id: 'a', slotId: '0', beat: 16, deltaSec: -2, repeat: 3 },
      () => 0.5,
      64
    );
    expect(out.map((e) => e.beat)).toEqual([16, 20, 24]);
    expect(out.every((e) => e.deltaSec === -2)).toBe(true);
  });

  it('repeat is backward-only (a forward jump has no natural period)', () => {
    const out = expandAuthoredJump(
      { id: 'a', slotId: '0', beat: 16, deltaSec: 2, repeat: 3 },
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
      [{ id: 'a', slotId: '0', beat: 32, deltaSec: -4 }],
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
      [{ id: 'a', slotId: '0', beat: 16, deltaSec: -2, repeat: 3 }],
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
    const out = applyJumpEditsToTrace(trace, [], [{ slotId: '0', beat: 32 }], 64);
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

describe('applyPauseEditsToTrace (gh#190 play/pause events)', () => {
  it('an authored pause holds the deck, then resumes from the hold', () => {
    const out = applyPauseEditsToTrace(
      steady(),
      [{ id: 'p', slotId: '0', beat: 16, durBeats: 8 }],
      [],
      64
    );
    // Hold at pos(16) = 18 through beats 16..24.
    expect(traceStateAt(out, 18).pos).toBeCloseTo(18);
    expect(traceStateAt(out, 18).moving).toBe(false);
    expect(traceStateAt(out, 23.9).pos).toBeCloseTo(18);
    // Resume FROM the hold: the tail rides 4 track-seconds behind.
    expect(traceStateAt(out, 32).pos).toBeCloseTo(10 + 32 * 0.5 - 4);
    expect(traceStateAt(out, 32).moving).toBe(true);
    // Before the hold: untouched.
    expect(traceStateAt(out, 8).pos).toBeCloseTo(14);
  });

  it('removing a recorded pause plays through the hold', () => {
    // Recorded hold: motion 0..16 (pos 10..18), held 16..24, resumes
    // 24..64 (pos 18..38).
    const trace = [
      pt(0, 10),
      pt(16, 18, { moving: false, ratePerBeat: 0 }),
      pt(24, 18),
      pt(64, 38),
    ];
    const out = applyPauseEditsToTrace(trace, [], [{ slotId: '0', beat: 16 }], 64);
    // Motion continues at the pre-pause rate through the old hold…
    expect(traceStateAt(out, 20).moving).toBe(true);
    expect(traceStateAt(out, 20).pos).toBeCloseTo(20);
    // …and the tail displaces forward by the held span (8 beats · 0.5).
    expect(traceStateAt(out, 32).pos).toBeCloseTo(22 + 8 * 0.5);
    expect(out[out.length - 1].pos).toBeCloseTo(42);
  });

  it('removal is EXACT continuity — creep during the hold is absorbed (gh#190)', () => {
    // The real-corpus case: a hand-timed 7.3-beat hold whose position
    // CREPT 0.1 s while "paused" (jog/tick noise). Removal must land the
    // tail on the extension of the pre-pause ride — as if never paused —
    // not merely shift it by the hold span (which played 0.1 s late).
    const trace = [
      pt(0, 10),
      pt(16, 18, { moving: false, ratePerBeat: 0 }),
      pt(23.3, 18.1), // resume: crept +0.1 during the hold
      pt(64, 38.45),
    ];
    const out = applyPauseEditsToTrace(trace, [], [{ slotId: '0', beat: 16 }], 64);
    // Extended ride: pos(b) = 10 + 0.5·b for the WHOLE tail.
    expect(traceStateAt(out, 23.3).pos).toBeCloseTo(10 + 23.3 * 0.5);
    expect(traceStateAt(out, 40).pos).toBeCloseTo(10 + 40 * 0.5);
    expect(out[out.length - 1].pos).toBeCloseTo(10 + 64 * 0.5);
    // Continuous through the old hold at the pre-pause rate.
    expect(traceStateAt(out, 20).pos).toBeCloseTo(20);
    expect(traceStateAt(out, 20).moving).toBe(true);
  });

  it('no edits = the same trace', () => {
    const t = steady();
    expect(applyPauseEditsToTrace(t, [], [], 64)).toBe(t);
  });
});

describe('recordedPauses', () => {
  it('finds interior holds; pre-entry parks and trailing stops are not pauses', () => {
    const trace = [
      pt(0, 10, { moving: false, ratePerBeat: 0 }), // pre-entry park
      pt(8, 10), // motion starts
      pt(24, 18, { moving: false, ratePerBeat: 0 }), // interior hold…
      pt(32, 18), // …resumes
      pt(56, 30, { moving: false, ratePerBeat: 0 }), // trailing stop
      pt(64, 30, { moving: false, ratePerBeat: 0 }),
    ];
    expect(recordedPauses(trace)).toEqual([{ beat: 24, endBeat: 32 }]);
  });

  it('a SEEK during a hold splits it: hold + jump + hold (gh#190 design pass)', () => {
    const trace = [
      pt(0, 10),
      pt(16, 18, { moving: false, ratePerBeat: 0 }), // paused…
      pt(20, 4, { jump: true, moving: false, ratePerBeat: 0 }), // …seek while paused…
      pt(28, 4), // …resumes
      pt(64, 22),
    ];
    expect(recordedPauses(trace)).toEqual([
      { beat: 16, endBeat: 20 },
      { beat: 20, endBeat: 28 },
    ]);
  });
});

describe('removing a hold that ends in a seek', () => {
  it('plays through to the seek; the seek and tail stay exactly as recorded', () => {
    const trace = [
      pt(0, 10),
      pt(16, 18, { moving: false, ratePerBeat: 0 }),
      pt(20, 4, { jump: true, moving: false, ratePerBeat: 0 }),
      pt(28, 4),
      pt(64, 22),
    ];
    const out = applyPauseEditsToTrace(trace, [], [{ slotId: '0', beat: 16 }], 64);
    // The old hold now rides at the pre-pause rate…
    expect(traceStateAt(out, 18).moving).toBe(true);
    expect(traceStateAt(out, 18).pos).toBeCloseTo(19);
    // …the seek still lands where it landed, tail untouched.
    const landing = out.find((p) => p.jump)!;
    expect(landing.beat).toBe(20);
    expect(landing.pos).toBeCloseTo(4);
    expect(out[out.length - 1].pos).toBeCloseTo(22);
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
      jumps: [{ id: 'a', slotId: '1', beat: 40, deltaSec: -2 }],
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

  it('edits address slots by slotId, not index — re-keying is impossible by construction (ADR 0039)', () => {
    // Explicit non-index slot ids: the same edits land on the same slots.
    const edits = {
      ...emptyEdits(),
      jumps: [{ id: 'a', slotId: 'mid', beat: 40, deltaSec: -2 }],
      lanes: { 'mid:fader': [{ beat: 16, value: 0 }, { beat: 24, value: 1 }] },
      nudges: { mid: 0.25 },
      trims: { mid: 0.7 },
    };
    const { routine } = buildPlannedRoutine(
      { ...input(), slotIds: ['first', 'mid', 'last'], edits },
      ctx
    );
    const slot1 = routine.slots[1];
    expect(slot1.slotId).toBe('mid');
    expect(slot1.jumpMixSecs).toHaveLength(1);
    expect(slot1.lanes.authored?.fader).toBe(true);
    expect(slot1.trim).toBe(0.7);
    expect(routine.slots[0].jumpMixSecs).toHaveLength(0);
    expect(routine.slots[0].trim).toBe(0.5);
    // Absent slotIds default to the migration identity String(index).
    const def = buildPlannedRoutine(input(), ctx).routine;
    expect(def.slots.map((s) => s.slotId)).toEqual(['0', '1', '2']);
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
        { id: 'a', slotId: '1', beat: 8, deltaSec: -2, repeat: 4 },
        { slotId: 7, beat: 8 },
      ],
      removedRecordedJumps: [{ slotId: '0', beat: 12.5 }, null],
    });
    expect(parsed.lanes['0:fader'].map((p) => p.beat)).toEqual([2, 4]); // sorted, junk dropped
    expect(parsed.jumps).toHaveLength(1);
    expect(parsed.jumps[0].repeat).toBe(4);
    expect(parsed.removedRecordedJumps).toEqual([{ slotId: '0', beat: 12.5 }]);
  });

  it('migrates legacy index-keyed edits losslessly: slot n → slotId String(n) (ADR 0039)', () => {
    const parsed = parseEdits({
      lanes: { '1:fader': [{ beat: 4, value: 0.5 }] },
      jumps: [{ id: 'a', slot: 1, beat: 8, deltaSec: -2, repeat: 4 }],
      removedRecordedJumps: [{ slot: 0, beat: 12.5 }],
      pauses: [{ id: 'p', slot: 2, beat: 6, durBeats: 4 }],
      removedRecordedPauses: [{ slot: 2, beat: 30 }],
      nudges: { '1': 0.05 },
      trims: { '2': 0.7 },
    });
    expect(parsed.jumps[0]).toEqual({ id: 'a', slotId: '1', beat: 8, deltaSec: -2, repeat: 4 });
    expect(parsed.removedRecordedJumps).toEqual([{ slotId: '0', beat: 12.5 }]);
    expect(parsed.pauses[0]).toEqual({ id: 'p', slotId: '2', beat: 6, durBeats: 4 });
    expect(parsed.removedRecordedPauses).toEqual([{ slotId: '2', beat: 30 }]);
    // Lane / nudge / trim keys are already the migrated form.
    expect(parsed.lanes['1:fader']).toEqual([{ beat: 4, value: 0.5 }]);
    expect(parsed.nudges).toEqual({ '1': 0.05 });
    expect(parsed.trims).toEqual({ '2': 0.7 });
    // Round-trip: a re-parse of the migrated form is itself.
    expect(parseEdits(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
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
