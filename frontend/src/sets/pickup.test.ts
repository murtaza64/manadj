/**
 * Pickup (sets 16) — pure predicate + mapping, planner.test.ts style.
 *
 * The five predicate cases from the issue: lit for one-audible-deck-in-
 * span and for two-deck-aligned-blend; unlit with a teaching reason for
 * not-in-set, outside-span ("silent in the set"), and non-adjacent /
 * misaligned. Mapping is verified by ROUND-TRIP: a lit decision's
 * mixTime, evaluated through planStateAt, puts the anchor deck exactly
 * where its playhead already is (never audibly destructive by
 * construction).
 */
import { describe, expect, it } from 'vitest';
import type { Transition } from '../editor/mixModel';
import type { ChannelId } from '../playback/mixer';
import {
  evaluatePickup,
  flipPlanDecks,
  mixTimeForTrackTime,
  pickupStartLanes,
  type PickupDecision,
  type PickupSnapshot,
} from './pickup';
import { planSet, planStateAt, type PlanInput, type SetPlan } from './planner';

function input(over: Partial<PlanInput> = {}): PlanInput {
  return { entries: [], tracks: {}, transitionsByUuid: {}, takesByUuid: {}, ...over };
}

const facts = (durationSec: number, mainCueSec = 0, bpm: number | null = 120) => ({
  durationSec,
  bpm,
  mainCueSec,
});

const tr = (over: Partial<Transition> = {}): Transition => ({
  startSec: 60,
  durationSec: 20,
  bInSec: 8,
  tempoMatch: false,
  lanes: {},
  ...over,
});

/** The canonical two-track plan: window on the mix axis 60..80, B in at
 * 8 → entries[1].mixOffsetSec = 52. */
function windowedPlan(over: Partial<PlanInput> = {}): SetPlan {
  return planSet(
    input({
      entries: [
        { trackId: 1, pin: { kind: 'transition', uuid: 'w' } },
        { trackId: 2, pin: null },
      ],
      tracks: { 1: facts(90), 2: facts(240) },
      transitionsByUuid: { w: tr() },
      ...over,
    })
  );
}

const silentDeck = { trackId: null, playheadSec: 0, playing: false, pitchPercent: 0 };
const flatChannel = () => ({ trim: 0.5, fader: 1, eq: { low: 0.5, mid: 0.5, high: 0.5 }, filter: 0 });

/** Snapshot shorthand: audible-flat channels, decks as given. */
function snap(over: Partial<PickupSnapshot> = {}): PickupSnapshot {
  return {
    decks: { A: { ...silentDeck }, B: { ...silentDeck } },
    channels: { A: flatChannel(), B: flatChannel() },
    crossfader: 0,
    crossfaderEnabled: false,
    ...over,
  };
}

function deck(trackId: number, playheadSec: number, over: Partial<PickupSnapshot['decks']['A']> = {}) {
  return { trackId, playheadSec, playing: true, pitchPercent: 0, ...over };
}

function lit(d: PickupDecision): Extract<PickupDecision, { lit: true }> {
  expect(d).toMatchObject({ lit: true });
  return d as Extract<PickupDecision, { lit: true }>;
}

function unlit(d: PickupDecision): Extract<PickupDecision, { lit: false }> {
  expect(d.lit).toBe(false);
  return d as Extract<PickupDecision, { lit: false }>;
}

/** Round-trip: at the decision's instant, the (maybe flipped) plan puts
 * the physical deck exactly at its current playhead, playing. */
function expectRoundTrip(plan: SetPlan, s: PickupSnapshot, ch: ChannelId): void {
  const d = lit(evaluatePickup(plan, s));
  const exec = d.flip ? flipPlanDecks(plan) : plan;
  const state = planStateAt(exec, d.mixTime);
  expect(state.decks[ch].trackId).toBe(s.decks[ch].trackId);
  expect(state.decks[ch].playing).toBe(true);
  expect(state.decks[ch].trackTime).toBeCloseTo(s.decks[ch].playheadSec, 2);
}

