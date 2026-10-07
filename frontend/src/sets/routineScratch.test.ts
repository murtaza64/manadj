import { describe, expect, it } from 'vitest';
import { buildPlannedRoutine, traceStateAt, type RoutineEventInput, type RoutinePlanInput } from './routinePlan';
import { planScratchClip, scratchClipAt, scratchFramesFrom, slotScratchClips } from './routineScratch';

const tick = (beat: number, playheads: Record<string, number>): RoutineEventInput => ({ kind: 'tick', beat, playheads });
const tr = (beat: number, slot: number, action: string, playhead: number, extra: Record<string, unknown> = {}): RoutineEventInput =>
  ({ kind: 'transport', beat, slot, action, playhead, ...extra });

/** Slot 1 scratches at beats 20–21 (120 BPM: 0.5 s per beat): back 0.3 s,
 * then lands 0.2 s behind where it began. */
function gesture(): RoutineEventInput[] {
  return [
    tr(20, 1, 'scratchBegin', 2, { audioTime: 10 }),
    tr(20.2, 1, 'scratchMove', 1.9, { filter: { drive: -6, rate: -1 }, audioTime: 10.1 }),
    tr(20.6, 1, 'scratchMove', 1.7, { filter: { drive: 2, rate: 0.5 }, audioTime: 10.3 }),
    tr(21, 1, 'scratchEnd', 1.8, { audioTime: 10.5 }),
  ];
}

describe('slotScratchClips', () => {
  it('brackets begin → moves → end with filter state and the landing', () => {
    const clips = slotScratchClips([...gesture(), tr(19, 1, 'play', 1.5)], 1);
    expect(clips).toHaveLength(1);
    const [c] = clips;
    expect(c).toMatchObject({ startBeat: 20, endBeat: 21 });
    expect(c.frames.map((f) => [f.beat, f.position, f.filter, f.playing])).toEqual([
      [20, 2, { drive: 0, rate: 0 }, true],
      [20.2, 1.9, { drive: -6, rate: -1 }, true],
      [20.6, 1.7, { drive: 2, rate: 0.5 }, true],
      [21, 1.8, null, true],
    ]);
  });

  it('ignores other slots and closes an unterminated bracket on its last frame', () => {
    const clips = slotScratchClips(gesture().slice(0, 3), 1);
    expect(clips[0].frames.at(-1)).toMatchObject({ beat: 20.6, position: 1.7, filter: null });
    expect(slotScratchClips(gesture(), 0)).toEqual([]);
  });

  it('a scratch from a paused deck releases paused', () => {
    const clips = slotScratchClips([...gesture(), tr(30, 1, 'play', 1.8)], 1);
    expect(clips[0].frames.every((f) => !f.playing)).toBe(true);
  });
});

describe('planScratchClip', () => {
  const clip = slotScratchClips(gesture(), 1)[0];

  it('maps beats onto the mix axis and keeps recorded timing at the recorded tempo', () => {
    const p = planScratchClip(clip, { beatShift: 0, posShift: 0, beatOriginMixSec: 100, secPerBeat: 0.5, rateAfter: 1 });
    expect(p.startMixSec).toBe(110);
    expect(p.endMixSec).toBe(110.5);
    expect(p.frames[1]).toMatchObject({ time: 110.1, position: 1.9, motion: { drive: -6, rate: -1 } });
    expect(p.frames.at(-1)).toMatchObject({ time: 110.5, position: 1.8, motion: null, playing: true, rate: 1 });
  });

  it('at a slower tempo the gesture stretches and its rates shrink by the same factor', () => {
    const p = planScratchClip(clip, { beatShift: 0, posShift: 0, beatOriginMixSec: 0, secPerBeat: 1, rateAfter: 1 });
    expect(p.endMixSec - p.startMixSec).toBe(1);
    expect(p.frames[1].motion).toMatchObject({ drive: -3, rate: -0.5 });
  });

  it('rides the slot entry shift and nudge', () => {
    const p = planScratchClip(clip, { beatShift: 4, posShift: 0.25, beatOriginMixSec: 0, secPerBeat: 0.5, rateAfter: 1 });
    expect(p.startMixSec).toBe(12);
    expect(p.frames[0].position).toBe(2.25);
  });
});

describe('scratchFramesFrom / scratchClipAt', () => {
  const p = planScratchClip(slotScratchClips(gesture(), 1)[0],
    { beatShift: 0, posShift: 0, beatOriginMixSec: 0, secPerBeat: 0.5, rateAfter: 1 });

  it('before the clip: every frame, mapped to the audio clock', () => {
    const frames = scratchFramesFrom(p, 9, (t) => t + 1000);
    expect(frames.map((f) => f.time)).toEqual([1010, 1010.1, 1010.3, 1010.5]);
    expect(frames[1].motion?.time).toBe(1010.1);
  });

  it('inside the clip: a reconstructed head at t, then the remaining frames', () => {
    const frames = scratchFramesFrom(p, 10.2, (t) => t);
    expect(frames.map((f) => f.time)).toEqual([10.2, 10.3, 10.5]);
    expect(frames[0].motion).not.toBeNull();
    expect(frames[0].position).toBeLessThan(1.9);
  });

  it('finds the running clip, with lead', () => {
    expect(scratchClipAt([p], 9.95, 0.1)).toBe(p);
    expect(scratchClipAt([p], 9.8, 0.1)).toBeNull();
    expect(scratchClipAt([p], 10.5)).toBeNull();
  });
});

describe('buildPlannedRoutine with a scratched slot', () => {
  function input(): RoutinePlanInput {
    const events: RoutineEventInput[] = [];
    for (let b = 0; b <= 40; b += 4) {
      const playheads: Record<string, number> = { 0: 60 + b * 0.5 };
      if (b >= 16) playheads['1'] = b <= 20 ? (b - 16) * 0.5 : 1.8 + (b - 21) * 0.5;
      if (b >= 32) playheads['2'] = (b - 32) * 0.5;
      events.push(tick(b, playheads));
    }
    events.push(...gesture());
    events.sort((a, b) => (a.beat as number) - (b.beat as number));
    return { cast: [1, 2, 3], entryOffsetsBeats: [0, 16, 32], entryPositions: [60, 0, 0], durationBeats: 40, events };
  }
  const ctx = { startEntryIndex: 0, mixStartSec: 100, targetBpm: 120, adoptedDeck: 'A' as const, busy: [], trackBpms: [120, 120, 120] };

  it('plans the clip on its slot and keeps per-move samples out of the trace', () => {
    const { routine } = buildPlannedRoutine(input(), ctx);
    const slot = routine.slots[1];
    expect(slot.scratches).toHaveLength(1);
    expect(slot.scratches![0]).toMatchObject({ startMixSec: 110, endMixSec: 110.5 });
    expect(slot.trace.some((p) => p.beat > 20 && p.beat < 21)).toBe(false);
    // After the landing the trace resumes from the recorded position.
    expect(traceStateAt(slot.trace, 22).pos).toBeCloseTo(2.3, 6);
    expect(routine.slots[0].scratches).toBeUndefined();
  });
});
