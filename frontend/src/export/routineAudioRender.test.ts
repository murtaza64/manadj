import { describe, expect, it } from 'vitest';
import { scratchRuns, traceSegments, type ScratchRun } from './routineAudioRender';
import type { PlannedScratchClip } from '../sets/routineScratch';
import { moveScratch, type ScratchMotion } from '../playback/worklet/scratchMotion';
import { routineSlotStateAt } from '../sets/routinePlan';
import type { PlannedRoutine, PlannedRoutineSlot, RoutineTracePoint } from '../sets/routinePlan';
import { routineActions, scratchActionKind } from './routineActions';

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

describe('scratch clips (#393)', () => {
  // Play from 10 s; at mix 4 s a 1 s gesture: drag back 0.5 s, push
  // forward 0.3 s, release; the trace carries only the net landing.
  const trace: RoutineTracePoint[] = [
    { beat: 0, pos: 10, jump: false, moving: true, ratePerBeat: SEC_PER_BEAT },
    { beat: 5 / SEC_PER_BEAT, pos: 14.8, jump: true, moving: true, ratePerBeat: SEC_PER_BEAT },
  ];
  const motion = (time: number, position: number, rate: number) => ({
    time, position, drive: 0, rate, trackDuration: Infinity, loop: null,
  });
  /** A hand gesture as the capture records it: a move every 5 ms with
   * velocity `v(t)` (track s per s), released onto play at `end`. */
  const gesture = (start: number, end: number, p0: number, v: (t: number) => number, landing: number): PlannedScratchClip => {
    const frames: PlannedScratchClip['frames'] = [];
    let m: ScratchMotion = motion(start, p0, 0);
    frames.push({ time: start, position: p0, playing: true, loop: null, rate: 1, motion: m });
    for (let t = start + 0.005; t < end - 1e-9; t += 0.005) {
      m = moveScratch(m, t, v(t) * 0.005, 0.005);
      frames.push({ time: t, position: m.position, playing: true, loop: null, rate: 1, motion: m });
    }
    frames.push({ time: end, position: landing, playing: true, loop: null, rate: 1, motion: null });
    return { startMixSec: start, endMixSec: end, frames };
  };
  const clip = gesture(4, 5, 14, (t) => (t < 4.45 ? -1.25 : t < 4.85 ? 0.75 : 0), 14.8);
  const slot = { ...slotWith(trace), scratches: [clip] };
  const routine = routineWith([slot], 20 / SEC_PER_BEAT);
  const range = { startSec: 0, endSec: 20 };

  it('trace segments leave the clip span to the gesture', () => {
    const segs = traceSegments(routine, slot, range, 300);
    expect(segmentPosAt(segs, 3.9)).toBeCloseTo(13.9, 4);
    expect(segmentPosAt(segs, 4.5)).toBeNull();
    expect(segmentPosAt(segs, 5.5)).toBeCloseTo(15.3, 4);
  });

  it('runs follow the recorded trajectory: backward, then forward', () => {
    const step = 128 / 48000;
    const runs = scratchRuns(slot, range, 300, step);
    const moving = runs.filter((r) => r.rates.length > 2);
    expect(moving.map((r) => r.direction)).toEqual([-1, 1]);
    const travel = (r: ScratchRun) => r.rates.reduce((a, v) => a + v * r.stepSec, 0);
    expect(travel(moving[0])).toBeGreaterThan(0.45);
    expect(moving[1].trackStart).toBeLessThan(13.55);
    // Runs sit on the render quantum grid.
    for (const r of runs) expect(Math.abs(r.mixStart / step - Math.round(r.mixStart / step))).toBeLessThan(1e-6);
  });

  it('the slot state follows the gesture; the net view keeps the trace', () => {
    expect(routineSlotStateAt(routine, slot, 4.45).trackTime).toBeCloseTo(13.44, 1);
    expect(routineSlotStateAt(routine, slot, 4.45, { netScratch: true }).trackTime).toBeCloseTo(14.45, 4);
    expect(routineSlotStateAt(routine, slot, 5.5).trackTime).toBeCloseTo(15.3, 4);
  });

  it('labels a scratch, and a long backward throw as a backspin', () => {
    expect(scratchActionKind(clip)).toBe('scratch');
    const spin = gesture(4, 5, 14, (t) => (t < 4.6 ? -4 : 0), 11.6);
    expect(scratchActionKind(spin)).toBe('backspin');
    const r = routineWith([{ ...slot, scratches: [spin] }], 20 / SEC_PER_BEAT);
    expect(routineActions(r, []).find((a) => a.kind === 'backspin')).toMatchObject({ slot: 0, beat: expect.closeTo(4 / SEC_PER_BEAT, 6) });
  });
});
