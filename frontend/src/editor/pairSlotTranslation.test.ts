/**
 * Pair↔slot translation (ADR 0037, PRD phase 1). The two invariants:
 *
 * 1. LOSSLESS round-trip — projecting a Transition onto the slot surface
 *    and saving WITHOUT edits yields a byte-identical artifact (no
 *    seconds↔beats quantization drift on an unedited window).
 * 2. GRIDLESS degrade — a pair whose outgoing has no BPM still projects
 *    (a degraded 1-beat/sec clock), never locked out.
 *
 * Plus the exit test: open, audition (project + build a playable routine),
 * save without edits → byte-identical; edit one lane point → only that
 * field re-derived.
 */
import { describe, expect, it } from 'vitest';
import {
  cameoToProjection,
  changedPairEdits,
  editsToTransition,
  incomingRate,
  NEW_PAIR_SEED_BEATS,
  pairFilterToRoutine,
  pairToEdits,
  routineFilterToPair,
  seedNewTransition,
  transitionToProjection,
  type PairCameoInput,
  type PairSlotInput,
} from './pairSlotTranslation';
import { emptyEdits, laneKey } from '../routines/routineDraft';
import { buildEditorRoutine } from '../routines/routineEditorModel';
import type { Transition } from './mixModel';

function baseInput(overrides: Partial<Transition> = {}): PairSlotInput {
  return {
    uuid: 'pair-uuid-1',
    name: 'Track A → Track B',
    trackAId: 10,
    trackBId: 20,
    bpmA: 128,
    bpmB: 128,
    transition: {
      startSec: 30,
      durationSec: 20,
      bInSec: 0,
      tempoMatch: true,
      lanes: {},
      ...overrides,
    },
  };
}

function saveWithoutEdits(input: PairSlotInput): Transition {
  const proj = transitionToProjection(input);
  return editsToTransition(emptyEdits(), {
    original: input.transition,
    durationBeats: proj.detail.duration_beats,
    secPerBeat: proj.secPerBeat,
  });
}

describe('pairSlotTranslation — projection geometry', () => {
  it('slot 0 = outgoing at window start; slot 1 entry position = bInSec', () => {
    const input = baseInput({ startSec: 30, bInSec: -4, durationSec: 20 });
    const proj = transitionToProjection(input);
    expect(proj.detail.cast).toEqual([10, 20]);
    expect(proj.detail.entry_offsets_beats).toEqual([0, 0]);
    expect(proj.detail.entry_positions).toEqual([30, -4]); // A@startSec, B@bInSec
  });

  it('durationBeats scales by the outgoing tempo (targetBpm = bpmA)', () => {
    // 128 bpm → 0.46875 s/beat; 20 s ÷ that = 42.666… beats.
    const proj = transitionToProjection(baseInput({ durationSec: 20 }));
    expect(proj.secPerBeat).toBeCloseTo(60 / 128, 10);
    expect(proj.detail.duration_beats).toBeCloseTo(20 / (60 / 128), 8);
    expect(proj.targetBpm).toBe(128);
    expect(proj.degraded).toBe(false);
  });

  it('unedited pair yields empty edits and a bare synthetic recording', () => {
    const proj = transitionToProjection(baseInput());
    expect(proj.edits).toEqual(emptyEdits());
    // Only tick events (window start + end), no control events.
    expect(proj.detail.events.every((e) => e.kind === 'tick')).toBe(true);
    expect(proj.detail.events).toHaveLength(2);
  });

  it('the synthetic routine builds into a playable 2-slot plan', () => {
    const proj = transitionToProjection(baseInput());
    const editor = buildEditorRoutine(proj.detail, proj.trackBpms, proj.targetBpm, proj.edits);
    expect(editor.planned.slots).toHaveLength(2);
    expect(editor.planned.slots[0].deck).toBe('A');
    expect(editor.planned.slots[1].deck).toBe('B');
    // Both slots move across the window (moving traces).
    expect(editor.planned.slots[0].trace.some((p) => p.moving)).toBe(true);
    expect(editor.planned.slots[1].trace.some((p) => p.moving)).toBe(true);
  });
});

