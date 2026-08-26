/**
 * Routine replay planning (routines 159) — the pure seam under vitest:
 * deck allocation, beat-domain playhead traces, recorded lanes, and the
 * re-anchored pitch evaluator. Synthetic events use the promoted-Routine
 * shape (slot-addressed, beat-stamped) exactly as backend promotion
 * emits them.
 */
import { describe, expect, it } from 'vitest';
import {
  allocateRoutineDecks,
  buildPlannedRoutine,
  buildSlotLanes,
  buildSlotTrace,
  routineSlotStateAt,
  slotLanesAt,
  traceStateAt,
  type RoutineEventInput,
  type RoutinePlanInput,
} from './routinePlan';

// ── Synthetic recording helpers ─────────────────────────────────────────

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
const transport = (
  beat: number,
  slot: number,
  action: string,
  playhead: number
): RoutineEventInput => ({ kind: 'transport', beat, slot, action, playhead });

/**
 * A clean 3-slot routine at 120 BPM everywhere (sync rate 0.5 track-sec
 * per beat), 64 beats long. Slot entries at beats 0/16/32; entry
 * positions 60/0/10. Ticks every 4 beats keep every loaded slot's
 * playhead advancing at sync from its entry (slots run from their entry;
 * slot 2 pre-rolls parked from beat 24).
 */
function syntheticRoutine(): RoutinePlanInput {
  const events: RoutineEventInput[] = [];
  const pos = (slot: number, beat: number): number | null => {
    const entries = [0, 16, 32];
    const positions = [60, 0, 10];
    if (slot === 2 && beat >= 24 && beat < 32) return positions[2]; // parked pre-roll
    if (beat < entries[slot] && slot !== 0) return null;
    return positions[slot] + Math.max(0, beat - entries[slot]) * 0.5;
  };
  for (let b = 0; b <= 64; b += 4) {
    const playheads: Record<string, number> = {};
    for (const slot of [0, 1, 2]) {
      const p = pos(slot, b);
      if (p !== null) playheads[String(slot)] = p;
    }
    events.push(tick(b, playheads));
  }
  // Slot 1 and 2 fader raises at their entries; slot 0 fades out.
  events.push(control(16, 1, 'fader', 1));
  events.push(control(32, 2, 'fader', 1));
  events.push(control(40, 0, 'fader', 0.4));
  events.push(control(48, 0, 'fader', 0));
  events.sort((a, b) => (a.beat as number) - (b.beat as number));
  return {
    cast: [1, 2, 3],
    entryOffsetsBeats: [0, 16, 32],
    entryPositions: [60, 0, 10],
    durationBeats: 64,
    events,
  };
}

const baseCtx = {
  startEntryIndex: 0,
  mixStartSec: 100,
  targetBpm: 120,
  adoptedDeck: 'A' as const,
  busy: [],
  trackBpms: [120, 120, 120],
};

// ── Deck allocation ─────────────────────────────────────────────────────

describe('allocateRoutineDecks', () => {
  it('adopts slot 0 and hands out A→B→C→D to the rest', () => {
    expect(allocateRoutineDecks([0, 10, 20, 30], 'A', [])).toEqual(['A', 'B', 'C', 'D']);
  });

  it('adoption on B leaves A first in line', () => {
    expect(allocateRoutineDecks([0, 10, 20], 'B', [])).toEqual(['B', 'A', 'C']);
  });

  it('skips an externally busy deck until it frees', () => {
    // A is busy until mix 15: slot 1 (entry 10) must skip it, slot 2
    // (entry 20) may not take it either — it went to C... A is free by
    // then and A precedes D.
    expect(allocateRoutineDecks([0, 10, 20], 'B', [{ deck: 'A', untilMixSec: 15 }])).toEqual([
      'B',
      'C',
      'A',
    ]);
  });

  it('overflow slots get null (plan-time validation, not improvisation)', () => {
    expect(allocateRoutineDecks([0, 1, 2, 3, 4], 'A', [])).toEqual(['A', 'B', 'C', 'D', null]);
  });
});