describe('audibility anchoring (Master-bus model, paused counts)', () => {
  it('no audible deck → unlit with no-audible-deck', () => {
    const plan = windowedPlan();
    const d = unlit(
      evaluatePickup(plan, snap({ channels: { A: { ...flatChannel(), fader: 0 }, B: { ...flatChannel(), fader: 0 } }, decks: { A: deck(1, 30), B: { ...silentDeck } } }))
    );
    expect(d.reason).toBe('no-audible-deck');
  });

  it('a PAUSED audible deck anchors (predicate holds while paused)', () => {
    const plan = windowedPlan();
    const s = snap({ decks: { A: deck(1, 30, { playing: false }), B: { ...silentDeck } } });
    const d = lit(evaluatePickup(plan, s));
    expect(d.mixTime).toBeCloseTo(30);
    expect(d.anchors).toEqual(['A']);
  });

  it('a killed channel is not an anchor: EQ kill, filter kill, crossfader', () => {
    const plan = windowedPlan();
    // B playing a set track but EQ-killed → one-deck case on A.
    const eqKilled = snap({
      decks: { A: deck(1, 30), B: deck(2, 100) },
      channels: {
        A: flatChannel(),
        B: { ...flatChannel(), eq: { low: 0, mid: 0, high: 0 } },
      },
    });
    expect(lit(evaluatePickup(plan, eqKilled)).anchors).toEqual(['A']);
    // Crossfader hard to A (enabled) silences B.
    const crossfaded = snap({
      decks: { A: deck(1, 30), B: deck(2, 100) },
      crossfader: -1,
      crossfaderEnabled: true,
    });
    expect(lit(evaluatePickup(plan, crossfaded)).anchors).toEqual(['A']);
  });

  it('an open channel with no track loaded is never audible', () => {
    const plan = windowedPlan();
    const s = snap({ decks: { A: deck(1, 30), B: { ...silentDeck } } });
    expect(lit(evaluatePickup(plan, s)).anchors).toEqual(['A']);
  });
});

describe('one-deck pickup', () => {
  it('mid-solo: t = mixOffset + τ/rate, anchor untouched by construction', () => {
    const plan = windowedPlan();
    const s = snap({ decks: { A: deck(1, 30), B: { ...silentDeck } } });
    const d = lit(evaluatePickup(plan, s));
    expect(d.mixTime).toBeCloseTo(30);
    expect(d.flip).toBe(false);
    expectRoundTrip(plan, s, 'A');
  });

  it('mid-window on the OUTGOING resumes inside the transition', () => {
    const plan = windowedPlan();
    const s = snap({ decks: { A: deck(1, 70), B: { ...silentDeck } } });
    const d = lit(evaluatePickup(plan, s));
    expect(d.mixTime).toBeCloseTo(70);
    // The silent incoming reconciles like a seek: at t=70 the plan wants
    // B playing at 8 + 10 = 18.
    const state = planStateAt(plan, d.mixTime);
    expect(state.decks.B.playing).toBe(true);
    expect(state.decks.B.trackTime).toBeCloseTo(18);
    expectRoundTrip(plan, s, 'A');
  });

  it('mid-window on the INCOMING inverts the window mapping', () => {
    const plan = windowedPlan();
    const s = snap({ decks: { A: { ...silentDeck }, B: deck(2, 18) } });
    const d = lit(evaluatePickup(plan, s));
    expect(d.mixTime).toBeCloseTo(70);
    expect(d.flip).toBe(false);
    expectRoundTrip(plan, s, 'B');
  });

  it('wrong physical deck maps with flip=true (mapping, not re-planning)', () => {
    const plan = windowedPlan();
    // Track 1 is entries[0] (planned deck A) but sits on physical B.
    const s = snap({ decks: { A: { ...silentDeck }, B: deck(1, 30) } });
    const d = lit(evaluatePickup(plan, s));
    expect(d.flip).toBe(true);
    expect(d.mixTime).toBeCloseTo(30);
    expectRoundTrip(plan, s, 'B');
  });

  it('track not in the set → unlit, names the deck', () => {
    const plan = windowedPlan();
    const d = unlit(evaluatePickup(plan, snap({ decks: { A: deck(99, 30), B: { ...silentDeck } } })));
    expect(d.reason).toBe('not-in-set');
    expect(d.message).toContain('Deck A');
  });

  it('outside the planned span → unlit ("silent in the set")', () => {
    const plan = windowedPlan();
    // Track 1 exits at 80 (window end); τ=85 is never audible in the set.
    const d = unlit(evaluatePickup(plan, snap({ decks: { A: deck(1, 85), B: { ...silentDeck } } })));
    expect(d.reason).toBe('outside-span');
    expect(d.message).toContain('silent in the set');
  });

  it('τ at the exact exit clamps strictly inside the span (anchor keeps playing)', () => {
    const plan = windowedPlan();
    const s = snap({ decks: { A: deck(1, 80), B: { ...silentDeck } } });
    const d = lit(evaluatePickup(plan, s));
    expect(d.mixTime).toBeLessThan(plan.entries[0].exitMixSec);
    expect(planStateAt(plan, d.mixTime).decks.A.playing).toBe(true);
  });

  it('content a Jump skips over is unreachable → outside-span', () => {
    const plan = windowedPlan({
      transitionsByUuid: { w: tr({ jumps: [{ x: 0.5, deltaSec: 6 }] }) },
    });
    // Jump at authored 70 skips B's 18..24. τ=20 was jumped over…
    const skipped = unlit(
      evaluatePickup(plan, snap({ decks: { A: { ...silentDeck }, B: deck(2, 20) } }))
    );
    expect(skipped.reason).toBe('outside-span');
    // …while τ=26 (after the jump) maps: 26 = 8 + (t−60) + 6 → t = 72.
    const after = snap({ decks: { A: { ...silentDeck }, B: deck(2, 26) } });
    const d = lit(evaluatePickup(plan, after));
    expect(d.mixTime).toBeCloseTo(72);
    expectRoundTrip(plan, after, 'B');
  });

  it('mid-Tempo-return (Riding) inverts the quadratic ease', () => {
    const plan = windowedPlan({
      tracks: { 1: facts(90, 0, 120), 2: facts(240, 0, 100) },
      transitionsByUuid: { w: tr({ tempoMatch: true }) },
    });
    const w = plan.adjacencies[0];
    expect(w.tempoReturnEndSec).toBeGreaterThan(w.mixEndSec); // ramp exists
    const midRamp = (w.mixEndSec + w.tempoReturnEndSec) / 2;
    const tau = planStateAt(plan, midRamp).decks.B.trackTime;
    const s = snap({ decks: { A: { ...silentDeck }, B: deck(2, tau) } });
    const d = lit(evaluatePickup(plan, s));
    expect(d.mixTime).toBeCloseTo(midRamp, 2);
    expectRoundTrip(plan, s, 'B');
  });

  it('Fixed policy: the solo mapping runs at the Set-tempo rate', () => {
    const plan = windowedPlan({
      tracks: { 1: facts(90, 0, 120), 2: facts(240, 0, 100) },
      tempo: { policy: 'fixed', setTempoBpm: 120 },
    });
    // Track 2 runs at rate 1.2; pick it up mid-solo.
    const s = snap({ decks: { A: { ...silentDeck }, B: deck(2, 120) } });
    const d = lit(evaluatePickup(plan, s));
    expect(d.mixTime).toBeCloseTo(plan.entries[1].mixOffsetSec + 120 / 1.2);
    expectRoundTrip(plan, s, 'B');
  });
});

