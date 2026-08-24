/**
 * Routine replay against the REAL s49 recording (routines 159): the
 * relentless-groove #20–23 Routine (Bangarang → Full Send → Tech Cvlt →
 * Like A G6), promoted by backend/routine_promotion.py from the
 * 2026-08-24 session and committed as a fixture — 2094 slot-addressed
 * beat-domain events over 527.74 beats. Validates the plan the issue's
 * acceptance describes: adoption of the sounding deck as slot 0,
 * A→B→C→D allocation, beat-rebased replay under both tempo policies
 * with pitch re-anchoring, and the exit handoff position.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { planSet, planStateAt, type PlanInput } from './planner';
import type { RoutinePlanInput } from './routinePlan';

interface Fixture extends RoutinePlanInput {
  tracks: Record<string, { title: string; bpm: number; durationSec: number }>;
}

/** The fixture is the RoutineDetail wire shape (snake_case) plus track
 * facts; camel-case it the way the e2e wiring will. */
const raw = JSON.parse(
  readFileSync(new URL('./__fixtures__/s49-bangarang-routine.json', import.meta.url), 'utf8')
);
const fixture: Fixture = {
  cast: raw.cast,
  entryOffsetsBeats: raw.entry_offsets_beats,
  entryPositions: raw.entry_positions,
  durationBeats: raw.duration_beats,
  events: raw.events,
  tracks: raw.tracks,
};

function s49Input(over: Partial<PlanInput> = {}): PlanInput {
  return {
    entries: fixture.cast.map((trackId) => ({ trackId, pin: null })),
    tracks: Object.fromEntries(
      Object.entries(fixture.tracks).map(([id, t]) => [
        id,
        { durationSec: t.durationSec, bpm: t.bpm, hotCue1Sec: null },
      ])
    ),
    transitionsByUuid: {},
    takesByUuid: {},
    routines: [
      {
        startEntryIndex: 0,
        routine: {
          cast: fixture.cast,
          entryOffsetsBeats: fixture.entryOffsetsBeats,
          entryPositions: fixture.entryPositions,
          durationBeats: fixture.durationBeats,
          events: fixture.events,
        },
      },
    ],
    ...over,
  };
}

