/**
 * Jump-aware clip segmentation (#161): the ladder renders the audio AS
 * IT WILL PLAY — jumps splice, loop-collapsed repeats repeat, silent
 * leads/pauses go blank.
 */
import { describe, expect, it } from 'vitest';
import type { Transition } from '../editor/mixModel';
import { planSet, planStateAt, type PlanInput, type TempoPolicyInput } from './planner';
import { clipContentSegments } from './OverviewLadder';

const facts = (durationSec: number, bpm: number | null = 120) => ({
  durationSec,
  bpm,
  hotCue1Sec: null,
});
const durOf = () => 300;

function twoTracks(tr: Transition): PlanInput {
  return {
    entries: [
      { trackId: 1, pin: { kind: 'transition', uuid: 't1' } },
      { trackId: 2, pin: null },
    ],
    tracks: { 1: facts(90), 2: facts(300) },
    transitionsByUuid: { t1: tr },
    takesByUuid: {},
  };
}

const baseTr = (over: Partial<Transition> = {}): Transition => ({
  startSec: 60,
  durationSec: 20,
  bInSec: 8,
  tempoMatch: false,
  lanes: {},
  ...over,
});

describe('clipContentSegments', () => {
  it.each<TempoPolicyInput>([
    { policy: 'riding' },
    { policy: 'fixed', setTempoBpm: 132 },
  ])('routine waveform and cue positions match playback under $policy tempo', (tempo) => {
    const plan = planSet({
      entries: [1, 2, 3].map((trackId) => ({ trackId, pin: null })),
      tracks: { 1: facts(300), 2: facts(300), 3: facts(300) },
      transitionsByUuid: {},
      takesByUuid: {},
      tempo,
      routines: [{
        startEntryIndex: 0,
        routine: {
          cast: [1, 2, 3],
          entryOffsetsBeats: [0, 16, 32],
          entryPositions: [60, 0, 10],
          durationBeats: 64,
          events: Array.from({ length: 17 }, (_, i) => {
            const beat = i * 4;
            return {
              kind: 'tick', beat,
              playheads: {
                0: 60 + beat * 0.5,
                ...(beat >= 16 ? { 1: Math.min(beat - 16, 24) * 0.5 + Math.max(0, beat - 40) * 0.75 } : {}),
                ...(beat >= 32 ? { 2: 10 + (beat - 32) * 0.5 } : {}),
              },
            };
          }),
        },
      }],
    });
    const routine = plan.routines[0];
    const segments = clipContentSegments(plan, durOf)[1];
    for (const beat of [24, 48]) {
      const time = routine.mixStartSec + beat * routine.secPerBeat;
      const segment = segments.find((s) => time >= s.mixStart && time < s.mixEnd)!;
      const actual = planStateAt(plan, time).decks.B.trackTime;
      const drawn = segment.trackStart + (time - segment.mixStart) *
        (segment.trackEnd - segment.trackStart) / (segment.mixEnd - segment.mixStart);
      expect(drawn).toBeCloseTo(actual, 6);
      const cueTime = segment.mixStart + (actual - segment.trackStart) *
        (segment.mixEnd - segment.mixStart) / (segment.trackEnd - segment.trackStart);
      expect(cueTime).toBeCloseTo(time, 6);
    }
  });

  it.each([32, 96])('clips both axes and extrapolates as needed (last sample at beat %i)', (lastBeat) => {
    const plan = planSet({
      entries: [1, 2, 3].map((trackId) => ({ trackId, pin: null })),
      tracks: { 1: facts(300), 2: facts(300), 3: facts(300) },
      transitionsByUuid: {},
      takesByUuid: {},
      routines: [{
        startEntryIndex: 0,
        routine: {
          cast: [1, 2, 3],
          entryOffsetsBeats: [0, 16, 32],
          entryPositions: [60, 8, 26],
          durationBeats: 64,
          events: [
            { kind: 'tick', beat: 0, playheads: { 0: 60, 1: 0, 2: 10 } },
            { kind: 'tick', beat: lastBeat, playheads: { 0: 60 + lastBeat / 2, 1: lastBeat / 2, 2: 10 + lastBeat / 2 } },
          ],
        },
      }],
    });
    expect(clipContentSegments(plan, durOf)[1]).toEqual([
      { mixStart: 68, mixEnd: 92, trackStart: 8, trackEnd: 32 },
    ]);
    expect(planStateAt(plan, 90).decks.B.trackTime).toBe(30);
  });

  it('a jump-free windowed entry reads as one continuous strip', () => {
    const plan = planSet(twoTracks(baseTr()));
    const segs = clipContentSegments(plan, durOf)[1];
    expect(segs).toHaveLength(1);
    expect(segs[0].trackStart).toBeCloseTo(8, 3);
    expect(segs[0].trackEnd).toBeCloseTo(plan.entries[1].exitSec, 3);
  });

  it('a backward jump splices the clip: the replayed audio draws twice', () => {
    // Jump at window midpoint: back 5s in B.
    const plan = planSet(
      twoTracks(baseTr({ jumps: [{ x: 0.5, deltaSec: -5 }] }))
    );
    const segs = clipContentSegments(plan, durOf)[1];
    expect(segs.length).toBe(2);
    // The second run restarts 5s BEHIND where the first ended — the
    // repeated section appears in both runs.
    expect(segs[1].trackStart).toBeCloseTo(segs[0].trackEnd - 5, 3);
    // Runs abut on the mix axis (no silence at a jump).
    expect(segs[1].mixStart).toBeCloseTo(segs[0].mixEnd, 6);
  });

  it('a loop-collapsed jump (count) repeats the section count times', () => {
    const plan = planSet(
      twoTracks(baseTr({ jumps: [{ x: 0.5, deltaSec: -2, count: 3 }] }))
    );
    const segs = clipContentSegments(plan, durOf)[1];
    // 3 splices → 4 runs (window) — post-window merges into the last.
    expect(segs.length).toBe(4);
    for (let k = 1; k <= 3; k++) {
      expect(segs[k].trackStart).toBeCloseTo(segs[k - 1].trackEnd - 2, 3);
    }
  });

  it('a silent lead (bInSec < 0) leaves the lead blank — no wave before 0', () => {
    const plan = planSet(twoTracks(baseTr({ bInSec: -4 })));
    const segs = clipContentSegments(plan, durOf)[1];
    expect(segs[0].trackStart).toBeCloseTo(0, 3);
    // The run starts 4s into the window on the mix axis (the lead blank).
    expect(segs[0].mixStart).toBeCloseTo(64, 1);
  });

  it('an unwindowed (hard-cut) entry keeps the plain linear strip', () => {
    const plan = planSet({
      entries: [
        { trackId: 1, pin: null },
        { trackId: 2, pin: null },
      ],
      tracks: { 1: facts(90), 2: facts(300) },
      transitionsByUuid: {},
      takesByUuid: {},
    });
    const segsA = clipContentSegments(plan, durOf)[0];
    expect(segsA).toHaveLength(1);
    expect(segsA[0].trackStart).toBeCloseTo(plan.entries[0].entrySec, 6);
    expect(segsA[0].trackEnd).toBeCloseTo(plan.entries[0].exitSec, 6);
  });
});