describe('two-deck pickup (the blend)', () => {
  const blendSnap = (tauOut: number, tauIn: number) =>
    snap({ decks: { A: deck(1, tauOut), B: deck(2, tauIn) } });

  it('aligned mid-window adopts the blend; both decks anchor', () => {
    const plan = windowedPlan();
    const s = blendSnap(70, 18);
    const d = lit(evaluatePickup(plan, s));
    expect(d.mixTime).toBeCloseTo(70);
    expect(d.flip).toBe(false);
    expect(new Set(d.anchors)).toEqual(new Set(['A', 'B']));
    expectRoundTrip(plan, s, 'A');
    expectRoundTrip(plan, s, 'B');
  });

  it('alignment within the drift tolerance still lights', () => {
    const plan = windowedPlan();
    const d = lit(evaluatePickup(plan, blendSnap(70, 18.1)));
    expect(d.mixTime).toBeCloseTo(70);
  });

  it('misaligned beyond tolerance → unlit with the fade-out hint', () => {
    const plan = windowedPlan();
    const d = unlit(evaluatePickup(plan, blendSnap(70, 21)));
    expect(d.reason).toBe('misaligned');
    expect(d.message).toContain('fade Deck');
  });

  it('a custom tolerance widens the aligned window', () => {
    const plan = windowedPlan();
    const d = evaluatePickup(plan, blendSnap(70, 21), { toleranceSec: 5 });
    expect(d.lit).toBe(true);
  });

  it('two audible decks OUTSIDE the window → misaligned', () => {
    const plan = windowedPlan();
    // Outgoing at τ=30 puts the instant well before the window opens.
    const d = unlit(evaluatePickup(plan, blendSnap(30, 8)));
    expect(d.reason).toBe('misaligned');
  });

  it('adjacent tracks planned as a HARD CUT never blend → misaligned', () => {
    const plan = planSet(
      input({
        entries: [
          { trackId: 1, pin: null },
          { trackId: 2, pin: null },
        ],
        tracks: { 1: facts(90), 2: facts(240) },
      })
    );
    const d = unlit(evaluatePickup(plan, blendSnap(70, 18)));
    expect(d.reason).toBe('misaligned');
  });

  it('non-adjacent set tracks → unlit with non-adjacent', () => {
    const plan = planSet(
      input({
        entries: [1, 2, 3].map((trackId) => ({ trackId, pin: null })),
        tracks: { 1: facts(90), 2: facts(100), 3: facts(240) },
      })
    );
    const d = unlit(evaluatePickup(plan, snap({ decks: { A: deck(1, 30), B: deck(3, 30) } })));
    expect(d.reason).toBe('non-adjacent');
  });

  it('a stray track not in the set names the stray deck', () => {
    const plan = windowedPlan();
    const d = unlit(evaluatePickup(plan, snap({ decks: { A: deck(1, 70), B: deck(99, 10) } })));
    expect(d.reason).toBe('not-in-set');
    expect(d.message).toContain('Deck B');
  });

  it('the instant derives from the audibly DOMINANT deck; residue lands on the other', () => {
    const plan = windowedPlan();
    // Incoming (B) dominant: A faded low but still audible, and 0.1s off
    // the pinned Transition. The instant must come from B (exact 18 →
    // t=70), leaving A carrying the sub-tolerance offset.
    const s = snap({
      decks: { A: deck(1, 70.1), B: deck(2, 18) },
      channels: { A: { ...flatChannel(), fader: 0.5 }, B: flatChannel() },
    });
    const d = lit(evaluatePickup(plan, s));
    expect(d.mixTime).toBeCloseTo(70);
    expectRoundTrip(plan, s, 'B'); // the dominant anchor is seamless
  });

  it('the blend on swapped physical decks maps with flip=true', () => {
    const plan = windowedPlan();
    const s = snap({ decks: { A: deck(2, 18), B: deck(1, 70) } });
    const d = lit(evaluatePickup(plan, s));
    expect(d.flip).toBe(true);
    expect(d.mixTime).toBeCloseTo(70);
    expectRoundTrip(plan, s, 'A');
    expectRoundTrip(plan, s, 'B');
  });
});