describe('pairSlotTranslation — incoming rate (tempo match)', () => {
  it('tempo-match on with equal BPM → rate 1', () => {
    expect(incomingRate(baseInput().transition, 128, 128)).toBe(1);
  });
  it('tempo-match on, octave-folded ratio (174 vs 87)', () => {
    // 87 vs 174: raw 0.5, folded to 1 (the DJ rides at native).
    expect(incomingRate(baseInput().transition, 87, 174)).toBeCloseTo(1, 10);
  });
  it('tempo-match off → rate 1 regardless of BPM', () => {
    expect(incomingRate(baseInput({ tempoMatch: false }).transition, 128, 100)).toBe(1);
  });
});

describe('pairSlotTranslation — filter value-space', () => {
  it('pair 0.5 (off) ↔ routine 0 (off)', () => {
    expect(pairFilterToRoutine(0.5)).toBe(0);
    expect(routineFilterToPair(0)).toBe(0.5);
  });
  it('round-trips the endpoints', () => {
    for (const y of [0, 0.25, 0.5, 0.75, 1]) {
      expect(routineFilterToPair(pairFilterToRoutine(y))).toBeCloseTo(y, 10);
    }
  });
});

describe('pairSlotTranslation — LOSSLESS round-trip (exit test)', () => {
  it('save without edits is byte-identical to the original — clean window', () => {
    const input = baseInput();
    expect(saveWithoutEdits(input)).toEqual(input.transition);
  });

  it('byte-identical across odd geometry (negative lead, non-integer beats)', () => {
    const input = baseInput({ startSec: 12.34, durationSec: 17.9, bInSec: -3.7 });
    expect(saveWithoutEdits(input)).toEqual(input.transition);
  });

  it('untouched drawn lanes and jumps pass through verbatim on a no-edit save', () => {
    const input = baseInput({
      lanes: {
        faderB: [
          { x: 0, y: 0 },
          { x: 0.5, y: 1 },
        ],
        eqLowA: [{ x: 0.2, y: 0.3 }],
      },
      jumps: [{ x: 0.4, deltaSec: -2, count: 3 }],
      jumpsA: [{ x: 0.1, deltaSec: 1 }],
      hiddenLanes: ['filterA'],
    });
    // A no-edit save must reproduce the whole artifact, including fields
    // the projection turned into edits (they weren't RE-edited).
    expect(saveWithoutEdits(input)).toEqual(input.transition);
  });

  it('gridless pair (no bpmA) round-trips byte-identically too', () => {
    const input = { ...baseInput(), bpmA: null, bpmB: null };
    const proj = transitionToProjection(input);
    expect(proj.degraded).toBe(true);
    expect(saveWithoutEdits(input)).toEqual(input.transition);
  });
});

