import { describe, expect, it } from 'vitest';
import { emptyEdits, parseEdits } from '../routines/routineDraft';
import { RoutineDraftStore, editsForSave } from '../routines/routineDraftStore';
import { buildPlannedRoutine, routineSlotStateAt, slotLanesAt, type RoutinePlanInput } from './routinePlan';
import { planSet, planStateAt, type TempoPolicyInput } from './planner';
import { clipContentSegments } from './OverviewLadder';

function recording(): RoutinePlanInput {
  return {
    cast: [1, 2, 3], entryOffsetsBeats: [0, 32, 64], entryPositions: [60, 24, 48],
    durationBeats: 128,
    events: [
      ...Array.from({ length: 17 }, (_, i) => {
        const beat = i * 8;
        return { kind: 'tick', beat, playheads: {
          0: 60 + Math.min(beat, 80) / 2,
          ...(beat >= 32 ? { 1: 24 + (Math.min(beat, 112) - 32) / 2 + (beat >= 80 ? 16 : 0) } : {}),
          ...(beat >= 64 ? { 2: 48 + (beat - 64) / 2 } : {}),
        } };
      }),
      { kind: 'transport', slot: 1, beat: 80, action: 'seek', playhead: 64 },
      { kind: 'control', slot: 1, beat: 32, control: 'fader', value: 0.7 },
      { kind: 'control', slot: 1, beat: 96, control: 'fader', value: 0.4 },
    ],
  };
}

const ctx = { startEntryIndex: 0, mixStartSec: 0, targetBpm: 120,
  adoptedDeck: 'A' as const, busy: [], trackBpms: [120, 120, 120] };

