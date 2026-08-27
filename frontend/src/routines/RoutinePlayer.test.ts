/**
 * RoutinePlayer (gh#170): the Routine editor's audition conductor over
 * fake shared decks — slot→deck driving through the replay engine's own
 * evaluators, per-deck jump scoping, the audible gate, and park-on-seek.
 * Fakes in the conductorRoutine.test.ts mold.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeckEngine } from '../playback/DeckEngine';
import type { Mixer } from '../playback/mixer';
import {
  buildPlannedRoutine,
  type RoutineEventInput,
  type RoutinePlanInput,
} from '../sets/routinePlan';
import { RoutinePlayer } from './RoutinePlayer';

// ── Fakes ────────────────────────────────────────────────────────────────

class FakeEngine {
  trackId: number | null = null;
  seeks = 0;
  pitchPercent = 0;
  durationSec = 240;
  private playingFlag = false;
  private parkedAt = 0;
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
  }

  play(): void {
    if (this.playingFlag) return;
    this.playingFlag = true;
    this.anchorPos = this.parkedAt;
    this.anchorCtx = this.clock();
  }

  pause(): void {
    if (!this.playingFlag) return;
    this.parkedAt = this.getPlayhead();
    this.playingFlag = false;
  }

  setPitch(p: number): void {
    this.pitchPercent = p;
  }
  subscribe(): () => void {
    return () => {};
  }
}

type Deck = 'A' | 'B' | 'C' | 'D';
type LaneCapture = Partial<Record<Deck, { fader: number }>>;

function fakeMixer(clock: () => number, capture: LaneCapture): Mixer {
  return {
    now: clock,
    setAutomation: (ch: Deck, v: { fader: number }) => {
      capture[ch] = v;
    },
  } as unknown as Mixer;
}

// ── Synthetic recording (the conductorRoutine fixture) ──────────────────

const tick = (beat: number, playheads: Record<string, number>): RoutineEventInput => ({
  kind: 'tick',
  beat,
  playheads,
});

/** 64-beat recording on 120 BPM tracks: entries 0/16/32 beats, entry
 * positions 60/0/10 track-seconds; slot 1 carries a recorded SEEK at
 * beat 40 (position snaps +20 s). */
function recording(withJump = false): RoutinePlanInput {
  const events: RoutineEventInput[] = [];
  const entries = [0, 16, 32];
  const positions = [60, 0, 10];
  for (let b = 0; b <= 64; b += 4) {
    const playheads: Record<string, number> = {};
    for (const slot of [0, 1, 2]) {
      if (b < entries[slot]) continue;
      let pos = positions[slot] + (b - entries[slot]) * 0.5;
      if (withJump && slot === 1 && b >= 40) pos += 20;
      playheads[String(slot)] = pos;
    }
    events.push(tick(b, playheads));
  }
  events.push({ kind: 'control', beat: 16, slot: 1, control: 'fader', value: 1 });
  return {
    cast: [1, 2, 3],
    entryOffsetsBeats: entries,
    entryPositions: positions,
    durationBeats: 64,
    events,
  };
}

function planned(withJump = false) {
  return buildPlannedRoutine(recording(withJump), {
    startEntryIndex: 0,
    mixStartSec: 0,
    targetBpm: 120, // 0.5 s/beat — mix seconds = beats / 2
    adoptedDeck: 'A',
    busy: [],
    trackBpms: [120, 120, 120],
  }).routine;
}

// ── Harness ──────────────────────────────────────────────────────────────

let now = 0;
let pendingFrame: (() => void) | null = null;

function tickAt(t: number): void {
  now = t;
  const frame = pendingFrame;
  pendingFrame = null;
  frame?.();
}

function makePlayer(opts: { audible?: () => boolean; withJump?: boolean } = {}) {
  const clock = () => now;
  const engines = {
    A: new FakeEngine(clock),
    B: new FakeEngine(clock),
    C: new FakeEngine(clock),
    D: new FakeEngine(clock),
  };
  engines.A.trackId = 1;
  engines.B.trackId = 2;
  engines.C.trackId = 3;
  const lanes: LaneCapture = {};
  const player = new RoutinePlayer({
    mixer: fakeMixer(clock, lanes),
    engines: engines as unknown as Record<Deck, DeckEngine>,
    audible: opts.audible ?? (() => true),
  });
  player.setRoutine(planned(opts.withJump));
  return { player, engines, lanes };
}