// ── Traces ──────────────────────────────────────────────────────────────

describe('buildSlotTrace / traceStateAt', () => {
  const syncRate = 0.5; // 120 BPM

  it('interpolates a beatmatched stretch and extrapolates past the end', () => {
    const trace = buildSlotTrace(
      [
        { beat: 0, pos: 10 },
        { beat: 8, pos: 14 },
        { beat: 16, pos: 18 },
      ],
      syncRate,
      0,
      10
    );
    expect(traceStateAt(trace, 4)).toEqual({ pos: 12, moving: true, ratePerBeat: 0.5 });
    // Past the last sample: keeps rolling at the last observed rate.
    const past = traceStateAt(trace, 20);
    expect(past.pos).toBeCloseTo(20, 6);
    expect(past.moving).toBe(true);
  });

  it('a flat stretch reads paused, holding position', () => {
    const trace = buildSlotTrace(
      [
        { beat: 0, pos: 10 },
        { beat: 8, pos: 14 },
        { beat: 16, pos: 14.05 },
        { beat: 24, pos: 18 },
      ],
      syncRate,
      0,
      10
    );
    const mid = traceStateAt(trace, 12);
    expect(mid.moving).toBe(false);
    expect(mid.pos).toBeCloseTo(14, 1);
  });

  it('a recorded seek is a jump: prior motion rides to the instant, then snaps', () => {
    const trace = buildSlotTrace(
      [
        { beat: 0, pos: 10 },
        { beat: 8, pos: 14 },
        { beat: 12, pos: 60 }, // seek forward
        { beat: 20, pos: 64 },
      ],
      syncRate,
      0,
      10
    );
    expect(trace[2].jump).toBe(true);
    // Just before the jump: still riding from pos 14 at 0.5/beat.
    expect(traceStateAt(trace, 11.9).pos).toBeCloseTo(14 + 3.9 * 0.5, 3);
    // At/after the jump: snapped.
    expect(traceStateAt(trace, 12).pos).toBeCloseTo(60, 6);
    expect(traceStateAt(trace, 16).pos).toBeCloseTo(62, 6);
  });

  it('before the first sample the deck parks at the first position', () => {
    const trace = buildSlotTrace([{ beat: 16, pos: 0 }], syncRate, 16, 0);
    expect(traceStateAt(trace, 4)).toEqual({ pos: 0, moving: false, ratePerBeat: 0 });
  });
});

// ── Lanes ───────────────────────────────────────────────────────────────

describe('buildSlotLanes / slotLanesAt', () => {
  it('a later slot with recorded fader moves starts closed; its raise is the entry', () => {
    const routine = syntheticRoutine();
    const lanes = buildSlotLanes(routine.events, 1, false);
    expect(lanes.defaults.fader).toBe(0);
    const slot = {
      slot: 1,
      trackId: 2,
      deck: 'B' as const,
      entryMixSec: 0,
      entryTrackSec: 0,
      basePitchPercent: 0,
      trace: [],
      lanes,
      jumpMixSecs: [],
    };
    expect(slotLanesAt(slot, 8).fader).toBe(0);
    expect(slotLanesAt(slot, 16).fader).toBe(1);
  });

  it('slot 0 defaults open (it is sounding at adoption) and follows its fade-out', () => {
    const routine = syntheticRoutine();
    const lanes = buildSlotLanes(routine.events, 0, true);
    expect(lanes.defaults.fader).toBe(1);
    const slot = {
      slot: 0,
      trackId: 1,
      deck: 'A' as const,
      entryMixSec: 0,
      entryTrackSec: 60,
      basePitchPercent: 0,
      trace: [],
      lanes,
      jumpMixSecs: [],
    };
    expect(slotLanesAt(slot, 20).fader).toBe(1);
    expect(slotLanesAt(slot, 44).fader).toBe(0.4);
    expect(slotLanesAt(slot, 60).fader).toBe(0);
  });

  it('a slot with no fader events at all defaults open from its entry', () => {
    const lanes = buildSlotLanes([], 2, false);
    expect(lanes.defaults.fader).toBe(1);
  });

  it('EQ and filter default neutral and step with recorded values', () => {
    const events = [control(10, 1, 'eqLow', 0.1), control(12, 1, 'filter', -0.5)];
    const lanes = buildSlotLanes(events, 1, false);
    const slot = {
      slot: 1,
      trackId: 2,
      deck: 'B' as const,
      entryMixSec: 0,
      entryTrackSec: 0,
      basePitchPercent: 0,
      trace: [],
      lanes,
      jumpMixSecs: [],
    };
    // No fader events on this slot → open by default (see defaults rule).
    expect(slotLanesAt(slot, 5)).toEqual({
      fader: 1,
      eq: { low: 0.5, mid: 0.5, high: 0.5 },
      filter: 0,
    });
    expect(slotLanesAt(slot, 12).eq.low).toBe(0.1);
    expect(slotLanesAt(slot, 12).filter).toBe(-0.5);
  });
});

