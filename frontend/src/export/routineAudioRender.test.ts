import { describe, expect, it } from 'vitest';
import { traceSegments } from './routineAudioRender';
import { routineSlotStateAt } from '../sets/routinePlan';
import type { PlannedRoutine, PlannedRoutineSlot, RoutineTracePoint } from '../sets/routinePlan';
import { routineActions } from './routineActions';

const SEC_PER_BEAT = 60 / 174;

function slotWith(trace: RoutineTracePoint[], releaseMixSec = 1e9): PlannedRoutineSlot {
  return {
    slot: 0, slotId: 's0', trackId: 1, deck: 'A',
    occupyFromMixSec: 0, releaseMixSec, entryMixSec: 0, entryTrackSec: trace[0]?.pos ?? 0,
    basePitchPercent: 0, trace,
    lanes: {
      fader: [], trim: [], eqLow: [], eqMid: [], eqHigh: [], filter: [],
      defaults: { fader: 1, trim: 0.5, eq: 0.5, filter: 0 },
    },
    trim: 0.5, jumpMixSecs: [],
  };
}

function routineWith(slots: PlannedRoutineSlot[], durationBeats: number): PlannedRoutine {
  return {
    startEntryIndex: 0, mixStartSec: 0, mixEndSec: durationBeats * SEC_PER_BEAT, beatOriginMixSec: 0,
    playbackBounds: { startBeat: 0, endBeat: durationBeats },
    boundsLimits: { maxStartBeat: 0, minEndBeat: durationBeats },
    targetBpm: 174, secPerBeat: SEC_PER_BEAT, slots,
    exit: { slot: 0, deck: 'A', trackId: 1, trackSecAtEnd: 0, pitchPercent: 0 },
    jumpMixSecs: [],
  };
}

function segmentPosAt(segs: ReturnType<typeof traceSegments>, mixSec: number): number | null {
  for (const s of segs) {
    if (mixSec >= s.mixStart - 1e-9 && mixSec < s.mixEnd) return s.trackStart + (mixSec - s.mixStart) * s.rate;
  }
  return null;
}

describe('traceSegments', () => {
  // Beatmatched play from 10 s, a backward jump at beat 32 (loop-ish), a
  // pause from beat 48 to 56, then play out at a slightly ridden rate.
  const trace: RoutineTracePoint[] = [
    { beat: 0, pos: 10, jump: false, moving: true, ratePerBeat: SEC_PER_BEAT },
    { beat: 32, pos: 10 + 16 * SEC_PER_BEAT, jump: true, moving: true, ratePerBeat: SEC_PER_BEAT },
    { beat: 48, pos: 10 + 32 * SEC_PER_BEAT, jump: false, moving: false, ratePerBeat: 0 },
    { beat: 56, pos: 10 + 32 * SEC_PER_BEAT, jump: false, moving: true, ratePerBeat: SEC_PER_BEAT * 1.02 },
  ];
  const slot = slotWith(trace);
  const routine = routineWith([slot], 96);
  const range = { startSec: 0, endSec: 96 * SEC_PER_BEAT };
  const segs = traceSegments(routine, slot, range, 300);

  it('splits at the jump and the pause', () => {
    expect(segs).toHaveLength(3);
    expect(segs[0].trackStart).toBeCloseTo(10, 6);
    expect(segs[1].mixStart).toBeCloseTo(32 * SEC_PER_BEAT, 6);
    expect(segs[1].trackStart).toBeCloseTo(10 + 16 * SEC_PER_BEAT, 6);
    expect(segs[2].mixStart).toBeCloseTo(56 * SEC_PER_BEAT, 6);
    expect(segs[2].rate).toBeCloseTo(1.02, 6);
  });

  it('agrees with routineSlotStateAt wherever the deck plays', () => {
    for (let beat = 0.25; beat < 96; beat += 0.5) {
      const t = beat * SEC_PER_BEAT;
      const live = routineSlotStateAt(routine, slot, t);
      const pos = segmentPosAt(segs, t);
      if (live.playing) {
        expect(pos, `beat ${beat}`).not.toBeNull();
        expect(pos!).toBeCloseTo(live.trackTime, 4);
      } else {
        expect(pos, `beat ${beat}`).toBeNull();
      }
    }
  });

  it('starts a silent-lead slot where its position crosses 0', () => {
    const lead = slotWith([{ beat: 0, pos: -2, jump: false, moving: true, ratePerBeat: SEC_PER_BEAT }]);
    const r = routineWith([lead], 32);
    const s = traceSegments(r, lead, { startSec: 0, endSec: 32 * SEC_PER_BEAT }, 300);
    expect(s).toHaveLength(1);
    expect(s[0].mixStart).toBeCloseTo(2, 6);
    expect(s[0].trackStart).toBe(0);
  });

  it('clips to the render range, the track end and the deck release', () => {
    const s = traceSegments(routine, slot, { startSec: 5, endSec: 6 }, 300);
    expect(s).toHaveLength(1);
    expect(s[0].mixStart).toBe(5);
    expect(s[0].mixEnd).toBe(6);
    expect(s[0].trackStart).toBeCloseTo(15, 6);
    const short = traceSegments(routine, slot, range, 12);
    expect(short[0].mixEnd).toBeCloseTo(2, 6);
    const released = traceSegments(routine, slotWith(trace, 3), range, 300);
    expect(released).toHaveLength(1);
    expect(released[0].mixEnd).toBeCloseTo(3, 6);
  });
});

describe('routineActions', () => {
  it('labels transport gestures and lane kills/throws', () => {
    const slot = slotWith([{ beat: 0, pos: 0, jump: false, moving: true, ratePerBeat: SEC_PER_BEAT }]);
    slot.lanes.eqLow = [{ beat: 4, value: 0 }, { beat: 8, value: 0.5 }];
    slot.lanes.fader = [{ beat: 2, value: 0.9 }, { beat: 20, value: 0 }];
    slot.lanes.defaults.fader = 0;
    slot.lanes.filter = [{ beat: 10, value: -0.6 }, { beat: 12, value: 0 }];
    const routine = routineWith([slot], 32);
    const actions = routineActions(routine, [
      { kind: 'transport', action: 'hotCue', detail: 3, beat: 1, slot: 0, playhead: 0 },
      { kind: 'transport', action: 'jumpBeats', detail: -16, beat: 6, slot: 0, playhead: 0 },
      { kind: 'transport', action: 'previewStart', detail: 3, beat: 1, slot: 0, playhead: 0 },
      { kind: 'loop', beat: 9, slot: 0, playhead: 0, region: { start: 1, end: 2 } },
    ]);
    expect(actions.map((a) => `${a.beat}:${a.label}`)).toEqual([
      '1:HOT CUE 3', '2:FADER IN', '4:LOW KILL', '6:◀ JUMP 4 BARS', '8:LOW BACK', '9:LOOP',
      '10:FILTER ◀ LPF', '12:FILTER OFF', '20:FADER OUT',
    ]);
    expect(actions[0].cueSlot).toBe(3);
  });
});