describe('pairSlotTranslation — single-field re-derivation', () => {
  it('editing one lane point re-derives ONLY that lane; every other field untouched', () => {
    const input = baseInput({
      lanes: { faderA: [{ x: 0, y: 1 }] },
      bInSec: -2,
    });
    const proj = transitionToProjection(input);
    const durationBeats = proj.detail.duration_beats;

    // Author a faderB envelope (a single-lane edit).
    const edits = emptyEdits();
    edits.lanes[laneKey(1, 'fader')] = [
      { beat: 0, value: 0 },
      { beat: durationBeats, value: 1 },
    ];

    const saved = editsToTransition(edits, {
      original: input.transition,
      durationBeats,
      secPerBeat: proj.secPerBeat,
    });

    // faderB re-derived from the edit (beats → x).
    expect(saved.lanes.faderB).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ]);
    // Everything else identical to the original.
    expect(saved.lanes.faderA).toEqual(input.transition.lanes.faderA);
    expect(saved.startSec).toBe(30);
    expect(saved.durationSec).toBe(20);
    expect(saved.bInSec).toBe(-2);
    expect(saved.tempoMatch).toBe(true);
  });

  it('a filter lane edit maps back through the value-space (0 → 0.5)', () => {
    const input = baseInput();
    const proj = transitionToProjection(input);
    const edits = emptyEdits();
    edits.lanes[laneKey(0, 'filter')] = [{ beat: 0, value: 0 }];
    const saved = editsToTransition(edits, {
      original: input.transition,
      durationBeats: proj.detail.duration_beats,
      secPerBeat: proj.secPerBeat,
    });
    expect(saved.lanes.filterA).toEqual([{ x: 0, y: 0.5 }]);
  });

  it('an incoming nudge slides bInSec (rigid track-seconds slide); outgoing nudge slides startSec', () => {
    const input = baseInput({ bInSec: 4, startSec: 30 });
    const proj = transitionToProjection(input);
    const ctx = {
      original: input.transition,
      durationBeats: proj.detail.duration_beats,
      secPerBeat: proj.secPerBeat,
    };
    const nudgedB = editsToTransition({ ...emptyEdits(), nudges: { '1': -1.5 } }, ctx);
    expect(nudgedB.bInSec).toBe(2.5);
    expect(nudgedB.startSec).toBe(30);

    const nudgedA = editsToTransition({ ...emptyEdits(), nudges: { '0': 5 } }, ctx);
    expect(nudgedA.startSec).toBe(35);
    expect(nudgedA.bInSec).toBe(4);
  });

  it('an authored jump re-derives to the right role (slot 0 → jumpsA, slot 1 → jumps)', () => {
    const input = baseInput();
    const proj = transitionToProjection(input);
    const durationBeats = proj.detail.duration_beats;
    const edits = emptyEdits();
    edits.jumps = [
      { id: 'a', slot: 0, beat: durationBeats * 0.25, deltaSec: 1 },
      { id: 'b', slot: 1, beat: durationBeats * 0.5, deltaSec: -2, repeat: 3 },
    ];
    const saved = editsToTransition(edits, {
      original: input.transition,
      durationBeats,
      secPerBeat: proj.secPerBeat,
    });
    expect(saved.jumpsA).toEqual([{ x: 0.25, deltaSec: 1 }]);
    expect(saved.jumps).toEqual([{ x: 0.5, deltaSec: -2, count: 3 }]);
  });
});

describe('pairSlotTranslation — pairToEdits (projection of drawn fields)', () => {
  it('drawn pair lanes become authored envelopes on the beat clock', () => {
    const durationBeats = 40;
    const edits = pairToEdits(
      {
        startSec: 0,
        durationSec: 20,
        bInSec: 0,
        tempoMatch: true,
        lanes: {
          faderB: [
            { x: 0, y: 0 },
            { x: 0.5, y: 1 },
          ],
        },
      },
      durationBeats
    );
    expect(edits.lanes[laneKey(1, 'fader')]).toEqual([
      { beat: 0, value: 0 },
      { beat: 20, value: 1 },
    ]);
  });

  it('hidden lanes are not projected (they read default at playback)', () => {
    const edits = pairToEdits(
      {
        startSec: 0,
        durationSec: 20,
        bInSec: 0,
        tempoMatch: true,
        lanes: { filterA: [{ x: 0, y: 1 }] },
        hiddenLanes: ['filterA'],
      },
      40
    );
    expect(Object.keys(edits.lanes)).toHaveLength(0);
  });

  it('a full projection→save round-trip preserves drawn lanes exactly', () => {
    const input = baseInput({
      lanes: {
        faderB: [
          { x: 0, y: 0 },
          { x: 0.1, y: 1 },
        ],
        filterA: [{ x: 0.3, y: 0.5 }],
      },
    });
    const proj = transitionToProjection(input);
    // Feed the projection's own edits straight back — a save of exactly
    // what was projected must reproduce the lanes.
    const saved = editsToTransition(proj.edits, {
      original: input.transition,
      durationBeats: proj.detail.duration_beats,
      secPerBeat: proj.secPerBeat,
    });
    expect(saved.lanes.faderB).toEqual(input.transition.lanes.faderB);
    expect(saved.lanes.filterA).toEqual(input.transition.lanes.filterA);
  });
});