// ── The whole build + evaluation ────────────────────────────────────────

describe('buildPlannedRoutine', () => {
  it('maps the beat clock onto the mix axis at the target tempo', () => {
    const { routine, warnings } = buildPlannedRoutine(syntheticRoutine(), baseCtx);
    expect(warnings).toEqual([]);
    expect(routine.secPerBeat).toBeCloseTo(0.5, 9);
    expect(routine.mixEndSec).toBeCloseTo(100 + 64 * 0.5, 6);
    expect(routine.slots.map((s) => s.deck)).toEqual(['A', 'B', 'C']);
    expect(routine.slots[1].entryMixSec).toBeCloseTo(108, 6);
    expect(routine.exit.deck).toBe('C');
    // Exit slot entered at pos 10 (beat 32), advances 32 beats at sync.
    expect(routine.exit.trackSecAtEnd).toBeCloseTo(10 + 32 * 0.5, 3);
  });

  it('a slower Set tempo stretches the same recording (beat-rebased replay)', () => {
    const { routine } = buildPlannedRoutine(syntheticRoutine(), { ...baseCtx, targetBpm: 100 });
    expect(routine.secPerBeat).toBeCloseTo(0.6, 9);
    expect(routine.mixEndSec).toBeCloseTo(100 + 64 * 0.6, 6);
    // Track positions at a given BEAT are tempo-invariant.
    expect(routine.exit.trackSecAtEnd).toBeCloseTo(26, 3);
    // Every slot pitches down to hold 100 BPM on 120 BPM tracks.
    expect(routine.slots[0].basePitchPercent).toBeCloseTo((100 / 120 - 1) * 100, 6);
    expect(routine.exit.pitchPercent).toBeCloseTo((100 / 120 - 1) * 100, 6);
  });

  it('flags recorded global mixer moves (crossfader) as dropped', () => {
    const input = syntheticRoutine();
    input.events.push(control(20, null, 'crossfader', 0.5));
    const { warnings } = buildPlannedRoutine(input, baseCtx);
    expect(warnings.some((w) => w.kind === 'routine-global-controls-dropped')).toBe(true);
  });

  it('flags deck overflow as a plan-time error', () => {
    const input = syntheticRoutine();
    input.cast = [1, 2, 3, 4, 5];
    input.entryOffsetsBeats = [0, 8, 16, 24, 32];
    input.entryPositions = [60, 0, 0, 0, 0];
    const { routine, warnings } = buildPlannedRoutine(input, {
      ...baseCtx,
      trackBpms: [120, 120, 120, 120, 120],
    });
    expect(routine.slots[4].deck).toBeNull();
    expect(warnings.some((w) => w.kind === 'routine-deck-overflow' && w.severity === 'error')).toBe(
      true
    );
  });
});