describe('mixTimeForTrackTime (the planStateAt inverse)', () => {
  it('round-trips across regimes: window, Tempo return, solo', () => {
    const plan = windowedPlan({
      tracks: { 1: facts(90, 0, 120), 2: facts(240, 0, 100) },
      transitionsByUuid: { w: tr({ tempoMatch: true }) },
    });
    const w = plan.adjacencies[0];
    for (const t of [65, 75, w.mixEndSec + 1, w.tempoReturnEndSec + 5, w.tempoReturnEndSec + 40]) {
      const tau = planStateAt(plan, t).decks.B.trackTime;
      expect(mixTimeForTrackTime(plan, 1, tau)).toBeCloseTo(t, 2);
    }
  });

  it('returns null outside the audible span', () => {
    const plan = windowedPlan();
    expect(mixTimeForTrackTime(plan, 0, 89)).toBeNull(); // past exit (80)
    expect(mixTimeForTrackTime(plan, 1, 2)).toBeNull(); // before B's entry (8)
  });
});

describe('flipPlanDecks', () => {
  it('mirrors decks and lanes; indices, times, and warnings untouched', () => {
    const plan = windowedPlan();
    const flipped = flipPlanDecks(plan);
    expect(flipped.entries.map((e) => e.deck)).toEqual(['B', 'A']);
    expect(flipped.totalSec).toBe(plan.totalSec);
    const t = 70;
    const orig = planStateAt(plan, t);
    const mirr = planStateAt(flipped, t);
    expect(mirr.decks.B).toEqual(orig.decks.A);
    expect(mirr.decks.A).toEqual(orig.decks.B);
    expect(mirr.lanes.B).toEqual(orig.lanes.A);
    expect(mirr.lanes.A).toEqual(orig.lanes.B);
  });
});

describe('pickupStartLanes (the convergence ramp start)', () => {
  it('reads base state verbatim with the crossfader neutral/disabled', () => {
    const s = snap({
      channels: {
        A: { trim: 0.5, fader: 0.8, eq: { low: 0.4, mid: 0.5, high: 0.6 }, filter: 0.2 },
        B: flatChannel(),
      },
    });
    const lanes = pickupStartLanes(s);
    expect(lanes.A).toEqual({ fader: 0.8, eq: { low: 0.4, mid: 0.5, high: 0.6 }, filter: 0.2 });
  });

  it('folds the crossfader gain into the fader (value·√xf preserves gain)', () => {
    const s = snap({ crossfader: -1, crossfaderEnabled: true }); // full A
    const lanes = pickupStartLanes(s);
    expect(lanes.A.fader).toBeCloseTo(1); // xf.a = 1
    expect(lanes.B.fader).toBeCloseTo(0); // xf.b = 0 → silent start
  });
});
