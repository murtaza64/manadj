/**
 * Conductor Routine replay (routines 159): boundary adoption (no reload),
 * A→B→C→D slot decks driven through the recording, takeover mid-Routine,
 * and the exit handoff (last cast deck keeps sounding). The plan comes
 * from the REAL planSet with the RoutinePlanInput seam fed directly.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetAudibleSurfacesForTests } from '../playback/audibleSurface';
import type { DeckEngine } from '../playback/DeckEngine';
import type { Mixer } from '../playback/mixer';
import { Conductor, type ConductorAudio } from './Conductor';
import { planSet, type PlanAutomation, type PlanInput, type SetPlan } from './planner';
import type { RoutineEventInput, RoutinePlanInput } from './routinePlan';

// ── Fakes (Conductor.test.ts's mold, four decks) ────────────────────────

class FakeEngine {
  trackId: number | null = null;
  seeks = 0;
  pitchPercent = 0;
  durationSec = 240;
  private playingFlag = false;
  private parkedAt = 0;
  private subs = new Set<() => void>();
  private anchorPos = 0;
  private anchorCtx = 0;
  private readonly clock: () => number;

  constructor(clock: () => number) {
    this.clock = clock;
  }

  getSnapshot() {
    return {
      trackId: this.trackId,
      loadState: this.trackId === null ? 'empty' : 'ready',
      playing: this.playingFlag,
      duration: this.durationSec,
      pitchPercent: this.pitchPercent,
      bendPercent: 0,
      previewing: false,
      hotCuePreviewSlot: null,
      keyLock: true,
    } as ReturnType<DeckEngine['getSnapshot']>;
  }

  getPlayhead(): number {
    if (!this.playingFlag) return this.parkedAt;
    return this.anchorPos + (this.clock() - this.anchorCtx);
  }

  seek(t: number): void {
    this.seeks++;
    if (this.playingFlag) {
      this.anchorPos = t;
      this.anchorCtx = this.clock();
    } else this.parkedAt = t;
    this.emit();
  }

  play(): void {
    if (this.playingFlag) return;
    this.playingFlag = true;
    this.anchorPos = this.parkedAt;
    this.anchorCtx = this.clock();
    this.emit();
  }

  /** Machine-grade positioned start (#173): exact seek + start. */
  playAt(t: number): void {
    this.seek(t);
    this.play();
  }

  pause(): void {
    if (!this.playingFlag) return;
    this.parkedAt = this.getPlayhead();
    this.playingFlag = false;
    this.emit();
  }

  setPitch(p: number): void {
    this.pitchPercent = p;
  }
  /** Simulated audio drift: shift the playhead WITHOUT an event (the
   * worklet wandering / start latency — not a user gesture). */
  displace(dt: number): void {
    if (this.playingFlag) this.anchorPos += dt;
    else this.parkedAt += dt;
  }
  subscribe(fn: () => void): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }
  addTransportEventListener(): () => void {
    return () => {};
  }
  private emit(): void {
    for (const fn of this.subs) fn();
  }
}

type Deck = 'A' | 'B' | 'C' | 'D';
type LaneCapture = Partial<Record<Deck, PlanAutomation>>;

function fakeMixer(clock: () => number, capture: LaneCapture): Mixer {
  const channel = {
    fader: 1,
    trim: 0.5,
    eq: { low: 0.5, mid: 0.5, high: 0.5 },
    filter: 0,
    pfl: false,
  };
  return {
    now: clock,
    engageAutomation: () => Symbol('t'),
    disengageAutomation: () => {},
    setAutomation: (ch: Deck, v: PlanAutomation) => {
      capture[ch] = v;
    },
    subscribe: () => () => {},
    getChannelState: () => channel,
    getCrossfader: () => 0,
    getCrossfaderEnabled: () => true,
    getMaster: () => 1,
    setFader: () => {},
    setEq: () => {},
    setFilter: () => {},
    setTrim: () => {}, // routine lanes carry trim now (gh#190)
    setCrossfader: () => {},
  } as unknown as Mixer;
}

// ── Synthetic Routine over three entries ────────────────────────────────

const tick = (beat: number, playheads: Record<string, number>): RoutineEventInput => ({
  kind: 'tick',
  beat,
  playheads,
});
const control = (beat: number, slot: number, ctl: string, value: number): RoutineEventInput => ({
  kind: 'control',
  beat,
  slot,
  control: ctl,
  value,
});