describe('routineSlotStateAt (re-anchored pitch)', () => {
  it('beatmatched segments snap to the slot base pitch; parked slots hold', () => {
    const { routine } = buildPlannedRoutine(syntheticRoutine(), baseCtx);
    // Mid-routine, slot 0 rolling at sync → base pitch (0 at native).
    const s0 = routineSlotStateAt(routine, routine.slots[0], 110);
    expect(s0.playing).toBe(true);
    expect(s0.pitchPercent).toBe(0);
    expect(s0.trackTime).toBeCloseTo(60 + 20 * 0.5, 3);
    // Slot 2 pre-rolls parked before its entry (beat 32 = mix 116).
    const s2 = routineSlotStateAt(routine, routine.slots[2], 114);
    expect(s2.playing).toBe(false);
    expect(s2.trackTime).toBeCloseTo(10, 3);
    // ... and rolls after it.
    const s2on = routineSlotStateAt(routine, routine.slots[2], 120);
    expect(s2on.playing).toBe(true);
    expect(s2on.trackTime).toBeCloseTo(10 + (120 - 116) / 0.5 / 2 /* 4s at 0.5s/beat, ×0.5 */, 1);
  });

  it('a deliberate recorded ride re-anchors multiplicatively to the target rate', () => {
    // Slot advances 10% fast (0.55 track-sec/beat on a 120 BPM track).
    const events: RoutineEventInput[] = [];
    for (let b = 0; b <= 32; b += 4) {
      events.push(tick(b, { '0': 60 + b * 0.55, '1': b * 0.5 }));
    }
    const input: RoutinePlanInput = {
      cast: [1, 2, 3],
      entryOffsetsBeats: [0, 8, 16],
      entryPositions: [60, 0, 0],
      durationBeats: 32,
      events,
    };
    const { routine } = buildPlannedRoutine(input, baseCtx);
    const s = routineSlotStateAt(routine, routine.slots[0], 108);
    // deckRate = 0.55 / 0.5 = 1.10 → +10% over base 0.
    expect(s.pitchPercent).toBeCloseTo(10, 1);
    // At a slower target the ride still lands 10% over ITS base.
    const slow = buildPlannedRoutine(input, { ...baseCtx, targetBpm: 100 }).routine;
    const sSlow = routineSlotStateAt(slow, slow.slots[0], 108);
    expect((1 + sSlow.pitchPercent / 100) / (1 + slow.slots[0].basePitchPercent / 100)).toBeCloseTo(
      1.1,
      2
    );
  });

  it('negative recorded positions clamp to 0 (pre-roll entry marks)', () => {
    const events = [tick(0, { '0': 60 }), tick(8, { '2': -4 }), tick(16, { '2': 0 })];
    const input: RoutinePlanInput = {
      cast: [1, 2, 3],
      entryOffsetsBeats: [0, 4, 8],
      entryPositions: [60, 0, -8],
      durationBeats: 32,
      events,
    };
    const { routine } = buildPlannedRoutine(input, baseCtx);
    const s = routineSlotStateAt(routine, routine.slots[2], 104);
    expect(s.trackTime).toBeGreaterThanOrEqual(0);
  });

  it('transport playheads join the trace (a seek mid-routine relocates the slot)', () => {
    const events = [
      tick(0, { '0': 60 }),
      tick(4, { '0': 62 }),
      transport(6, 0, 'seek', 90),
      tick(8, { '0': 91 }),
      tick(12, { '0': 93 }),
    ];
    const input: RoutinePlanInput = {
      cast: [1, 2, 3],
      entryOffsetsBeats: [0, 4, 8],
      entryPositions: [60, 0, 0],
      durationBeats: 16,
      events,
    };
    const { routine } = buildPlannedRoutine(input, baseCtx);
    expect(routine.jumpMixSecs.length).toBeGreaterThan(0);
    const before = routineSlotStateAt(routine, routine.slots[0], 100 + 5.9 * 0.5);
    const after = routineSlotStateAt(routine, routine.slots[0], 100 + 6.1 * 0.5);
    expect(before.trackTime).toBeLessThan(70);
    expect(after.trackTime).toBeGreaterThan(89);
  });
});
