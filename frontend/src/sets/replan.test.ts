/**
 * Live re-plan (sets 24) — pure remap + sounding-window graft, tested at
 * the planner seam (pickup.test.ts style).
 *
 * The invariant under test is Pickup's, inherited: a re-plan decision's
 * mixTime, evaluated through planStateAt on the (maybe flipped) new
 * plan, puts the anchor deck exactly at the track-time it already plays
 * — never audibly destructive by construction. The graft invariant: a
 * geometry edit to the sounding window changes NOTHING about that
 * window in the grafted plan (it completes as it was) while lane values
 * and all downstream geometry come from the new input.
 */
import { describe, expect, it } from 'vitest';
import type { Transition } from '../editor/mixModel';
import { flipPlanDecks } from './pickup';
import {
  planSet,
  planStateAt,
  type PlanInput,
  type SetPlan,
} from './planner';
import {
  evaluateReplan,
  graftSoundingWindow,
  GRAFT_PIN_UUID,
  soundingWindowAt,
  type ReplanDecision,
} from './replan';

const facts = (durationSec: number, hotCue1Sec: number | null = null, bpm: number | null = 120) => ({
  durationSec,
  bpm,
  hotCue1Sec,
});

const tr = (over: Partial<Transition> = {}): Transition => ({
  startSec: 60,
  durationSec: 20,
  bInSec: 8,
  tempoMatch: false,
  lanes: {},
  ...over,
});

function input(over: Partial<PlanInput> = {}): PlanInput {
  return { entries: [], tracks: {}, transitionsByUuid: {}, takesByUuid: {}, ...over };
}

/** Three tracks, windows pinned on both adjacencies (w1: mix 60..80,
 * w2 inside track 2). Track 2 enters at its own t=8. */
function threeTrackInput(over: Partial<PlanInput> = {}): PlanInput {
  return input({
    entries: [
      { trackId: 1, pin: { kind: 'transition', uuid: 'w1' } },
      { trackId: 2, pin: { kind: 'transition', uuid: 'w2' } },
      { trackId: 3, pin: null },
    ],
    tracks: { 1: facts(90), 2: facts(240), 3: facts(240) },
    transitionsByUuid: { w1: tr(), w2: tr({ startSec: 120, durationSec: 10, bInSec: 0 }) },
    ...over,
  });
}

function ok(d: ReplanDecision): Extract<ReplanDecision, { ok: true }> {
  expect(d).toMatchObject({ ok: true });
  return d as Extract<ReplanDecision, { ok: true }>;
}

function notOk(d: ReplanDecision): Extract<ReplanDecision, { ok: false }> {
  expect(d.ok).toBe(false);
  return d as Extract<ReplanDecision, { ok: false }>;
}

/** Round-trip: at the decision's instant the (maybe flipped) new plan
 * plays the same track at the same track-time on the anchor's deck. */
function expectAnchorPreserved(oldPlan: SetPlan, t: number, newPlan: SetPlan): void {
  const before = planStateAt(oldPlan, t);
  const d = ok(evaluateReplan(oldPlan, t, newPlan));
  const exec = d.flip ? flipPlanDecks(newPlan) : newPlan;
  const after = planStateAt(exec, d.mixTime);
  expect(after.decks[d.anchor].trackId).toBe(before.decks[d.anchor].trackId);
  expect(after.decks[d.anchor].trackTime).toBeCloseTo(before.decks[d.anchor].trackTime, 3);
}

