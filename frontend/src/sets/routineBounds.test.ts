import { describe, expect, it } from 'vitest';
import { emptyEdits, parseEdits } from '../routines/routineDraft';
import { RoutineDraftStore, editsForSave } from '../routines/routineDraftStore';
import { buildEditorRoutine } from '../routines/routineEditorModel';
import { buildPlannedRoutine, routineSlotStateAt, slotLanesAt, type RoutinePlanInput } from './routinePlan';
import { planSet, planStateAt, type TempoPolicyInput } from './planner';
import { clipContentSegments } from './OverviewLadder';

function recording(): RoutinePlanInput {
  return {
    cast: [1, 2, 3], entryOffsetsBeats: [0, 16, 32], entryPositions: [60, 0, 10],
    durationBeats: 64,
    events: Array.from({ length: 17 }, (_, i) => {
      const beat = i * 4;
      return { kind: 'tick', beat, playheads: {
        0: 60 + Math.min(beat, 48) / 2,
        ...(beat >= 16 ? { 1: (Math.min(beat, 56) - 16) / 2 } : {}),
        ...(beat >= 32 ? { 2: 10 + (beat - 32) / 2 } : {}),
      } };
    }),
  };
}

const ctx = { startEntryIndex: 0, mixStartSec: 100, targetBpm: 120,
  adoptedDeck: 'A' as const, busy: [], trackBpms: [120, 120, 120] };