beforeEach(() => {
  now = 0;
  pendingFrame = null;
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

describe('slot→deck driving', () => {
  it('slot 0 plays from its entry position; later slots park until their entries', () => {
    const { player, engines } = makePlayer();
    player.play();
    tickAt(0.05); // the trace's verdict at exactly beat 0 is the pre-entry park
    expect(engines.A.getSnapshot().playing).toBe(true);
    expect(engines.A.getPlayhead()).toBeCloseTo(60, 1);
    expect(engines.B.getSnapshot().playing).toBe(false);
    expect(engines.C.getSnapshot().playing).toBe(false);
    // Beat 16 = mix 8 s: slot 1 joins on deck B at track 0.
    tickAt(8.05);
    expect(engines.B.getSnapshot().playing).toBe(true);
    expect(engines.B.getPlayhead()).toBeCloseTo(0.05, 1); // 0.1 beats past its entry
    // Beat 32 = mix 16 s: slot 2 joins on deck C at track 10.
    tickAt(16.05);
    expect(engines.C.getSnapshot().playing).toBe(true);
    expect(engines.C.getPlayhead()).toBeCloseTo(10.03, 1);
  });

  it('recorded lanes drive the mixer overlay per slot deck', () => {
    const { player, lanes } = makePlayer();
    player.play();
    tickAt(4); // beat 8 — slot 1 not yet entered, its recorded fader defaults CLOSED
    expect(lanes.B?.fader).toBe(0);
    tickAt(8.05); // beat 16.1 — slot 1's recorded raise landed
    expect(lanes.B?.fader).toBe(1);
    expect(lanes.A?.fader).toBe(1); // slot 0 defaults open
  });

  it('ends (pauses) at the routine end', () => {
    const { player, engines } = makePlayer();
    player.play();
    tickAt(31.9);
    expect(player.isPlaying()).toBe(true);
    tickAt(32.1); // duration 64 beats = 32 s
    expect(player.isPlaying()).toBe(false);
    expect(engines.A.getSnapshot().playing).toBe(false);
  });
});

describe('deck reuse (gh#170 pass 2 — occupancy-aware driving)', () => {
  /** 64-beat, 4-slot weave where slot 0's motion ends at beat 24 (12 s)
   * and slot 3 (entry 48) reuses its deck A — slot 2 enters at beat 24
   * (12 s), INSIDE the release buffer, so it can't take A itself. */
  function reuseRecording(): RoutinePlanInput {
    const events: RoutineEventInput[] = [];
    const entries = [0, 16, 24, 48];
    const positions = [60, 0, 10, 0];
    const stops = [24, 64, 64, 64];
    for (let b = 0; b <= 64; b += 4) {
      const playheads: Record<string, number> = {};
      for (const slot of [0, 1, 2, 3]) {
        if (b < entries[slot]) continue;
        playheads[String(slot)] =
          positions[slot] + (Math.min(b, stops[slot]) - entries[slot]) * 0.5;
      }
      events.push(tick(b, playheads));
    }
    return {
      cast: [1, 2, 3, 4],
      entryOffsetsBeats: entries,
      entryPositions: positions,
      durationBeats: 64,
      events,
    };
  }

  it('an occupant flip issues the incoming load once and drives the new track after it lands', () => {
    const clock = () => now;
    const engines = {
      A: new FakeEngine(clock),
      B: new FakeEngine(clock),
      C: new FakeEngine(clock),
      D: new FakeEngine(clock),
    };
    engines.A.trackId = 1;
    engines.B.trackId = 2;
    engines.C.trackId = 3;
    const loads: Array<{ deck: Deck; trackId: number }> = [];
    const lanes: LaneCapture = {};
    const player = new RoutinePlayer({
      mixer: fakeMixer(clock, lanes),
      engines: engines as unknown as Record<Deck, DeckEngine>,
      loadTrack: (deck, trackId) => loads.push({ deck: deck as Deck, trackId }),
    });
    const planned = buildPlannedRoutine(reuseRecording(), {
      startEntryIndex: 0,
      mixStartSec: 0,
      targetBpm: 120,
      adoptedDeck: 'A',
      busy: [],
      trackBpms: [120, 120, 120, 120],
    });
    expect(planned.warnings).toEqual([]);
    expect(planned.routine.slots.map((s) => s.deck)).toEqual(['A', 'B', 'C', 'A']);
    player.setRoutine(planned.routine);

    player.play();
    tickAt(5); // slot 0 mid-motion on A
    expect(engines.A.getSnapshot().playing).toBe(true);
    // Slot 0's motion ends at beat 24 (12 s); slot 3's occupancy opens
    // there — the player asks for track 4 exactly once and parks A.
    tickAt(13);
    tickAt(13.1);
    expect(loads).toEqual([{ deck: 'A', trackId: 4 }]);
    expect(engines.A.getSnapshot().playing).toBe(false);
    // The load lands → A parks at slot 3's recorded posture, then plays
    // its entry at beat 48 (24 s).
    engines.A.trackId = 4;
    tickAt(14);
    expect(engines.A.getSnapshot().playing).toBe(false);
    tickAt(24.6);
    expect(engines.A.getSnapshot().playing).toBe(true);
    expect(engines.A.getPlayhead()).toBeCloseTo(0.3, 0);
    // One load ever — no re-requests while the target held.
    expect(loads.length).toBe(1);
  });
});

describe('per-deck jump scoping (#161 doctrine)', () => {
  it('a recorded seek on slot 1 hard-syncs deck B only', () => {
    const { player, engines } = makePlayer({ withJump: true });
    player.play();
    tickAt(19.5); // settle before the jump (beat 39)
    const seeksA = engines.A.seeks;
    const seeksB = engines.B.seeks;
    tickAt(20.05); // crossing beat 40 — slot 1's recorded discontinuity
    expect(engines.B.seeks).toBe(seeksB + 1);
    expect(engines.A.seeks).toBe(seeksA);
  });
});

describe('the audible gate', () => {
  it('play refuses while not audible; losing the claim mid-audition pauses', () => {
    let audible = false;
    const { player, engines } = makePlayer({ audible: () => audible });
    player.play();
    expect(player.isPlaying()).toBe(false);
    audible = true;
    player.play();
    expect(player.isPlaying()).toBe(true);
    audible = false;
    tickAt(1);
    expect(player.isPlaying()).toBe(false);
    expect(engines.A.getSnapshot().playing).toBe(false);
  });

  it('a paused seek parks the slot decks on the recorded positions (audible only)', () => {
    const { player, engines } = makePlayer();
    player.seek(16.05); // beat ~32
    expect(engines.A.getPlayhead()).toBeCloseTo(76, 0); // 60 + 16 s of trace
    expect(engines.C.getPlayhead()).toBeCloseTo(10, 0);
    expect(engines.A.getSnapshot().playing).toBe(false);
  });

  it('a silent editor’s seek never touches the decks', () => {
    const { player, engines } = makePlayer({ audible: () => false });
    const before = engines.A.seeks;
    player.seek(10);
    expect(engines.A.seeks).toBe(before);
  });
});