describe('remap (an automatic Pickup into the new plan)', () => {
  it('identity re-plan maps to the same instant, no flip', () => {
    const plan = planSet(threeTrackInput());
    const d = ok(evaluateReplan(plan, 30, plan));
    expect(d.mixTime).toBeCloseTo(30, 6);
    expect(d.flip).toBe(false);
    expect(d.anchor).toBe('A');
  });

  it('a downstream transition edit keeps the solo anchor and adopts the new geometry downstream', () => {
    const oldPlan = planSet(threeTrackInput());
    // The 2→3 handover moves earlier (track 2's own t=100, 30s long).
    const edited = threeTrackInput({
      transitionsByUuid: { w1: tr(), w2: tr({ startSec: 100, durationSec: 30, bInSec: 0 }) },
    });
    const newPlan = planSet(edited);
    expectAnchorPreserved(oldPlan, 30, newPlan);
    // Downstream geometry is the edited one: the new window spans 30
    // authored seconds of track 2 starting at its own t=100.
    const w2 = newPlan.adjacencies[1];
    expect(w2.kind).toBe('transition');
    expect(w2.transition!.startSec).toBe(100);
    expect(w2.mixEndSec - w2.mixStartSec).toBeCloseTo(30, 6);
  });

  it('mid-window the audibly dominant deck anchors (explicit crossfade lanes)', () => {
    // Full crossfade over the window: A dominant early, B late.
    const lanes = {
      faderA: [
        { x: 0, y: 1 },
        { x: 1, y: 0 },
      ],
      faderB: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
    };
    const in1 = threeTrackInput({
      transitionsByUuid: { w1: tr({ lanes }), w2: tr({ startSec: 120, durationSec: 10, bInSec: 0 }) },
    });
    const plan = planSet(in1);
    // Window on the mix axis 60..80.
    expect(ok(evaluateReplan(plan, 62, plan)).anchor).toBe('A');
    expect(ok(evaluateReplan(plan, 78, plan)).anchor).toBe('B');
    expectAnchorPreserved(plan, 78, plan);
  });

  it('a reorder that keeps the anchor track remaps into its new slot, flipping parity when it moved', () => {
    const oldPlan = planSet(threeTrackInput());
    // Playhead solo inside track 2 (deck B), past the tempo... plain solo.
    const t = 100; // between w1 end (80) and w2 start
    // Reorder: [2, 3, 1] — track 2 now entry 0 → deck A → flip.
    const reordered = input({
      entries: [
        { trackId: 2, pin: null },
        { trackId: 3, pin: null },
        { trackId: 1, pin: null },
      ],
      tracks: { 1: facts(90), 2: facts(240), 3: facts(240) },
    });
    const newPlan = planSet(reordered);
    const d = ok(evaluateReplan(oldPlan, t, newPlan));
    expect(d.anchor).toBe('B');
    expect(d.flip).toBe(true);
    expectAnchorPreserved(oldPlan, t, newPlan);
  });

  it('the anchor track leaving the Set is anchor-gone', () => {
    const oldPlan = planSet(threeTrackInput());
    const without2 = input({
      entries: [
        { trackId: 1, pin: null },
        { trackId: 3, pin: null },
      ],
      tracks: { 1: facts(90), 3: facts(240) },
    });
    const d = notOk(evaluateReplan(oldPlan, 100, planSet(without2)));
    expect(d.reason).toBe('anchor-gone');
    expect(d.anchorTrackId).toBe(2);
  });

  it('an empty new plan refuses', () => {
    const oldPlan = planSet(threeTrackInput());
    expect(notOk(evaluateReplan(oldPlan, 30, planSet(input()))).reason).toBe('empty-plan');
  });

  it('a tempo change keeps the anchor track-time (pitch converges at the runtime, not here)', () => {
    const in1 = threeTrackInput();
    const oldPlan = planSet(in1);
    const newPlan = planSet({ ...in1, tempo: { policy: 'fixed', setTempoBpm: 126 } });
    expectAnchorPreserved(oldPlan, 30, newPlan);
  });

  it('dragging the next window start across the playhead maps exactly: the handover is due now', () => {
    const in1 = threeTrackInput();
    const oldPlan = planSet(in1);
    const t = 100; // track 2 solo, at its own track-time τ=48…
    const tau = planStateAt(oldPlan, t).decks.B.trackTime;
    // …then w2 moves so its window (44..54 in track 2's time) covers τ:
    // the anchor is now mid-window as the OUTGOING — its window regime
    // is its solo mapping, so the moment still exists exactly.
    const edited = threeTrackInput({
      transitionsByUuid: { w1: tr(), w2: tr({ startSec: 44, durationSec: 10, bInSec: 0 }) },
    });
    const newPlan = planSet(edited);
    expect(tau).toBeGreaterThan(44);
    expectAnchorPreserved(oldPlan, t, newPlan);
  });

  it('a window dragged WHOLLY across the playhead is unmappable — never a backwards seek of the sounding anchor', () => {
    const in1 = threeTrackInput();
    const oldPlan = planSet(in1);
    const t = 100; // τ = 48, audible
    // The whole 2→3 window now ends before τ: track 2 exits at 45 — the
    // anchor's current moment does not exist in the new plan. Mapping it
    // anywhere would jump the sounding deck; the decision refuses.
    const edited = threeTrackInput({
      transitionsByUuid: { w1: tr(), w2: tr({ startSec: 40, durationSec: 5, bInSec: 0 }) },
    });
    const d = notOk(evaluateReplan(oldPlan, t, planSet(edited)));
    expect(d.reason).toBe('unmappable');
    expect(d.anchorTrackId).toBe(2);
  });
});

