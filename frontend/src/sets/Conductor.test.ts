/**
 * Conductor drive-loop tests (sets 04) — the deck-join alignment bug.
 *
 * The platform fact these fakes model (ADR 0018 anchor math): a start
 * command posted to the worklet begins rendering at a later render-quantum
 * boundary. Starts posted in the SAME task drain together and share that
 * boundary (equal latency); starts in different tasks do not. The engine's
 * playhead ESTIMATE anchors at post time, so the Conductor's drift check —
 * estimate vs plan, both on the audio clock — reads ~0 regardless of what
 * the audio actually does: actual-vs-estimate offsets are invisible to it.
 *
 * The reported bug: deck B joins mid-set (its window entry) in its own
 * task, so its start latency differs from A's — the decks sound a constant
 * few-to-tens-of-ms flam ("clashing") that no drift correction can see.
 * Pausing and resuming fixed it because resume restarts BOTH decks in one
 * task. The fix automates exactly that: a join hard-syncs every playing
 * deck in the same task.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetAudibleSurfacesForTests } from '../playback/audibleSurface';
import type { DeckEngine } from '../playback/DeckEngine';
import type { ChannelId, Mixer } from '../playback/mixer';
import type { Transition } from '../editor/mixModel';
import { Conductor } from './Conductor';
import { planSet, planStateAt, type PlanAutomation, type SetPlan } from './planner';

// ── Fakes ──────────────────────────────────────────────────────────────

/** Deterministic "audio thread": a start posted at clock time `t` becomes
 * audible at `t + latencyByPostTime(t)` — same post instant, same boundary. */
class FakeEngine {
  trackId: number | null = null;
  seeks = 0;
  /** Last pitch commanded, and the full command log (re-plan ramp
   * shape assertions — sets 24). Playhead advance ignores pitch. */
  pitchPercent = 0;
  pitches: number[] = [];
  /** Decoded-buffer duration the snapshot reports (may differ from the
   * plan's metadata duration — the mp3-estimate mismatch). */
  durationSec = 120;
  private playingFlag = false;
  private parkedAt = 0;
  private subs = new Set<() => void>();
  /** Estimate anchor (post time — mirrors DeckEngine.beginStart). */
  private anchorPos = 0;
  private anchorCtx = 0;
  /** When the audio ACTUALLY begins advancing from anchorPos. */
  private actualStartCtx = 0;

  private readonly clock: () => number;
  private readonly latencyOf: (postTime: number) => number;