describe('track-start trimming', () => {
  it.each<TempoPolicyInput>([{ policy: 'riding' }, { policy: 'fixed', setTempoBpm: 132 }])(
    'Set playback and its waveform include the earlier start under $policy', (tempo) => {
      const input = recording();
      input.edits = { ...emptyEdits(), startTrims: { '1': -16 } };
      const plan = planSet({
        entries: input.cast.map(trackId => ({ trackId, pin: null })),
        tracks: Object.fromEntries(input.cast.map(id => [id, { durationSec: 300, bpm: 120, hotCue1Sec: null }])),
        transitionsByUuid: {}, takesByUuid: {}, tempo,
        routines: [{ startEntryIndex: 0, routine: input }],
      });
      const r = plan.routines[0];
      const time = r.beatOriginMixSec + 20 * r.secPerBeat;
      expect(plan.entries[1].entrySec).toBe(16);
      expect(planStateAt(plan, time).decks.B.trackTime).toBeCloseTo(18);
      const seg = clipContentSegments(plan, () => 300)[1].find(s => time >= s.mixStart && time < s.mixEnd)!;
      const drawn = seg.trackStart + (time - seg.mixStart) * (seg.trackEnd - seg.trackStart) / (seg.mixEnd - seg.mixStart);
      expect(drawn).toBeCloseTo(18);
    }
  );

  it('reveals earlier audio while keeping later positions, jumps and automation fixed', () => {
    const input = recording();
    const before = buildPlannedRoutine(input, ctx).routine;
    input.edits = { ...emptyEdits(), startTrims: { '1': -16 } };
    const saved = structuredClone(input);
    const after = buildPlannedRoutine(input, ctx).routine;
    const slot = after.slots[1];
    expect(slot.entryMixSec).toBe(8);
    expect(slot.entryTrackSec).toBe(16);
    expect(routineSlotStateAt(after, slot, 10).trackTime).toBe(18);
    expect(slotLanesAt(slot, 20).fader).toBe(0.7);
    for (const beat of [32.1, 48, 80, 96, 104]) {
      expect(routineSlotStateAt(after, slot, beat / 2)).toEqual(
        routineSlotStateAt(before, before.slots[1], beat / 2));
      expect(slotLanesAt(slot, beat)).toEqual(slotLanesAt(before.slots[1], beat));
    }
    expect(slot.jumpMixSecs).toEqual(before.slots[1].jumpMixSecs);
    expect(input).toEqual(saved);
  });

  it('shortens the intro without shifting its surviving material', () => {
    const input = recording();
    const before = buildPlannedRoutine(input, ctx).routine;
    input.edits = { ...emptyEdits(), startTrims: { '1': 16 } };
    const after = buildPlannedRoutine(input, ctx).routine;
    expect(after.slots[1].entryMixSec).toBe(24);
    expect(after.slots[1].entryTrackSec).toBe(32);
    expect(routineSlotStateAt(after, after.slots[1], 20).playing).toBe(false);
    expect(routineSlotStateAt(after, after.slots[1], 30)).toEqual(
      routineSlotStateAt(before, before.slots[1], 30));
  });

  it('executes new jumps inside the revealed intro at their authored time', () => {
    const input = recording();
    input.edits = { ...emptyEdits(), startTrims: { '1': -16 },
      jumps: [{ id: 'intro', slotId: '1', beat: 24, deltaSec: -4 }] };
    const r = buildPlannedRoutine(input, ctx).routine;
    expect(routineSlotStateAt(r, r.slots[1], 10).trackTime).toBe(18);
    expect(routineSlotStateAt(r, r.slots[1], 15).trackTime).toBe(19);
    expect(r.slots[1].jumpMixSecs).toContain(12);
  });

  it.each(['jump', 'pause'])('executes a %s in the expanded head-slot intro', (kind) => {
    const input = recording();
    input.edits = { ...emptyEdits(), playbackBounds: { startBeat: -32, endBeat: 128 },
      ...(kind === 'jump'
        ? { jumps: [{ id: 'head', slotId: '0', beat: -16, deltaSec: -4 }] }
        : { pauses: [{ id: 'head', slotId: '0', beat: -16, durBeats: 4 }] }),
    };
    const r = buildPlannedRoutine(input, ctx).routine;
    const state = (beat: number) => routineSlotStateAt(r, r.slots[0], beat / 2);
    expect(state(-24)).toMatchObject({ playing: true, trackTime: 48 });
    expect(state(-14)).toMatchObject(kind === 'jump'
      ? { playing: true, trackTime: 49 } : { playing: false, trackTime: 52 });
    expect(state(-10)).toMatchObject({ playing: true, trackTime: kind === 'jump' ? 51 : 53 });
  });

  it('keeps a retained intro pause stable when the track start moves past it or resets', () => {
    const input = recording();
    input.edits = { ...emptyEdits(), startTrims: { '1': -16 },
      pauses: [{ id: 'intro', slotId: '1', beat: 24, durBeats: 4 }] };
    const position = () => {
      const r = buildPlannedRoutine(input, ctx).routine;
      return routineSlotStateAt(r, r.slots[1], 20).trackTime;
    };
    expect(position()).toBe(26);
    input.edits.startTrims = { '1': -4 };
    expect(position()).toBe(26);
    delete input.edits.startTrims;
    expect(position()).toBe(26);
  });

  it('retains the trim when a whole-track phrase shift moves the anchor', () => {
    const input = recording();
    input.edits = { ...emptyEdits(), entryOffsets: { '1': 40 }, startTrims: { '1': -16 } };
    const r = buildPlannedRoutine(input, ctx).routine;
    expect(r.slots[1].entryMixSec).toBe(12);
    expect(r.slots[1].entryTrackSec).toBe(16);
    expect(r.slots[1].startTrim?.anchorBeat).toBe(40);
    expect(r.slots[1].jumpMixSecs).toContain(44);
  });

  it('does not resurrect the effect of a deleted pre-entry recorded jump', () => {
    const input = recording();
    input.entryPositions[1] = 40;
    input.events = input.events.filter(e => e.kind !== 'transport').map(e => e.kind === 'tick'
      ? { ...e, playheads: { ...(e.playheads as object), 1: 8 + Math.min(Number(e.beat), 112) / 2 + (Number(e.beat) >= 16 ? 16 : 0) } }
      : e);
    input.events.push({ kind: 'transport', slot: 1, beat: 16, action: 'seek', playhead: 32 });
    input.edits = { ...emptyEdits(), removedRecordedJumps: [{ slotId: '1', beat: 16 }] };
    const before = buildPlannedRoutine(input, ctx).routine;
    expect(routineSlotStateAt(before, before.slots[1], 17).trackTime).toBe(25);
    input.edits.startTrims = { '1': -16 };
    const after = buildPlannedRoutine(input, ctx).routine;
    for (const time of [17, 24, 48]) {
      expect(routineSlotStateAt(after, after.slots[1], time)).toEqual(
        routineSlotStateAt(before, before.slots[1], time));
    }
  });

  it('clamps before a neighboring entry or the first discontinuity', () => {
    const input = recording();
    input.edits = { ...emptyEdits(), startTrims: { '1': -1000 } };
    const early = buildPlannedRoutine(input, ctx).routine;
    expect(early.slots[1].entryMixSec).toBeGreaterThan(early.slots[0].entryMixSec);
    input.edits.startTrims = { '1': 1000 };
    const late = buildPlannedRoutine(input, ctx).routine;
    expect(late.slots[1].entryMixSec).toBeLessThan(late.slots[2].entryMixSec);
  });

  it('round-trips and undoes one drag without modifying jumps', () => {
    const store = new RoutineDraftStore();
    store.load('routine', emptyEdits());
    store.setStartTrim('1', -8);
    store.setStartTrim('1', -16);
    store.endGesture();
    const saved = editsForSave(store.getSnapshot().edits);
    expect(parseEdits(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
    store.undo();
    expect(store.getSnapshot().edits.startTrims).toBeUndefined();
    store.redo();
    expect(store.getSnapshot().edits.startTrims).toEqual({ '1': -16 });
    expect(store.getSnapshot().edits.jumps).toEqual([]);
  });
});