describe('the sounding-window graft (geometry deferred, lanes live)', () => {
  it('outside any window there is nothing sounding to defer', () => {
    const plan = planSet(threeTrackInput());
    expect(soundingWindowAt(plan, 30)).toBeNull(); // solo
    expect(soundingWindowAt(plan, 85)).toBeNull(); // past w1's end
  });

  it('a geometry edit to the sounding window is deferred; its lane values ride live', () => {
    const in1 = threeTrackInput();
    const oldPlan = planSet(in1);
    const sounding = soundingWindowAt(oldPlan, 65)!; // inside w1 (60..80)
    expect(sounding).not.toBeNull();
    expect(sounding.pinUuid).toBe('w1');

    const newLanes = { faderA: [{ x: 0, y: 0.25 }] };
    const edited = threeTrackInput({
      transitionsByUuid: {
        w1: tr({ startSec: 40, durationSec: 5, bInSec: 2, lanes: newLanes }),
        w2: tr({ startSec: 100, durationSec: 30, bInSec: 0 }),
      },
    });
    const grafted = graftSoundingWindow(edited, sounding)!;
    expect(grafted).not.toBeNull();
    const plan = planSet(grafted);
    // The sounding window's geometry is the OLD one…
    const w1 = plan.adjacencies[0];
    expect(w1.transition!.startSec).toBe(60);
    expect(w1.transition!.durationSec).toBe(20);
    expect(w1.transition!.bInSec).toBe(8);
    expect(w1.mixStartSec).toBeCloseTo(60, 6);
    expect(w1.mixEndSec).toBeCloseTo(80, 6);
    // …its lane values are the NEW ones…
    expect(w1.transition!.lanes).toEqual(newLanes);
    // …and the DOWNSTREAM window's geometry applies immediately.
    expect(plan.adjacencies[1].transition!.startSec).toBe(100);
    expect(plan.adjacencies[1].transition!.durationSec).toBe(30);
  });

  it('a values-only edit needs no graft (geometry unchanged)', () => {
    const in1 = threeTrackInput();
    const oldPlan = planSet(in1);
    const sounding = soundingWindowAt(oldPlan, 65)!;
    const edited = threeTrackInput({
      transitionsByUuid: {
        w1: tr({ lanes: { faderB: [{ x: 0, y: 0.5 }] } }),
        w2: tr({ startSec: 120, durationSec: 10, bInSec: 0 }),
      },
    });
    expect(graftSoundingWindow(edited, sounding)).toBeNull();
  });

  it('a re-pin mid-window freezes the sounding window whole until it completes', () => {
    const in1 = threeTrackInput();
    const oldPlan = planSet(in1);
    const sounding = soundingWindowAt(oldPlan, 65)!;
    const repinned = threeTrackInput({
      entries: [
        { trackId: 1, pin: { kind: 'transition', uuid: 'other' } },
        { trackId: 2, pin: { kind: 'transition', uuid: 'w2' } },
        { trackId: 3, pin: null },
      ],
      transitionsByUuid: {
        other: tr({ startSec: 30, durationSec: 5, lanes: { faderA: [{ x: 0, y: 0 }] } }),
        w2: tr({ startSec: 120, durationSec: 10, bInSec: 0 }),
      },
    });
    const grafted = graftSoundingWindow(repinned, sounding)!;
    expect(grafted).not.toBeNull();
    expect(grafted.entries[0].pin).toEqual({ kind: 'transition', uuid: GRAFT_PIN_UUID });
    const plan = planSet(grafted);
    // Exactly as it was: old geometry AND old lanes.
    expect(plan.adjacencies[0].transition).toEqual(sounding.transition);
    expect(plan.adjacencies[0].pinUuid).toBe(GRAFT_PIN_UUID);
  });

  it('a reorder that breaks the sounding pair grafts nothing (the window collapses at the playhead)', () => {
    const in1 = threeTrackInput();
    const oldPlan = planSet(in1);
    const sounding = soundingWindowAt(oldPlan, 65)!;
    const reordered = input({
      entries: [
        { trackId: 1, pin: null },
        { trackId: 3, pin: null },
        { trackId: 2, pin: null },
      ],
      tracks: { 1: facts(90), 2: facts(240), 3: facts(240) },
    });
    expect(graftSoundingWindow(reordered, sounding)).toBeNull();
  });

  it('the grafted geometry propagates across successive re-plans (the exec plan carries it)', () => {
    const in1 = threeTrackInput();
    const oldPlan = planSet(in1);
    const sounding = soundingWindowAt(oldPlan, 65)!;
    const edit1 = threeTrackInput({
      transitionsByUuid: {
        w1: tr({ startSec: 40, durationSec: 5, lanes: { faderA: [{ x: 0, y: 0.5 }] } }),
        w2: tr({ startSec: 120, durationSec: 10, bInSec: 0 }),
      },
    });
    const plan1 = planSet(graftSoundingWindow(edit1, sounding)!);
    // Second edit while still mid-window: the sounding window read from
    // plan1 carries the ORIGINAL geometry (and the same pin uuid), so
    // lanes keep riding live against it.
    const sounding2 = soundingWindowAt(plan1, 65)!;
    expect(sounding2.pinUuid).toBe('w1');
    expect(sounding2.transition.startSec).toBe(60);
    const edit2 = threeTrackInput({
      transitionsByUuid: {
        w1: tr({ startSec: 40, durationSec: 5, lanes: { faderA: [{ x: 0, y: 0.1 }] } }),
        w2: tr({ startSec: 120, durationSec: 10, bInSec: 0 }),
      },
    });
    const plan2 = planSet(graftSoundingWindow(edit2, sounding2)!);
    expect(plan2.adjacencies[0].transition!.startSec).toBe(60);
    expect(plan2.adjacencies[0].transition!.lanes).toEqual({ faderA: [{ x: 0, y: 0.1 }] });
  });
});
