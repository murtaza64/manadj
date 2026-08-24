/**
 * Routine plan integration (routines 159): a pinned Routine covers its
 * adjacencies — slot 0 adopts the sounding deck at the window start,
 * interior slots allocate A→B→C→D, the recording drives planStateAt
 * inside the span, and the exit slot's deck keeps sounding into the
 * downstream adjacency (Riding eases its pitch home; Fixed holds the Set
 * tempo). Fed through the RoutinePlanInput seam directly — #160's pin
 * plumbing arrives at the e2e merge.
 */
import { describe, expect, it } from 'vitest';
import type { Transition } from '../editor/mixModel';
import { planSet, planStateAt, jumpCrossed, type PlanInput } from './planner';
import type { RoutineEventInput, RoutinePlanInput } from './routinePlan';

// ── Synthetic recording (the routinePlan.test.ts fixture, shared shape) ─

const tick = (beat: number, playheads: Record<string, number>): RoutineEventInput => ({
  kind: 'tick',
  beat,
  playheads,
});
const control = (
  beat: number,
  slot: number | null,
  ctl: string,
  value: number
): RoutineEventInput => ({ kind: 'control', beat, slot, control: ctl, value });

/** 3-slot recording on 120 BPM tracks: 64 beats, entries at 0/16/32,
 * entry positions 60/0/10; everyone rolls at sync from their entry. */
function recording(cast: [number, number, number]): RoutinePlanInput {
  const events: RoutineEventInput[] = [];
  const entries = [0, 16, 32];
  const positions = [60, 0, 10];
  for (let b = 0; b <= 64; b += 4) {
    const playheads: Record<string, number> = {};
    for (const slot of [0, 1, 2]) {
      if (b >= entries[slot]) playheads[String(slot)] = positions[slot] + (b - entries[slot]) * 0.5;
    }
    events.push(tick(b, playheads));
  }
  events.push(control(16, 1, 'fader', 1));
  events.push(control(32, 2, 'fader', 1));
  events.push(control(48, 0, 'fader', 0));
  events.sort((a, b) => (a.beat as number) - (b.beat as number));
  return {
    cast,
    entryOffsetsBeats: entries,
    entryPositions: positions,
    durationBeats: 64,
    events,
  };
}

const facts = (durationSec: number, bpm: number | null = 120) => ({
  durationSec,
  bpm,
  hotCue1Sec: null,
});

/** Four 120 BPM entries; the routine covers 1→2→3 starting at entry 0;
 * entry 4 (track 9) follows the exit track by hard cut. */
function routineInput(over: Partial<PlanInput> = {}): PlanInput {
  return {
    entries: [
      { trackId: 1, pin: null },
      { trackId: 2, pin: null },
      { trackId: 3, pin: null },
      { trackId: 9, pin: null },
    ],
    tracks: { 1: facts(240), 2: facts(240), 3: facts(240), 9: facts(240) },
    transitionsByUuid: {},
    takesByUuid: {},
    routines: [{ startEntryIndex: 0, routine: recording([1, 2, 3]) }],
    ...over,
  };
}