describe('s49 #20–23 Routine (real promoted recording)', () => {
  it('plans clean: adoption at the recorded entry mark, A→B→C→D slots, no errors', () => {
    const plan = planSet(s49Input());
    expect(plan.routines).toHaveLength(1);
    const r = plan.routines[0];
    // Riding: target = Bangarang's native 174.
    expect(r.targetBpm).toBe(174);
    // The window opens where Bangarang's recorded entry mark sits on its
    // own timeline (the set opens the track from 0 at native rate).
    expect(r.mixStartSec).toBeCloseTo(63.18, 1);
    // 527.74 beats at 174 BPM ≈ 182s of replay.
    expect(r.mixEndSec - r.mixStartSec).toBeCloseTo((fixture.durationBeats * 60) / 174, 3);
    expect(r.slots.map((s) => s.deck)).toEqual(['A', 'B', 'C', 'D']);
    expect(plan.adjacencies.map((a) => a.kind)).toEqual(['routine', 'routine', 'routine']);
    expect(plan.warnings.filter((w) => w.severity === 'error')).toEqual([]);
    // All four cast tracks beatmatched at 174: base pitch 0 everywhere.
    for (const s of r.slots) expect(s.basePitchPercent).toBe(0);
  });

  it('re-anchors the recorded ~177 BPM performance to the 174 target (pitch ≈ 0)', () => {
    // The session rode ~+1.7% (pitch events at 1.728): the Routine clock
    // absorbed it — replay at the track-native target needs ~0 pitch.
    const plan = planSet(s49Input());
    const r = plan.routines[0];
    let moving = 0;
    let snapped = 0;
    for (let t = r.mixStartSec + 1; t < r.mixEndSec; t += 1) {
      const s = planStateAt(plan, t);
      for (const slot of r.slots) {
        const d = s.decks[slot.deck!];
        if (!d.playing) continue;
        moving++;
        if (d.pitchPercent === 0) snapped++;
        expect(Math.abs(d.pitchPercent)).toBeLessThan(8);
      }
    }
    expect(moving).toBeGreaterThan(200);
    // The bulk of the recording is beatmatched: snap dominates.
    expect(snapped / moving).toBeGreaterThan(0.8);
  });

  it('each slot joins at its recorded entry and the exit hands off in track 1072', () => {
    const plan = planSet(s49Input());
    const r = plan.routines[0];
    for (const slot of r.slots) {
      const after = planStateAt(plan, slot.entryMixSec + 2);
      const d = after.decks[slot.deck!];
      expect(d.trackId).toBe(slot.trackId);
    }
    // Exit continuity: Like A G6 keeps rolling across the boundary.
    const before = planStateAt(plan, r.mixEndSec - 0.05);
    const after = planStateAt(plan, r.mixEndSec + 0.05);
    expect(before.decks.D.playing).toBe(true);
    expect(after.decks.D.playing).toBe(true);
    expect(after.decks.D.trackId).toBe(1072);
    expect(Math.abs(after.decks.D.trackTime - before.decks.D.trackTime)).toBeLessThan(0.5);
    expect(after.decks.D.trackTime).toBeCloseTo(r.exit.trackSecAtEnd, 0);
    // The exit position is inside the track (a real handoff point).
    expect(r.exit.trackSecAtEnd).toBeGreaterThan(0);
    expect(r.exit.trackSecAtEnd).toBeLessThan(184.19);
  });

  it('replays positions monotonically between recorded jumps (audible coherence)', () => {
    const plan = planSet(s49Input());
    const r = plan.routines[0];
    const jumps = r.jumpMixSecs;
    for (const slot of r.slots) {
      let prev: number | null = null;
      let prevT = 0;
      for (let t = slot.entryMixSec + 0.5; t < r.mixEndSec; t += 0.5) {
        const d = planStateAt(plan, t).decks[slot.deck!];
        if (!d.playing) {
          prev = null;
          continue;
        }
        const crossedJump = jumps.some((j) => j > prevT && j <= t);
        if (prev !== null && !crossedJump) {
          expect(d.trackTime).toBeGreaterThanOrEqual(prev - 0.02);
        }
        prev = d.trackTime;
        prevT = t;
      }
    }
  });

  it('Fixed at 188 BPM: the whole recording rescales, every deck pitched ≈ +8%', () => {
    const plan = planSet(s49Input({ tempo: { policy: 'fixed', setTempoBpm: 188 } }));
    const r = plan.routines[0];
    expect(r.targetBpm).toBe(188);
    expect(r.mixEndSec - r.mixStartSec).toBeCloseTo((fixture.durationBeats * 60) / 188, 3);
    const base = (188 / 174 - 1) * 100;
    for (const s of r.slots) expect(s.basePitchPercent).toBeCloseTo(base, 6);
    const mid = planStateAt(plan, (r.mixStartSec + r.mixEndSec) / 2);
    const sounding = r.slots.filter((s) => mid.decks[s.deck!].playing);
    expect(sounding.length).toBeGreaterThan(0);
    for (const s of sounding) {
      expect(mid.decks[s.deck!].pitchPercent).toBeGreaterThan(base - 3);
      expect(mid.decks[s.deck!].pitchPercent).toBeLessThan(base + 3);
    }
    // Track positions at the SAME beat are tempo-invariant: the exit
    // hands off at the same recorded position as the Riding replay.
    const riding = planSet(s49Input()).routines[0];
    expect(r.exit.trackSecAtEnd).toBeCloseTo(riding.exit.trackSecAtEnd, 1);
  });

  it('the recorded mixer choreography lands on the remapped decks (faders move)', () => {
    const plan = planSet(s49Input());
    const r = plan.routines[0];
    // Sample each slot's fader across the span: the recording's 971
    // fader events must produce real motion on every allocated deck.
    for (const slot of r.slots) {
      const values = new Set<number>();
      for (let t = r.mixStartSec; t < r.mixEndSec; t += 2) {
        values.add(Math.round(planStateAt(plan, t).lanes[slot.deck!].fader * 100) / 100);
      }
      expect(values.size).toBeGreaterThan(1);
    }
  });
});