  constructor(clock: () => number, latencyOf: (postTime: number) => number) {
    this.clock = clock;
    this.latencyOf = latencyOf;
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

  /** The engine's estimate: anchored at post time (the real anchor math). */
  getPlayhead(): number {
    if (!this.playingFlag) return this.parkedAt;
    return this.anchorPos + (this.clock() - this.anchorCtx);
  }

  /** What the ears hear: audio begins at the start's quantum boundary. */
  actualPosition(): number {
    if (!this.playingFlag) return this.parkedAt;
    return this.anchorPos + Math.max(0, this.clock() - this.actualStartCtx);
  }

  private splice(at: number): void {
    const now = this.clock();
    this.anchorPos = at;
    this.anchorCtx = now;
    this.actualStartCtx = now + this.latencyOf(now);
  }

  seek(t: number): void {
    this.seeks++;
    if (this.playingFlag) this.splice(t);
    else this.parkedAt = t;
    this.emit();
  }

  play(): void {
    if (this.playingFlag) return;
    this.playingFlag = true;
    this.splice(this.parkedAt);
    this.emit();
  }

  pause(): void {
    if (!this.playingFlag) return;
    this.parkedAt = this.getPlayhead();
    this.playingFlag = false;
    this.emit();
  }

  /** The worklet ran off the end of the buffer (DeckEngine.handleEnded):
   * the engine parks itself at the decoded duration and emits — OUTSIDE
   * any conductor call. */
  finishTrack(): void {
    if (!this.playingFlag) return;
    this.parkedAt = this.durationSec;
    this.playingFlag = false;
    this.emit();
  }

  setPitch(p: number): void {
    this.pitchPercent = p;
    this.pitches.push(p);
  }
  setBend(): void {}
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

type LaneCapture = { A: PlanAutomation | null; B: PlanAutomation | null };

function fakeMixer(clock: () => number, capture?: LaneCapture): Mixer {
  const channel = { fader: 1, trim: 0.5, eq: { low: 0.5, mid: 0.5, high: 0.5 }, filter: 0, pfl: false };
  return {
    now: clock,
    engageAutomation: () => {},
    disengageAutomation: () => {},
    setAutomation: (ch: 'A' | 'B', v: PlanAutomation) => {
      if (capture) capture[ch] = v;
    },
    subscribe: () => () => {},
    getChannelState: () => channel,
    getCrossfader: () => 0,
    getCrossfaderEnabled: () => true,
    getMaster: () => 1,
    setFader: () => {},
    setEq: () => {},
    setFilter: () => {},
    setCrossfader: () => {},
  } as unknown as Mixer;
}

/** Two 120s tracks, one 10s transition window at A's t=60 (B enters at its
 * own t=0): decks overlap for mix 60..70. */
function overlapPlan(): SetPlan {
  const transition: Transition = {
    startSec: 60,
    durationSec: 10,
    bInSec: 0,
    tempoMatch: false,
    lanes: {},
  };
  return planSet({
    entries: [
      { trackId: 1, pin: { kind: 'transition', uuid: 't1' } },
      { trackId: 2, pin: null },
    ],
    tracks: {
      1: { durationSec: 120, bpm: null, hotCue1Sec: null },
      2: { durationSec: 120, bpm: null, hotCue1Sec: null },
    },
    transitionsByUuid: { t1: transition },
    takesByUuid: {},
  });
}

/** Two tracks, unresolved adjacency: hard cut at track 1's end (metadata
 * duration `dur1`), track 2 entering at 20s. */
function hardCutPlan(dur1 = 120): SetPlan {
  return planSet({
    entries: [
      { trackId: 1, pin: null },
      { trackId: 2, pin: null },
    ],
    tracks: {
      1: { durationSec: dur1, bpm: null, hotCue1Sec: null },
      2: { durationSec: 120, bpm: null, hotCue1Sec: 20 },
    },
    transitionsByUuid: {},
    takesByUuid: {},
  });
}

// ── Harness ────────────────────────────────────────────────────────────

let now = 0;
let pendingFrame: (() => void) | null = null;

/** Advance the clock and run the Conductor's scheduled tick. */
function tickAt(t: number): void {
  now = t;
  const frame = pendingFrame;
  pendingFrame = null;
  frame?.();
}

function makeConductor(latencyOf: (postTime: number) => number, plan: SetPlan = overlapPlan()) {
  const clock = () => now;
  const engines = { A: new FakeEngine(clock, latencyOf), B: new FakeEngine(clock, latencyOf) };
  const stopped: string[] = [];
  const lanes: LaneCapture = { A: null, B: null };
  const conductor = new Conductor(
    plan,
    { mixer: fakeMixer(clock, lanes), engines: engines as unknown as Record<ChannelId, DeckEngine> },
    {
      loadTrack: (deck, trackId) => {
        engines[deck].trackId = trackId;
      },
      onStopped: (reason) => stopped.push(reason),
    }
  );
  return { conductor, engines, plan, stopped, lanes };
}

/** Per-deck actual-audio offset from its plan position at mix time t. */
function actualOffsets(
  engines: { A: FakeEngine; B: FakeEngine },
  plan: SetPlan,
  t: number
): { A: number; B: number } {
  const state = planStateAt(plan, t);
  return {
    A: engines.A.actualPosition() - state.decks.A.trackTime,
    B: engines.B.actualPosition() - state.decks.B.trackTime,
  };
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

describe('natural end-of-track at a hard cut (the "conductor stops instead of cutting" bug)', () => {
  // A hard-cut outgoing plays to its literal buffer end, so the worklet's
  // 'ended' always fires there: the engine parks itself (playing→false)
  // and emits OUTSIDE any conductor call. That self-park is the deck's
  // own doing — it must not read as a manual-gesture takeover.
  const latency = () => 0.002;

  it('does not stop when the outgoing ends exactly at the cut; the incoming still enters', () => {
    const { conductor, engines, stopped } = makeConductor(latency, hardCutPlan());
    conductor.playFromEntry(0);
    tickAt(0); // load-freeze tick
    tickAt(0.01); // A starts
    tickAt(60); // mid-track
    // The buffer runs out at the cut instant, between ticks.
    now = 120;
    engines.A.finishTrack();
    expect(stopped).toEqual([]);
    tickAt(120.02); // the tick after the cut: B joins at its entry
    tickAt(120.05);
    expect(conductor.isPlaying()).toBe(true);
    expect(engines.B.getSnapshot().playing).toBe(true);
    conductor.stop();
  });

  it('rides out a metadata tail (decoded audio shorter than the plan) without restarting the dead deck', () => {
    // Plan exit at 122 (metadata), decoded buffer 120: the deck ends 2s
    // "early" while the plan still has it audible.
    const { conductor, engines, stopped } = makeConductor(latency, hardCutPlan(122));
    conductor.playFromEntry(0);
    tickAt(0);
    tickAt(0.01);
    now = 120;
    engines.A.finishTrack();
    expect(stopped).toEqual([]);
    const seeksAfterEnd = engines.A.seeks;
    tickAt(120.5); // inside the metadata tail
    tickAt(121.5);
    // The exhausted deck stays parked — no per-tick restart churn.
    expect(engines.A.seeks).toBe(seeksAfterEnd);
    expect(engines.A.getSnapshot().playing).toBe(false);
    tickAt(122.1); // past the cut: the incoming enters
    tickAt(122.2);
    expect(conductor.isPlaying()).toBe(true);
    expect(engines.B.getSnapshot().playing).toBe(true);
    conductor.stop();
  });

  it('a manual pause mid-track is still a takeover', () => {
    const { conductor, engines, stopped } = makeConductor(latency, hardCutPlan());
    conductor.playFromEntry(0);
    tickAt(0);
    tickAt(0.01);
    now = 60;
    engines.A.pause(); // user hits pause far from the track end
    expect(stopped).toEqual(['takeover']);
  });
});

describe('deck-join alignment (the set-playback clash bug)', () => {
  // Start latency: 2ms for everything posted at mix start, 20ms for the
  // task where B joins — different tasks, different quantum boundaries.
  const latency = (postTime: number) => (postTime < 1 ? 0.002 : 0.02);

  it('a deck joining mid-set does not leave the decks audibly misaligned', () => {
    const { conductor, engines, plan } = makeConductor(latency);
    conductor.playFromEntry(0);
    tickAt(0); // loads requested; the load-latency freeze holds this tick
    tickAt(0.01); // A starts (latency 2ms)
    tickAt(60.2); // B joins inside the window (latency 20ms)
    tickAt(65); // mid-overlap
    const off = actualOffsets(engines, plan, 65);
    // Relative misalignment is the audible clash; each deck's absolute
    // offset (its own start latency) is inaudible.
    expect(Math.abs(off.A - off.B)).toBeLessThan(0.003);
    conductor.stop();
  });

  it('the join realigns by restarting in ONE task, not by per-tick reseeking', () => {
    const { conductor, engines } = makeConductor(latency);
    conductor.playFromEntry(0);
    tickAt(0); // load-freeze tick
    tickAt(0.01); // A starts
    tickAt(60.2); // the join
    const seeksAfterJoin = engines.A.seeks;
    tickAt(61);
    tickAt(62);
    tickAt(65);
    // Steady overlap: no further corrective churn on the running deck.
    expect(engines.A.seeks).toBe(seeksAfterJoin);
    conductor.stop();
  });

  it('the running deck is restarted at its own plan position (audio continuity)', () => {
    const { conductor, engines, plan } = makeConductor(latency);
    conductor.playFromEntry(0);
    tickAt(0); // load-freeze tick
    tickAt(0.01); // A starts
    tickAt(60.2);
    // Immediately after the join tick, A's estimate sits at its plan
    // position for that instant — the restart is a re-anchor, not a jump.
    const state = planStateAt(plan, 60.2);
    expect(engines.A.getPlayhead()).toBeCloseTo(state.decks.A.trackTime, 6);
    conductor.stop();
  });
});

describe('live re-plan (sets 24: replacePlan)', () => {
  const latency = () => 0.002;

  /** overlapPlan variants: window at `windowStart` (default 60), 10s,
   * B in at 0; both tracks 120 BPM (Riding default keeps rates at 1). */
  function planWith(
    opts: {
      windowStart?: number;
      lanes?: Transition['lanes'];
      pinned?: boolean;
      fixedTempoBpm?: number;
    } = {}
  ): SetPlan {
    const transition: Transition = {
      startSec: opts.windowStart ?? 60,
      durationSec: 10,
      bInSec: 0,
      tempoMatch: false,
      lanes: opts.lanes ?? {},
    };
    return planSet({
      entries: [
        { trackId: 1, pin: (opts.pinned ?? true) ? { kind: 'transition', uuid: 't1' } : null },
        { trackId: 2, pin: null },
      ],
      tracks: {
        1: { durationSec: 120, bpm: 120, hotCue1Sec: null },
        2: { durationSec: 120, bpm: 120, hotCue1Sec: null },
      },
      transitionsByUuid: { t1: transition },
      takesByUuid: {},
      tempo: opts.fixedTempoBpm
        ? { policy: 'fixed', setTempoBpm: opts.fixedTempoBpm }
        : undefined,
    });
  }

  it('swaps the plan mid-solo without touching the anchor deck; the handover follows the new geometry', () => {
    const { conductor, engines } = makeConductor(latency, planWith());
    conductor.playFromEntry(0);
    tickAt(0); // load-freeze tick
    tickAt(0.01); // A starts
    tickAt(30);
    const seeks = engines.A.seeks;
    conductor.replacePlan(planWith({ windowStart: 65 }), 30, { rampSec: 1.5 });
    tickAt(30.05);
    tickAt(62); // the OLD window (60..70) would already have B sounding
    expect(engines.B.getSnapshot().playing).toBe(false);
    expect(engines.A.seeks).toBe(seeks); // the anchor was never re-seeked
    expect(engines.A.getSnapshot().playing).toBe(true);
    tickAt(66); // the NEW window (65..75): B joins
    tickAt(66.05);
    expect(engines.B.getSnapshot().playing).toBe(true);
    expect(conductor.isPlaying()).toBe(true);
    conductor.stop();
  });

  it("a tempo re-plan eases the playing deck's pitch instead of snapping", () => {
    const { conductor, engines } = makeConductor(latency, planWith());
    conductor.playFromEntry(0);
    tickAt(0);
    tickAt(0.01);
    tickAt(30);
    expect(engines.A.pitchPercent).toBe(0);
    // Fixed Set tempo 126 over 120 BPM tracks: +5% everywhere. The
    // remapped instant keeps the anchor's track-time: mix 30/1.05.
    conductor.replacePlan(planWith({ fixedTempoBpm: 126 }), 30 / 1.05, { rampSec: 2 });
    const seeks = engines.A.seeks;
    tickAt(31); // mid-ramp (startAudio 30, duration 2)
    expect(engines.A.pitchPercent).toBeGreaterThan(0);
    expect(engines.A.pitchPercent).toBeLessThan(5);
    tickAt(32.05); // ramp complete
    expect(engines.A.pitchPercent).toBeCloseTo(5, 6);
    // Never re-seeked while converging (the pickup no-touch rule).
    expect(engines.A.seeks).toBe(seeks);
    conductor.stop();
  });

  it('lane edits inside the sounding window apply immediately; a collapsing window converges by ramp', () => {
    const { conductor, lanes } = makeConductor(latency, planWith());
    conductor.playFromEntry(0);
    tickAt(0);
    tickAt(0.01);
    tickAt(65); // mid-window (60..70): both decks sounding
    const edited = planWith({ lanes: { faderA: [{ x: 0, y: 0.25 }] } });
    conductor.replacePlan(edited, 65, { rampSec: 1.5 });
    tickAt(65.05);
    // Same window keeps sounding: the new value lands EXACTLY (no lerp).
    expect(lanes.A!.fader).toBeCloseTo(0.25, 6);
    // Unpin: the window collapses at the playhead (hard cut at 120) —
    // the anchor solos in the new plan and its fader converges, never
    // snaps, from the sounding 0.25 toward solo 1.
    conductor.replacePlan(planWith({ pinned: false }), 65.1, { rampSec: 1.5 });
    tickAt(65.2);
    expect(lanes.A!.fader).toBeGreaterThan(0.25);
    expect(lanes.A!.fader).toBeLessThan(0.99);
    conductor.stop();
  });
});
