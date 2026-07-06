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
  authoredPlayheadAt,
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

describe('authoredPlayheadAt (sets 38: the editor marker mapping)', () => {
  // The marker lives on the AUTHORED window axis (= the outgoing track's
  // own time, the Sketch origin invariant): inside the window, authored =
  // transition.startSec + (mix − adj.mixStartSec) · adj.rateOutgoing,
  // computed from the EXECUTED adjacency's geometry — during a deferred
  // geometry edit (the graft) the editor draws the NEW window while the
  // Conductor executes the OLD; the executed mapping is the truthful one.
  // OUTSIDE the window (review feedback on the park) the marker follows
  // the pair across the whole editor timeline: the outgoing's audible
  // span maps directly (A time = authored time), the incoming's tail maps
  // through the window's B alignment.

  it('maps a mid-window instant onto the authored axis (Riding: rate 1)', () => {
    const plan = planSet(threeTrackInput());
    // w1 spans mix 60..80 (startSec 60, duration 20, rate 1).
    expect(authoredPlayheadAt(plan, 65, 'w1')).toBeCloseTo(65, 6);
    expect(authoredPlayheadAt(plan, 79.9, 'w1')).toBeCloseTo(79.9, 6);
  });

  it('follows the executed rate under Fixed tempo (rateOutgoing ≠ 1)', () => {
    // 120 BPM tracks under Set tempo 126: rate 1.05 — the window's mix
    // span compresses; the authored axis still covers startSec..+duration.
    const plan = planSet(
      threeTrackInput({ tempo: { policy: 'fixed', setTempoBpm: 126 } })
    );
    const adj = plan.adjacencies[0];
    expect(adj.rateOutgoing).toBeCloseTo(1.05, 6);
    const midMix = (adj.mixStartSec + adj.mixEndSec) / 2;
    expect(authoredPlayheadAt(plan, midMix, 'w1')).toBeCloseTo(70, 6);
  });

  it("tracks the OUTGOING's solo before the window (A time = authored time)", () => {
    const plan = planSet(threeTrackInput());
    expect(authoredPlayheadAt(plan, 30, 'w1')).toBeCloseTo(30, 6);
    // Even while track 2 (w2's outgoing) enters as w1's incoming: the w2
    // editor already shows where its outgoing is — the lead-up.
    expect(authoredPlayheadAt(plan, 65, 'w2')).toBeCloseTo(13, 6); // τ₂ = 8 + 5
  });

  it("tracks the INCOMING's tail after the window (through the B alignment)", () => {
    const plan = planSet(threeTrackInput());
    // Window over at mix 80 (τ₂ = 28); at mix 85 τ₂ = 33 → authored =
    // 60 + (33 − 8)/1 = 85: the marker continues across the B tail.
    expect(authoredPlayheadAt(plan, 85, 'w1')).toBeCloseTo(85, 6);
  });

  it('matches Take pins by the TAKE uuid (take review shows the same idealized window)', () => {
    // Minimal raw slice (planner.test.ts's takeSource): vectorizes to
    // startSec 60 / durationSec 20 / bInSec 8 — window mix 60..80.
    const takeSource = {
      events: [
        {
          t: 100,
          kind: 'init',
          outgoingChannel: 'A',
          decks: {
            A: { trackId: 1, playing: true, fader: 1, trim: 0.5, eq: { low: 0.5, mid: 0.5, high: 0.5 }, filter: 0, pitch: 0 },
            B: { trackId: 2, playing: true, fader: 1, trim: 0.5, eq: { low: 0.5, mid: 0.5, high: 0.5 }, filter: 0, pitch: 0 },
          },
          crossfader: 0,
          crossfaderEnabled: true,
        },
        { t: 100, kind: 'tick', playheads: { A: 60, B: 8 } },
      ],
      windowStartS: 100,
      windowEndS: 120,
    } as PlanInput['takesByUuid'][string];
    const plan = planSet(
      input({
        entries: [
          { trackId: 1, pin: { kind: 'take', uuid: 'tk1' } },
          { trackId: 2, pin: null },
        ],
        tracks: { 1: facts(90, 10), 2: facts(100) },
        takesByUuid: { tk1: takeSource },
      })
    );
    expect(plan.adjacencies[0].kind).toBe('take');
    expect(authoredPlayheadAt(plan, 65, 'tk1')).toBeCloseTo(65, 6); // in-window
    expect(authoredPlayheadAt(plan, 30, 'tk1')).toBeCloseTo(30, 6); // outgoing solo
  });

  it('null when nothing of the pair sounds, for unknown pins, and for hard cuts', () => {
    const plan = planSet(threeTrackInput());
    expect(authoredPlayheadAt(plan, 30, 'w2')).toBeNull(); // track 2 not yet audible
    expect(authoredPlayheadAt(plan, 30, 'nope')).toBeNull(); // no such pin
    const hardCuts = planSet(
      input({
        entries: [
          { trackId: 1, pin: null },
          { trackId: 2, pin: null },
        ],
        tracks: { 1: facts(90), 2: facts(240) },
      })
    );
    expect(authoredPlayheadAt(hardCuts, 45, 'w1')).toBeNull();
  });

  it('keeps mapping through the EXECUTED geometry during a deferred edit, and by the preserved pin uuid', () => {
    const oldPlan = planSet(threeTrackInput());
    const sounding = soundingWindowAt(oldPlan, 65)!;
    // Mid-window geometry drag: editor draws startSec 40/duration 5, the
    // graft keeps the sounding window executing 60..80.
    const edited = threeTrackInput({
      transitionsByUuid: {
        w1: tr({ startSec: 40, durationSec: 5 }),
        w2: tr({ startSec: 120, durationSec: 10, bInSec: 0 }),
      },
    });
    const grafted = planSet(graftSoundingWindow(edited, sounding)!);
    // The graft preserves pinUuid on the lanes-live path: the marker
    // survives the edit and stays truthful to the executed window.
    expect(authoredPlayheadAt(grafted, 65, 'w1')).toBeCloseTo(65, 6);
    // Truthful to the OLD span: mix 42.5 (inside the NEW 40..45 window's
    // would-be span) is still track 1's SOLO in the executed plan — the
    // marker rides the A axis there, not the new window mapping.
    expect(authoredPlayheadAt(grafted, 42.5, 'w1')).toBeCloseTo(42.5, 6);
  });

  it('a re-pin mid-window grafts under GRAFT_PIN_UUID — the marker correctly disappears', () => {
    const oldPlan = planSet(threeTrackInput());
    const sounding = soundingWindowAt(oldPlan, 65)!;
    const repinned = threeTrackInput({
      entries: [
        { trackId: 1, pin: { kind: 'transition', uuid: 'w1b' } },
        { trackId: 2, pin: { kind: 'transition', uuid: 'w2' } },
        { trackId: 3, pin: null },
      ],
      transitionsByUuid: {
        w1b: tr({ startSec: 50, durationSec: 8 }),
        w2: tr({ startSec: 120, durationSec: 10, bInSec: 0 }),
      },
    });
    const grafted = planSet(graftSoundingWindow(repinned, sounding)!);
    // The sounding window no longer executes the loaded transition:
    // neither the old uuid nor the newly pinned one may claim the marker.
    expect(authoredPlayheadAt(grafted, 65, 'w1')).toBeNull();
    expect(authoredPlayheadAt(grafted, 65, 'w1b')).toBeNull();
  });
});