describe('pairSlotTranslation — changedPairEdits (the live-draft diff, #205)', () => {
  // The editor's draft holds the WHOLE projection after load (cloned, so
  // deep equality is the contract). Only genuinely edited fields may
  // reach editsToTransition.
  const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

  it('an untouched draft diffs to nothing — even though every drawn lane is present', () => {
    const input = baseInput({
      lanes: { faderB: [{ x: 0, y: 0 }, { x: 0.5, y: 1 }] },
      jumps: [{ x: 0.4, deltaSec: -2 }],
    });
    const proj = transitionToProjection(input);
    const diff = changedPairEdits(clone(proj.edits), proj.edits);
    expect(Object.keys(diff.lanes)).toHaveLength(0);
    expect(diff.jumps).toHaveLength(0);
    // …so the save is byte-identical.
    const saved = editsToTransition(diff, {
      original: input.transition,
      durationBeats: proj.detail.duration_beats,
      secPerBeat: proj.secPerBeat,
    });
    expect(saved).toEqual(input.transition);
    expect(JSON.stringify(saved)).toBe(JSON.stringify(input.transition));
  });

  it('editing one lane leaves the other lanes and jumps out of the diff', () => {
    const input = baseInput({
      lanes: {
        faderA: [{ x: 0, y: 1 }],
        faderB: [{ x: 0, y: 0 }, { x: 0.5, y: 1 }],
      },
      jumps: [{ x: 0.4, deltaSec: -2 }],
    });
    const proj = transitionToProjection(input);
    const draft = clone(proj.edits);
    draft.lanes[laneKey(1, 'fader')] = [
      { beat: 0, value: 0 },
      { beat: 4, value: 0.8 },
    ];
    const diff = changedPairEdits(draft, proj.edits);
    expect(Object.keys(diff.lanes)).toEqual([laneKey(1, 'fader')]);
    expect(diff.jumps).toHaveLength(0);
    // Untouched faderA and the incoming jump pass through VERBATIM.
    const saved = editsToTransition(diff, {
      original: input.transition,
      durationBeats: proj.detail.duration_beats,
      secPerBeat: proj.secPerBeat,
    });
    expect(saved.lanes.faderA).toEqual(input.transition.lanes.faderA);
    expect(saved.jumps).toEqual(input.transition.jumps);
    expect(saved.lanes.faderB).toEqual([
      { x: 0, y: 0 },
      { x: 4 / proj.detail.duration_beats, y: 0.8 },
    ]);
  });

  it('an incoming-jump edit does not re-derive untouched outgoing jumps (per-role diff)', () => {
    const input = baseInput({
      jumps: [{ x: 0.4, deltaSec: -2 }],
      jumpsA: [{ x: 0.1, deltaSec: 1 }],
    });
    const proj = transitionToProjection(input);
    const draft = clone(proj.edits);
    const j1 = draft.jumps.find((j) => j.slot === 1)!;
    j1.deltaSec = -4; // edit the incoming's jump
    const diff = changedPairEdits(draft, proj.edits);
    expect(diff.jumps.every((j) => j.slot === 1)).toBe(true);
    const saved = editsToTransition(diff, {
      original: input.transition,
      durationBeats: proj.detail.duration_beats,
      secPerBeat: proj.secPerBeat,
    });
    expect(saved.jumpsA).toEqual(input.transition.jumpsA); // verbatim
    expect(saved.jumps![0].deltaSec).toBe(-4);
  });

  it('nudges/trims diff against absent-as-default', () => {
    const proj = transitionToProjection(baseInput());
    const draft = clone(proj.edits);
    draft.nudges['1'] = -1.5;
    draft.trims['0'] = 0.5; // nominal — not a change
    const diff = changedPairEdits(draft, proj.edits);
    expect(diff.nudges).toEqual({ '1': -1.5 });
    expect(diff.trims).toEqual({});
  });
});