/** 64-beat recording on 120 BPM tracks (0.5 s/beat): entries 0/16/32,
 * positions 60/0/10 — the plannerRoutine.test.ts recording. */
function recording(): RoutinePlanInput {
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
    cast: [1, 2, 3],
    entryOffsetsBeats: entries,
    entryPositions: positions,
    durationBeats: 64,
    events,
  };
}

function routinePlan(): SetPlan {
  const facts = { durationSec: 240, bpm: 120, hotCue1Sec: null };
  const input: PlanInput = {
    entries: [
      { trackId: 1, pin: null },
      { trackId: 2, pin: null },
      { trackId: 3, pin: null },
    ],
    tracks: { 1: facts, 2: facts, 3: facts },
    transitionsByUuid: {},
    takesByUuid: {},
    routines: [{ startEntryIndex: 0, routine: recording() }],
  };
  return planSet(input);
}

// ── Harness ─────────────────────────────────────────────────────────────

let now = 0;
let pendingFrame: (() => void) | null = null;

function tickAt(t: number): void {
  now = t;
  const frame = pendingFrame;
  pendingFrame = null;
  frame?.();
}

function makeConductor(plan: SetPlan = routinePlan()) {
  const clock = () => now;
  const engines = {
    A: new FakeEngine(clock),
    B: new FakeEngine(clock),
    C: new FakeEngine(clock),
    D: new FakeEngine(clock),
  };
  const stopped: string[] = [];
  const lanes: LaneCapture = {};
  const loads: Array<{ deck: Deck; trackId: number }> = [];
  const conductor = new Conductor(
    plan,
    { mixer: fakeMixer(clock, lanes), engines: engines as unknown as ConductorAudio['engines'] },
    {
      loadTrack: (deck, trackId) => {
        loads.push({ deck: deck as Deck, trackId });
        engines[deck as Deck].trackId = trackId;
      },
      onStopped: (reason) => stopped.push(reason),
    }
  );
  return { conductor, engines, plan, stopped, lanes, loads };
}