describe('planSet with a pinned Routine', () => {
  it('covers the cast adjacencies and anchors the window on slot 0\'s timeline', () => {
    const plan = planSet(routineInput());
    expect(plan.routines).toHaveLength(1);
    const r = plan.routines[0];
    // Entry 0 opens the set at its own start (mix 0 = track 0): the
    // recording's slot-0 entry mark (track 60s) sits at mix 60.
    expect(r.mixStartSec).toBeCloseTo(60, 6);
    // Riding: target = slot 0's native BPM → 0.5 s/beat, 64 beats = 32s.
    expect(r.mixEndSec).toBeCloseTo(92, 6);
    expect(plan.adjacencies[0].kind).toBe('routine');
    expect(plan.adjacencies[1].kind).toBe('routine');
    expect(plan.adjacencies[2].kind).toBe('hardcut'); // exit → track 9
    // Slot decks: adopt A (entry 0's deck), then B, C.
    expect(r.slots.map((s) => s.deck)).toEqual(['A', 'B', 'C']);
    expect(plan.entries.slice(0, 3).map((e) => e.deck)).toEqual(['A', 'B', 'C']);
    expect(plan.warnings.filter((w) => w.severity === 'error')).toEqual([]);
  });

  it('planStateAt inside the span replays the recording (decks, lanes, entries)', () => {
    const plan = planSet(routineInput());
    // Mix 70 = beat 20: slots 0 and 1 rolling, slot 2 parked at 10.
    const s = planStateAt(plan, 70);
    expect(s.decks.A.playing).toBe(true);
    expect(s.decks.A.trackTime).toBeCloseTo(60 + 10, 2);
    expect(s.decks.B.playing).toBe(true);
    expect(s.decks.B.trackTime).toBeCloseTo(2, 2);
    expect(s.decks.C.playing).toBe(false);
    expect(s.decks.C.trackTime).toBeCloseTo(10, 2);
    expect(s.decks.C.trackId).toBe(3); // parked loaded at its entry
    // Recorded lanes: slot 1's fader raised at its entry (beat 16).
    expect(s.lanes.B.fader).toBe(1);
    // Slot 0 fades out at beat 48 (mix 84).
    expect(planStateAt(plan, 85).lanes.A.fader).toBe(0);
    expect(s.activeEntryIndex).toBe(1);
  });

  it('the exit slot keeps sounding: its deck continues seamlessly past the end', () => {
    const plan = planSet(routineInput());
    const r = plan.routines[0];
    // Exit slot (track 3, deck C) at the boundary: recorded final
    // position 10 + 32·0.5 = 26.
    const before = planStateAt(plan, r.mixEndSec - 0.01);
    const after = planStateAt(plan, r.mixEndSec + 0.01);
    expect(before.decks.C.playing).toBe(true);
    expect(after.decks.C.playing).toBe(true);
    expect(after.decks.C.trackTime).toBeCloseTo(before.decks.C.trackTime, 1);
    expect(after.decks.C.trackTime).toBeCloseTo(26, 1);
    // The other cast decks are done: parked at their recorded exits.
    expect(after.decks.A.playing).toBe(false);
    expect(after.decks.B.playing).toBe(false);
    // Downstream: the hard cut to track 9 sits at the exit track's end,
    // on the exit track's own timeline.
    expect(plan.adjacencies[2].mixStartSec).toBeCloseTo(r.mixEndSec + (240 - 26), 1);
    // Post-routine parity: the next entry avoids the exit deck.
    expect(plan.entries[3].deck).toBe('A');
  });

  it('Fixed tempo: the recording rescales and every slot pitches to the Set tempo', () => {
    const plan = planSet(routineInput({ tempo: { policy: 'fixed', setTempoBpm: 132 } }));
    const r = plan.routines[0];
    expect(r.targetBpm).toBe(132);
    // Window start on the pitched timeline: 60 / (132/120) ≈ 54.55.
    expect(r.mixStartSec).toBeCloseTo(60 / 1.1, 2);
    expect(r.mixEndSec).toBeCloseTo(r.mixStartSec + (64 * 60) / 132, 4);
    const s = planStateAt(plan, r.mixStartSec + 5);
    expect(s.decks.A.pitchPercent).toBeCloseTo(10, 4);
    // Exit continues at the Set tempo — no Tempo return under Fixed.
    const last = plan.adjacencies[1];
    expect(last.kind).toBe('routine');
    expect(last.tempoReturnEndSec).toBeCloseTo(r.mixEndSec, 6);
    const after = planStateAt(plan, r.mixEndSec + 1);
    expect(after.decks.C.pitchPercent).toBeCloseTo(10, 4);
  });

  it('Riding with an off-tempo cast: the exit eases back to native after the span', () => {
    // Slot 0 at 120 BPM sets the target; the exit track is 125 BPM →
    // exits pitched at 120/125−1 = −4%, then eases home.
    const input = routineInput({
      tracks: { 1: facts(240), 2: facts(240), 3: facts(240, 125), 9: facts(240) },
    });
    const plan = planSet(input);
    const r = plan.routines[0];
    expect(r.exit.pitchPercent).toBeCloseTo(-4, 6);
    const last = plan.adjacencies[1];
    expect(last.kind).toBe('routine');
    expect(last.tempoReturnEndSec).toBeGreaterThan(r.mixEndSec);
    // Mid-ramp: pitch between −4 and 0; after: native.
    const midT = (r.mixEndSec + last.tempoReturnEndSec) / 2;
    const mid = planStateAt(plan, midT);
    expect(mid.decks.C.pitchPercent).toBeGreaterThan(-4);
    expect(mid.decks.C.pitchPercent).toBeLessThan(0);
    const after = planStateAt(plan, last.tempoReturnEndSec + 1);
    expect(after.decks.C.pitchPercent).toBeCloseTo(0, 6);
    // Track time is continuous across the ramp end (the quadratic lands
    // on the solo anchor).
    const justBefore = planStateAt(plan, last.tempoReturnEndSec - 0.01);
    expect(after.decks.C.trackTime - justBefore.decks.C.trackTime).toBeCloseTo(1.01, 1);
  });

  it('two Routines chain through a shared boundary track', () => {
    // Routine 1: 1→2→3 at entry 0; routine 2: 3→4→5 at entry 2 (the
    // exit entry). Disjoint covered adjacencies; slot 0 of routine 2
    // adopts routine 1's exit deck.
    const r2 = recording([3, 4, 5]);
    // Chain: routine 2 enters where routine 1 left track 3 (position 26).
    r2.entryPositions = [26, 0, 0];
    const input: PlanInput = {
      entries: [
        { trackId: 1, pin: null },
        { trackId: 2, pin: null },
        { trackId: 3, pin: null },
        { trackId: 4, pin: null },
        { trackId: 5, pin: null },
      ],
      tracks: { 1: facts(240), 2: facts(240), 3: facts(240), 4: facts(240), 5: facts(240) },
      transitionsByUuid: {},
      takesByUuid: {},
      routines: [
        { startEntryIndex: 0, routine: recording([1, 2, 3]) },
        { startEntryIndex: 2, routine: r2 },
      ],
    };
    const plan = planSet(input);
    expect(plan.routines).toHaveLength(2);
    const [r1, second] = plan.routines;
    // The chain shares the boundary instant: routine 2's window opens at
    // routine 1's end (track 3 sits at 26 exactly there).
    expect(second.mixStartSec).toBeCloseTo(r1.mixEndSec, 1);
    // Adoption across the chain: routine 1 exits on C; routine 2's slot 0
    // adopts C.
    expect(r1.exit.deck).toBe('C');
    expect(second.slots[0].deck).toBe('C');
    expect(plan.adjacencies.map((a) => a.kind)).toEqual([
      'routine',
      'routine',
      'routine',
      'routine',
    ]);
    expect(plan.warnings.filter((w) => w.severity === 'error')).toEqual([]);
  });

  it('a cast mismatch skips the pin with a warning (plans as unpinned)', () => {
    const input = routineInput();
    input.entries[1] = { trackId: 7, pin: null };
    input.tracks[7] = facts(240);
    const plan = planSet(input);
    expect(plan.routines).toEqual([]);
    expect(plan.warnings.some((w) => w.kind === 'routine-invalid')).toBe(true);
    expect(plan.adjacencies.every((a) => a.kind === 'hardcut')).toBe(true);
    // Ping-pong parity intact without the routine.
    expect(plan.entries.map((e) => e.deck)).toEqual(['A', 'B', 'A', 'B']);
  });

  it('a missing cast BPM skips the pin (beat clock cannot scale)', () => {
    const input = routineInput();
    input.tracks[2] = facts(240, null);
    const plan = planSet(input);
    expect(plan.routines).toEqual([]);
    expect(plan.warnings.some((w) => w.kind === 'routine-invalid')).toBe(true);
  });

  it('recorded seeks surface as jump crossings for the Conductor hard-sync', () => {
    const input = routineInput();
    const routine = input.routines![0].routine;
    routine.events.push({ kind: 'transport', beat: 20, slot: 0, action: 'seek', playhead: 200 });
    routine.events.push(tick(22, { '0': 201, '1': 3 }));
    routine.events.sort((a, b) => (a.beat as number) - (b.beat as number));
    const plan = planSet(input);
    // Beat 20 at 0.5 s/beat from mix 60 → mix 70. (The synthetic ticks
    // resume the original trajectory at beat 24, which reads as a second
    // jump — mix 72; between the two sits clean playback.)
    expect(jumpCrossed(plan, 69.8, 70.1)).toBe(true);
    expect(jumpCrossed(plan, 70.5, 71.5)).toBe(false);
  });

  it('a downstream Transition pin plans on the exit track\'s timeline', () => {
    const transition: Transition = {
      startSec: 100,
      durationSec: 10,
      bInSec: 0,
      tempoMatch: false,
      lanes: {},
    };
    const input = routineInput();
    input.entries[2] = { trackId: 3, pin: { kind: 'transition', uuid: 't1' } };
    input.transitionsByUuid = { t1: transition };
    const plan = planSet(input);
    const r = plan.routines[0];
    const adj = plan.adjacencies[2];
    expect(adj.kind).toBe('transition');
    // Track 3 exits the routine at 26 (mix = r.mixEndSec): the authored
    // window start (track 100) maps 74s later.
    expect(adj.mixStartSec).toBeCloseTo(r.mixEndSec + 74, 1);
    // Both decks sound through the window: exit deck C + incoming A.
    const mid = planStateAt(plan, adj.mixStartSec + 5);
    expect(mid.decks.C.playing).toBe(true);
    expect(mid.decks.A.playing).toBe(true);
    expect(mid.decks.A.trackId).toBe(9);
  });

  it('routines never grace-fade and never collide with the parity transform', () => {
    // A pinned window right after the routine must not truncate covered
    // entries (they live on other decks).
    const transition: Transition = {
      startSec: 30,
      durationSec: 10,
      bInSec: 0,
      tempoMatch: false,
      lanes: {},
    };
    const input = routineInput();
    input.entries[2] = { trackId: 3, pin: { kind: 'transition', uuid: 't1' } };
    input.transitionsByUuid = { t1: transition };
    const plan = planSet(input);
    // No grace fades were synthesized against routine spans.
    expect(plan.entries.every((e) => e.graceFade === undefined)).toBe(true);
  });
});