describe('standalone Routine playback bounds', () => {
  it('crops playback without rebasing or deleting retained edits and source material', () => {
    const input = recording();
    input.edits = { ...emptyEdits(), playbackBounds: { startBeat: 16, endBeat: 48 },
      lanes: { '2:fader': [{ beat: 0, value: 0 }, { beat: 64, value: 1 }] } };
    const saved = structuredClone(input);
    const { routine } = buildPlannedRoutine(input, ctx);
    expect(routine.mixStartSec).toBe(108);
    expect(routine.mixEndSec).toBe(124);
    expect(routine.beatOriginMixSec).toBe(100);
    expect(routine.exit.trackSecAtEnd).toBe(18);
    expect(routine.slots[2].lanes.fader).toEqual(saved.edits!.lanes['2:fader']);
    expect(input).toEqual(saved);
    input.edits.playbackBounds = { startBeat: 0, endBeat: 64 };
    const expanded = buildPlannedRoutine(input, ctx).routine;
    expect(expanded.exit.trackSecAtEnd).toBe(26);
    expect(expanded.slots[2].lanes.fader).toEqual(saved.edits!.lanes['2:fader']);
  });

  it('extends beyond the recording using its own trajectory', () => {
    const input = recording();
    input.edits = { ...emptyEdits(), playbackBounds: { startBeat: -16, endBeat: 80 } };
    input.events.push({ kind: 'control', beat: 0, slot: 0, control: 'fader', value: 0.7 });
    const { routine } = buildPlannedRoutine(input, ctx);
    expect(routine.mixEndSec - routine.mixStartSec).toBe(48);
    expect(routineSlotStateAt(routine, routine.slots[0], routine.mixStartSec + 0.5).trackTime).toBeCloseTo(52.5);
    expect(routine.exit.trackSecAtEnd).toBe(34);
    expect(slotLanesAt(routine.slots[0], -8).fader).toBe(0.7);
  });

  it('clamps bounds before any slot is excluded', () => {
    const input = recording();
    input.edits = { ...emptyEdits(), playbackBounds: { startBeat: 60, endBeat: 64 } };
    const start = buildPlannedRoutine(input, ctx).routine;
    expect(start.playbackBounds.startBeat).toBeLessThan(48);
    input.edits.playbackBounds = { startBeat: 0, endBeat: 24 };
    const end = buildPlannedRoutine(input, ctx).routine;
    expect(end.playbackBounds.endBeat).toBeGreaterThan(32);
    expect(end.slots).toHaveLength(3);
  });

  it('persists bounds with gesture undo/redo while retaining hidden edits', () => {
    const edits = { ...emptyEdits(), jumps: [{ id: 'j', slotId: '2', beat: 60, deltaSec: -4 }] };
    const store = new RoutineDraftStore();
    store.load('standalone', edits);
    store.setPlaybackBounds({ startBeat: 8, endBeat: 56 });
    store.setPlaybackBounds({ startBeat: 16, endBeat: 48 });
    store.endGesture();
    const saved = editsForSave(store.getSnapshot().edits);
    expect(parseEdits(JSON.parse(JSON.stringify(saved)))).toEqual(store.getSnapshot().edits);
    store.undo();
    expect(store.getSnapshot().edits).toEqual(edits);
    store.redo();
    expect(store.getSnapshot().edits).toEqual(saved);
    expect(parseEdits({ playbackBounds: { startBeat: 8, endBeat: 2 } }).playbackBounds).toBeUndefined();
  });

  it('keeps slot entry coordinates fixed when the crop passes them', () => {
    const input = recording();
    input.edits = { ...emptyEdits(), playbackBounds: { startBeat: 24, endBeat: 48 } };
    const r = buildPlannedRoutine(input, ctx).routine;
    expect((r.slots[1].entryMixSec - r.beatOriginMixSec) / r.secPerBeat).toBe(16);
    expect(r.slots[1].entryTrackSec).toBe(0);
  });

  it('extends the shifted head with its boundary control values', () => {
    const input = recording();
    input.events.push({ kind: 'control', beat: 0, slot: 0, control: 'fader', value: 0.7 });
    input.edits = { ...emptyEdits(), entryOffsets: { '0': -8 },
      playbackBounds: { startBeat: -16, endBeat: 80 } };
    const r = buildPlannedRoutine(input, ctx).routine;
    expect(slotLanesAt(r.slots[0], -12).fader).toBe(0.7);
  });

  it('treats explicit original bounds like absent bounds', () => {
    const input = recording();
    input.edits = { ...emptyEdits(), nudges: { '0': 2, '1': 3 } };
    const context = { ...ctx, entryAnchor: { trackSec: 60, rate: 1 } };
    const original = buildPlannedRoutine(input, context).routine;
    input.edits.playbackBounds = { startBeat: 0, endBeat: 64 };
    expect(buildPlannedRoutine(input, context).routine).toEqual(original);
  });

  it('does not count a silent lead as a slot contribution', () => {
    const input = recording();
    input.entryPositions[2] = -4;
    input.events = input.events.map(e => e.kind === 'tick' && Number(e.beat) >= 32
      ? { ...e, playheads: { ...(e.playheads as object), 2: -4 + (Number(e.beat) - 32) / 2 } } : e);
    input.edits = { ...emptyEdits(), playbackBounds: { startBeat: 0, endBeat: 36 } };
    const r = buildPlannedRoutine(input, ctx).routine;
    expect(r.playbackBounds.endBeat).toBeGreaterThan(40);
  });

  it('does not crop a slot down to only its paused interval', () => {
    const input = recording();
    input.edits = { ...emptyEdits(),
      pauses: [{ id: 'hold', slotId: '1', beat: 24, durBeats: 16 }],
      playbackBounds: { startBeat: 24, endBeat: 36 },
    };
    const r = buildPlannedRoutine(input, ctx).routine;
    expect(r.playbackBounds.endBeat).toBeGreaterThan(40);
  });

  it.each<TempoPolicyInput>([{ policy: 'riding' }, { policy: 'fixed', setTempoBpm: 132 }])(
    'editor, Set, and ladder agree on cropped playback under $policy', (tempo) => {
      const input = recording();
      input.edits = { ...emptyEdits(), playbackBounds: { startBeat: 16, endBeat: 48 } };
      const target = tempo.policy === 'fixed' ? 132 : 120;
      const editor = buildEditorRoutine({
        uuid: 'standalone', name: null, created_at: null, origin_take_uuid: null,
        cast: input.cast, entry_offsets_beats: input.entryOffsetsBeats,
        entry_positions: input.entryPositions, duration_beats: input.durationBeats,
        events: input.events,
      }, ctx.trackBpms, target, input.edits);
      const plan = planSet({
        entries: [1, 2, 3, 4].map(trackId => ({ trackId, pin: null })),
        tracks: Object.fromEntries([1, 2, 3, 4].map(id => [id, { durationSec: 300, bpm: 120, hotCue1Sec: null }])),
        transitionsByUuid: {}, takesByUuid: {}, routines: [{ startEntryIndex: 0, routine: input }], tempo,
      });
      const routine = plan.routines[0];
      expect(editor.planned.beatOriginMixSec).toBe(0);
      expect(editor.planned.mixStartSec).toBeCloseTo(16 * 60 / target);
      expect(routine.mixStartSec).toBeCloseTo(68 / (target / 120));
      const time = routine.beatOriginMixSec + 40 * routine.secPerBeat;
      const s = planStateAt(plan, time);
      const audition = routineSlotStateAt(editor.planned, editor.planned.slots[2], 40 * 60 / target);
      expect(s.decks.C.trackTime).toBeCloseTo(audition.trackTime);
      const segments = clipContentSegments(plan, () => 300)[2];
      const seg = segments.find(p => time >= p.mixStart && time < p.mixEnd)!;
      const drawn = seg.trackStart + (time - seg.mixStart) * (seg.trackEnd - seg.trackStart) / (seg.mixEnd - seg.mixStart);
      expect(drawn).toBeCloseTo(audition.trackTime);
      expect(planStateAt(plan, routine.mixEndSec + 1).decks.C.trackTime).toBeCloseTo(18 + target / 120);
    }
  );
});