beforeEach(() => {
  now = 0;
  pendingFrame = null;
  _resetAudibleSurfacesForTests();
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
    pendingFrame = cb;
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {
    pendingFrame = null;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Routine boundary adoption (no reload)', () => {
  it('the sounding deck IS slot 0: one load ever, playback continuous across the window start', () => {
    const { conductor, engines, loads } = makeConductor();
    conductor.playFromEntry(0);
    tickAt(0);
    tickAt(0.01); // A starts at track 0
    tickAt(30); // solo stretch
    const loadsForA = loads.filter((l) => l.deck === 'A').length;
    const seeksBefore = engines.A.seeks;
    tickAt(59.9); // just before the window (track 59.9)
    tickAt(60.1); // inside the Routine
    tickAt(62);
    expect(loads.filter((l) => l.deck === 'A').length).toBe(loadsForA);
    expect(engines.A.getSnapshot().playing).toBe(true);
    // Continuity: no corrective churn at the boundary (the trace picks up
    // exactly where the solo anchor left the deck).
    expect(engines.A.seeks).toBe(seeksBefore);
    expect(engines.A.getPlayhead()).toBeCloseTo(62, 1);
    conductor.stop();
  });

  it('interior slots load onto their allocated decks and join at their entries', () => {
    const { conductor, engines, loads } = makeConductor();
    conductor.playFromEntry(0);
    tickAt(0);
    tickAt(0.01);
    tickAt(30);
    // Covered entries are upcoming occupants: B and C hold their tracks
    // well before their entries.
    expect(loads.some((l) => l.deck === 'B' && l.trackId === 2)).toBe(true);
    expect(loads.some((l) => l.deck === 'C' && l.trackId === 3)).toBe(true);
    expect(loads.filter((l) => l.deck === 'D')).toEqual([]);
    tickAt(60.1);
    expect(engines.B.getSnapshot().playing).toBe(false); // entry at beat 16 = mix 68
    tickAt(68.1);
    tickAt(68.2);
    expect(engines.B.getSnapshot().playing).toBe(true);
    expect(engines.B.getPlayhead()).toBeCloseTo(0.2, 1);
    expect(engines.C.getSnapshot().playing).toBe(false); // parked at 10 until beat 32
    tickAt(76.2);
    tickAt(76.3);
    expect(engines.C.getSnapshot().playing).toBe(true);
    expect(engines.C.getPlayhead()).toBeCloseTo(10.25, 1);
    conductor.stop();
  });

  it('replays the recorded slot lanes onto the allocated decks', () => {
    const { conductor, lanes, conductorStopAtEnd } = (() => {
      const h = makeConductor();
      return { ...h, conductorStopAtEnd: () => h.conductor.stop() };
    })();
    conductor.playFromEntry(0);
    tickAt(0);
    tickAt(0.01);
    tickAt(62);
    // Slot 1's fader is closed until its recorded raise at beat 16.
    expect(lanes.B!.fader).toBe(0);
    tickAt(69);
    expect(lanes.B!.fader).toBe(1);
    // Slot 0's recorded fade-out at beat 48 (mix 84).
    tickAt(85);
    expect(lanes.A!.fader).toBe(0);
    expect(lanes.C!.fader).toBe(1);
    conductorStopAtEnd();
  });
});

describe('recorded-jump hard sync is deck-scoped (#161 finding 1 follow-up)', () => {
  it('a slot trace jump seeks ONLY that slot\'s deck; the others keep rolling', () => {
    // Slot 1's recording jumps at beat 24 (mix 60 + 24·0.5 = 72): a
    // +8s recorded seek. Slot 0 (deck A) must not be touched by it.
    const rec = recording();
    for (const e of rec.events) {
      if (e.kind === 'tick' && (e.beat as number) >= 24) {
        const ph = e.playheads as Record<string, number>;
        if (ph['1'] !== undefined) ph['1'] += 8;
      }
    }
    const facts = { durationSec: 240, bpm: 120, hotCue1Sec: null };
    const plan = planSet({
      entries: [
        { trackId: 1, pin: null },
        { trackId: 2, pin: null },
        { trackId: 3, pin: null },
      ],
      tracks: { 1: facts, 2: facts, 3: facts },
      transitionsByUuid: {},
      takesByUuid: {},
      routines: [{ startEntryIndex: 0, routine: rec }],
    });
    const { conductor, engines } = makeConductor(plan);
    conductor.playFromEntry(0);
    tickAt(0);
    tickAt(0.01);
    tickAt(69); // inside the routine, B joined at 68
    tickAt(69.1);
    tickAt(70);
    const seeksA = engines.A.seeks;
    const seeksB = engines.B.seeks;
    tickAt(71.9);
    tickAt(72.1); // crossing slot 1's recorded jump
    expect(engines.B.seeks).toBe(seeksB + 1); // the jumping deck hard-syncs
    expect(engines.A.seeks).toBe(seeksA); // the others are left alone
    conductor.stop();
  });
});

describe('phase servo (#161 finding 4)', () => {
  it('sub-seek drift corrects by a rate nudge, never a seek', () => {
    const { conductor, engines } = makeConductor();
    conductor.playFromEntry(0);
    tickAt(0);
    tickAt(0.01);
    tickAt(30); // solo stretch: deck A joined and settled
    tickAt(30.02);
    const seeksBefore = engines.A.seeks;
    const plannedPitch = engines.A.pitchPercent;
    engines.A.displace(0.08); // 80ms of drift — inside the nudge zone
    tickAt(30.04);
    expect(engines.A.seeks).toBe(seeksBefore); // corrected WITHOUT a seek
    // The nudge rides the planned pitch against the drift (deck ahead →
    // slow down), capped at the inaudible ceiling.
    expect(engines.A.pitchPercent).toBeLessThan(plannedPitch);
    expect(plannedPitch - engines.A.pitchPercent).toBeLessThanOrEqual(0.75 + 1e-9);
    conductor.stop();
  });

  it('drift inside the deadband leaves the deck alone (no nudge, no seek)', () => {
    const { conductor, engines } = makeConductor();
    conductor.playFromEntry(0);
    tickAt(0);
    tickAt(0.01);
    tickAt(30);
    tickAt(30.02);
    const seeksBefore = engines.A.seeks;
    const plannedPitch = engines.A.pitchPercent;
    engines.A.displace(0.01); // under the 20ms deadband: estimate noise
    tickAt(30.04);
    expect(engines.A.seeks).toBe(seeksBefore);
    expect(engines.A.pitchPercent).toBe(plannedPitch);
    conductor.stop();
  });

  it('gross desync gives up nudging and re-seeks to the plan', () => {
    const { conductor, engines } = makeConductor();
    conductor.playFromEntry(0);
    tickAt(0);
    tickAt(0.01);
    tickAt(30);
    tickAt(30.02);
    const seeksBefore = engines.A.seeks;
    engines.A.displace(0.4); // past SEEK_TOLERANCE_S
    tickAt(30.04);
    expect(engines.A.seeks).toBe(seeksBefore + 1);
    expect(engines.A.getPlayhead()).toBeCloseTo(30.04, 1);
    conductor.stop();
  });
});

describe('takeover mid-Routine', () => {
  it('a manual gesture on a Routine deck stops conducting cleanly; the decks keep playing', () => {
    const { conductor, engines, stopped } = makeConductor();
    conductor.playFromEntry(0);
    tickAt(0);
    tickAt(0.01);
    tickAt(70); // mid-Routine: A and B sounding
    tickAt(70.1);
    expect(engines.B.getSnapshot().playing).toBe(true);
    engines.B.pause(); // the user grabs a Routine deck
    expect(stopped).toEqual(['takeover']);
    expect(conductor.isActive()).toBe(false);
    // The other decks keep playing as they are — the user is live.
    expect(engines.A.getSnapshot().playing).toBe(true);
  });
});

describe('exit handoff', () => {
  it('past the Routine end the exit deck keeps sounding at the recorded position; the rest park', () => {
    const { conductor, engines, plan } = makeConductor();
    const r = plan.routines[0];
    conductor.playFromEntry(0);
    tickAt(0);
    tickAt(0.01);
    tickAt(70);
    tickAt(80);
    tickAt(r.mixEndSec - 0.05);
    expect(engines.C.getSnapshot().playing).toBe(true);
    tickAt(r.mixEndSec + 0.1);
    tickAt(r.mixEndSec + 0.2);
    // Exit deck C rolls on (the downstream timeline), A/B parked.
    expect(engines.C.getSnapshot().playing).toBe(true);
    expect(engines.C.getPlayhead()).toBeCloseTo(26 + 0.2, 1);
    expect(engines.A.getSnapshot().playing).toBe(false);
    expect(engines.B.getSnapshot().playing).toBe(false);
    expect(conductor.isPlaying()).toBe(true);
    conductor.stop();
  });
});

describe('rolling junction decks (sets #143)', () => {
  /** No Routines: two pinned windows overlapping in mix time (60..80 and
   * 72..92), so the third entry allocates deck C — the Conductor must
   * drive (and watch) it exactly like a Routine-allocated deck. */
  function rollingPlan(): SetPlan {
    const facts = { durationSec: 240, bpm: 120, hotCue1Sec: null };
    const tr = (startSec: number) => ({
      startSec,
      durationSec: 20,
      bInSec: 0,
      tempoMatch: false,
      lanes: {},
    });
    const input: PlanInput = {
      entries: [
        { trackId: 1, pin: { kind: 'transition', uuid: 't1' } },
        { trackId: 2, pin: { kind: 'transition', uuid: 't2' } },
        { trackId: 3, pin: null },
      ],
      tracks: { 1: facts, 2: facts, 3: facts },
      transitionsByUuid: { t1: tr(60), t2: tr(12) },
      takesByUuid: {},
    };
    return planSet(input);
  }

  it('drives the allocated deck C through the junction: loads it, plays all three', () => {
    const plan = rollingPlan();
    expect(plan.entries.map((e) => e.deck)).toEqual(['A', 'B', 'C']);
    const { conductor, engines, loads } = makeConductor(plan);
    conductor.playFromEntry(0);
    tickAt(0);
    tickAt(0.01);
    tickAt(30);
    expect(loads.some((l) => l.deck === 'C' && l.trackId === 3)).toBe(true);
    tickAt(76); // inside both windows
    tickAt(76.1);
    expect(engines.A.getSnapshot().playing).toBe(true);
    expect(engines.B.getSnapshot().playing).toBe(true);
    expect(engines.C.getSnapshot().playing).toBe(true);
    conductor.stop();
  });

  it('a manual gesture on the junction deck C is a takeover (C is watched)', () => {
    const plan = rollingPlan();
    const { conductor, engines, stopped } = makeConductor(plan);
    conductor.playFromEntry(0);
    tickAt(0);
    tickAt(0.01);
    tickAt(76);
    tickAt(76.1);
    expect(engines.C.getSnapshot().playing).toBe(true);
    engines.C.pause(); // the user grabs the third deck
    expect(stopped).toEqual(['takeover']);
    expect(conductor.isActive()).toBe(false);
    expect(engines.A.getSnapshot().playing).toBe(true);
  });
});