describe('pairSlotTranslation — seedNewTransition (#205 pair synthesis)', () => {
  it('seeds the window at the outgoing outro, 32 beats on its clock', () => {
    const seeded = seedNewTransition(300, 120); // 0.5 s/beat → 16 s window
    expect(seeded.durationSec).toBe(NEW_PAIR_SEED_BEATS * 0.5);
    expect(seeded.startSec).toBe(300 - 16);
    expect(seeded.bInSec).toBe(0);
    expect(seeded.tempoMatch).toBe(true);
    expect(seeded.lanes).toEqual({});
  });
  it('gridless outgoing seeds on the degraded clock; short tracks clamp to 0', () => {
    const seeded = seedNewTransition(20, null); // 1 s/beat → 32 s window
    expect(seeded.durationSec).toBe(32);
    expect(seeded.startSec).toBe(0);
  });
});

describe('pairSlotTranslation — Cameo host/guest 2-slot parity', () => {
  function cameoInput(overrides: Partial<PairCameoInput['source']> = {}): PairCameoInput {
    return {
      uuid: 'cameo-1',
      name: 'Host ⟡ Guest',
      hostTrackId: 100,
      guestTrackId: 200,
      bpmHost: 128,
      bpmGuest: 128,
      source: {
        entryHostSec: 60,
        exitHostSec: 68,
        guestStartSec: 12,
        fadeInSec: 0.5,
        fadeOutSec: 1,
        pitchPercent: 0,
        ...overrides,
      },
    };
  }

  it('projects host = slot 0 (plays through), guest = slot 1 (enters mid-window)', () => {
    const proj = cameoToProjection(cameoInput());
    expect(proj.detail.cast).toEqual([100, 200]);
    // Host enters at window start; guest enters after the lead-in.
    expect(proj.detail.entry_offsets_beats[0]).toBe(0);
    expect(proj.detail.entry_offsets_beats[1]).toBeGreaterThan(0);
    // Guest entry position = its start seconds.
    expect(proj.detail.entry_positions[1]).toBe(12);
  });

  it('the guest fader envelope fades in at entry and out by exit; host has none', () => {
    const proj = cameoToProjection(cameoInput());
    const guestFader = proj.edits.lanes[laneKey(1, 'fader')];
    expect(guestFader).toBeDefined();
    // Closed before entry, open at peak, closed by exit.
    expect(guestFader[0].value).toBe(0);
    expect(guestFader[guestFader.length - 1].value).toBe(0);
    expect(guestFader.some((p) => p.value === 1)).toBe(true);
    // Host (slot 0) rides its default open fader — no authored lane.
    expect(proj.edits.lanes[laneKey(0, 'fader')]).toBeUndefined();
  });

  it('builds a playable 2-slot routine where the host stays current', () => {
    const proj = cameoToProjection(cameoInput());
    const editor = buildEditorRoutine(proj.detail, proj.trackBpms, proj.targetBpm, proj.edits);
    expect(editor.planned.slots).toHaveLength(2);
    expect(editor.planned.slots[0].deck).toBe('A'); // host
    expect(editor.planned.slots[1].deck).toBe('B'); // guest
    // The host is the exit slot's sibling but stays current: exit is the
    // last cast slot (guest) by the routine boundary contract, yet the
    // host plays the whole window (slot 0 trace moves throughout).
    expect(editor.planned.slots[0].trace.some((p) => p.moving)).toBe(true);
  });

  it('gridless host still projects (degraded), never locked out', () => {
    const proj = cameoToProjection({ ...cameoInput(), bpmHost: null, bpmGuest: null });
    expect(proj.degraded).toBe(true);
    expect(proj.detail.cast).toEqual([100, 200]);
    expect(proj.detail.duration_beats).toBeGreaterThan(0);
  });
});
