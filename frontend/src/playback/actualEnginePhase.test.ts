/**
 * ACTUAL engine phase at machine starts (#173) — real DeckEngines under a
 * real Conductor / MixPlayer, fake clock and worklet.
 *
 * The bug: flow-in (the playhead flowing naturally into a Transition
 * window), seek-in (clicking into the middle of the window), and editor
 * auditions landed audibly different A/B alignment. Root cause: machine
 * conductors started a paused deck via the performer path (`seek(t);
 * play()`), and a paused deck's play routes through the cross-deck
 * QUANTIZED launch (cue-quantize-bpm 04, Quantize defaults ON): the join
 * enters up to half a reference-beat AHEAD of the planned position
 * (|Δ|·rate ahead-entry) or deferred by Δ — riding the sounding deck's
 * live beat phase at the join instant, which is arbitrary. Sub-tolerance
 * offsets (< the Conductor's 120ms drift check) then persist for the
 * whole window. Seek-in restarts already-playing decks through the exact
 * `seek` path, so the two arrival modes disagreed; each editor audition
 * sampled a different peer phase, so runs of the same artifact disagreed
 * with each other.
 *
 * These tests assert ACTUAL engine playheads (#166's tests assert planned
 * phase only). The fake worklet node has zero start latency and both
 * engines share one clock, so the engine playhead IS the audible phase —
 * any divergence here is real, not estimate error.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeckEngine } from './DeckEngine';
import { _clearBufferCacheForTests, putCachedBuffer } from './bufferCache';
import type { DeckAudioPort } from './mixer';
import type { ChannelId, Mixer } from './mixer';
import { setQuantize } from './quantizeStore';
import { _resetAudibleSurfacesForTests } from './audibleSurface';
import { Conductor } from '../sets/Conductor';
import { planSet, planStateAt, type SetPlan } from '../sets/planner';
import { MixPlayer } from '../editor/MixPlayer';
import type { EditorMix, Transition } from '../editor/mixModel';

// ── Fake worklet node (zero start latency, shared clock) ───────────────

interface StartRecord {
  deck: string;
  positionSec: number;
  postNow: number;
}
const startLog: StartRecord[] = [];
let sharedNow = 0;

vi.mock('./worklet/deckSourceNode', () => {
  class FakeDeckSourceNode {
    static create = vi.fn(
      async (ctx: AudioContext) => new FakeDeckSourceNode(ctx)
    );
    ctx: AudioContext;
    onEnded: ((startId: number) => void) | null = null;
    constructor(ctx: AudioContext) {
      this.ctx = ctx;
    }
    loadTrack(): void {}
    start(positionFrames: number): void {
      startLog.push({
        deck: (this.ctx as unknown as { deckLabel: string }).deckLabel,
        positionSec: positionFrames / 44100,
        postNow: sharedNow,
      });
    }
    stop(): void {}
    setMode(): void {}
    setLoop(): void {}
    setRateAt(): void {}
    connect(): void {}
    disconnect(): void {}
  }
  return { DeckSourceNode: FakeDeckSourceNode };
});

// ── Shared-clock audio fakes ───────────────────────────────────────────

const fakeBuffer = {
  duration: 180,
  sampleRate: 44100,
  numberOfChannels: 1,
  getChannelData: () => new Float32Array(44100),
} as unknown as AudioBuffer;

/** 120 BPM grid from 0s: beats every 0.5s across the whole track. */
const grid120 = Array.from({ length: 360 }, (_, i) => i * 0.5);

function fakePort(deckLabel: string): DeckAudioPort {
  const ctx = {
    deckLabel,
    get currentTime() {
      return sharedNow;
    },
    state: 'running' as AudioContextState,
    resume: () => Promise.resolve(),
  };
  const input = {} as AudioNode;
  return { ensureAudio: () => ({ ctx: ctx as unknown as AudioContext, input }) };
}

/** Real engines wired like DeckContext's shared Decks: cross-deck launch
 * references both ways (cue-quantize-bpm 04). */
function makeEngines(): { A: DeckEngine; B: DeckEngine } {
  const A = new DeckEngine(fakePort('A'));
  const B = new DeckEngine(fakePort('B'));
  A.setLaunchReferenceProvider(() => B.asLaunchReference());
  B.setLaunchReferenceProvider(() => A.asLaunchReference());
  return { A, B };
}

async function loadEngine(engine: DeckEngine, trackId: number): Promise<void> {
  putCachedBuffer(trackId, fakeBuffer);
  await engine.load({
    trackId,
    audioUrl: 'http://127.0.0.1:1/none',
    bpm: 120,
    beatTimes: Promise.resolve(grid120),
  });
}

/** Flush microtasks (async worklet-node builds resolve on them). */
async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

function fakeMixer(): Mixer {
  const channel = {
    fader: 1,
    trim: 0.5,
    eq: { low: 0.5, mid: 0.5, high: 0.5 },
    filter: 0,
    pfl: false,
  };
  return {
    now: () => sharedNow,
    engageAutomation: () => Symbol('token'),
    disengageAutomation: () => {},
    setAutomation: () => {},
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

// ── Conductor harness ──────────────────────────────────────────────────

let pendingFrame: (() => void) | null = null;

/** Advance the shared clock and run the Conductor's scheduled tick. */
function tickAt(t: number): void {
  sharedNow = t;
  const frame = pendingFrame;
  pendingFrame = null;
  frame?.();
}

/** Two 180s tracks at 120 BPM, one 10s transition window opening at A's
 * t=60 (a gridline); B enters at its own t=0. */
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
      1: { durationSec: 180, bpm: 120, hotCue1Sec: null },
      2: { durationSec: 180, bpm: 120, hotCue1Sec: null },
    },
    transitionsByUuid: { t1: transition },
    takesByUuid: {},
  });
}

function makeConductor(plan: SetPlan) {
  const engines = makeEngines();
  const loads: Promise<void>[] = [];
  const conductor = new Conductor(
    plan,
    {
      mixer: fakeMixer(),
      engines: engines as unknown as Record<ChannelId, DeckEngine>,
    },
    {
      loadTrack: (deck, trackId) => {
        loads.push(loadEngine(engines[deck as 'A' | 'B'], trackId));
      },
      onStopped: () => {},
    }
  );
  return { conductor, engines, loads };
}

/** Deck B's actual-vs-planned offset at mix time t (engine playhead is
 * the audible phase here — zero-latency fake node, shared clock). */
function actualErrorB(engines: { B: DeckEngine }, plan: SetPlan, t: number): number {
  return engines.B.getPlayhead() - planStateAt(plan, t).decks.B.trackTime;
}

/** Drive a fresh conductor into playback just before the window, loads
 * settled, deck A sounding solo at exactly its planned position. */
async function playingBeforeWindow(plan: SetPlan) {
  const made = makeConductor(plan);
  made.conductor.seek(59);
  made.conductor.play();
  tickAt(0); // requests loads; clock frozen (nothing sounding yet)
  await Promise.all(made.loads);
  await flush();
  tickAt(0.001); // both ready: A joins at its plan position
  await flush(); // A's worklet node builds and starts
  return made;
}

beforeEach(() => {
  vi.useFakeTimers();
  sharedNow = 0;
  startLog.length = 0;
  pendingFrame = null;
  setQuantize(true); // the app default — the condition under test
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
  _clearBufferCacheForTests();
  setQuantize(true);
});

describe('Conductor actual phase: flow-in vs seek-in (#173)', () => {
  it('flow-in lands B at its planned position (not shifted onto A\'s beat phase)', async () => {
    const plan = overlapPlan();
    const { conductor, engines } = await playingBeforeWindow(plan);

    // Flow into the window: first tick inside it lands at mix 60.1 — A's
    // beat phase there is 0.1 (mid-beat), the worst case the quantized
    // launch turns into a 100ms ahead-entry (sub-drift-tolerance, so it
    // would persist for the whole window).
    tickAt(1.101); // mix t = 60.1: B joins
    await flush();
    expect(conductor.isPlaying()).toBe(true);
    expect(engines.B.getSnapshot().playing).toBe(true);

    const err = actualErrorB(engines, plan, 60.1);
    expect(Math.abs(err)).toBeLessThan(0.005);
  });

  it('flow-in and seek-in agree within a few ms', async () => {
    const plan = overlapPlan();
    const { conductor, engines } = await playingBeforeWindow(plan);

    // Flow-in.
    tickAt(1.101); // mix t = 60.1
    await flush();
    tickAt(1.117); // settle one more frame
    const flowInErr = actualErrorB(engines, plan, conductor.getMixTime());

    // Seek-in to the same spot mid-window (a Conductor seek is plan
    // evaluation at a mix-time instant — must land identical positions).
    conductor.seek(60.1);
    tickAt(1.133); // hard sync applies
    await flush();
    const seekInErr = actualErrorB(engines, plan, conductor.getMixTime());

    expect(Math.abs(seekInErr)).toBeLessThan(0.005);
    expect(Math.abs(flowInErr - seekInErr)).toBeLessThan(0.005);
  });

  it('a join never defers behind the reference beat — B sounds at the join instant', async () => {
    const plan = overlapPlan();
    const { engines } = await playingBeforeWindow(plan);

    // Join at mix 60.3: A's nearest beat is 0.2s AHEAD (60.5), the branch
    // that used to hold B's start behind a 200ms timer (silent entry,
    // then a drift-check re-seek ~120ms late).
    startLog.length = 0;
    tickAt(1.301); // mix t = 60.3: B joins
    await flush();

    const bStarts = startLog.filter((s) => s.deck === 'B');
    expect(bStarts).toHaveLength(1);
    expect(bStarts[0].postNow).toBeCloseTo(1.301, 6);
    expect(bStarts[0].positionSec).toBeCloseTo(0.301, 2);
    expect(engines.B.getPlayhead()).toBeCloseTo(0.301, 2);
  });

  it('several seek offsets into the window all land exact', async () => {
    const plan = overlapPlan();
    const { conductor, engines } = await playingBeforeWindow(plan);
    tickAt(1.101);
    await flush();

    let now = 1.101;
    for (const offset of [0.07, 0.13, 0.26, 0.41]) {
      conductor.seek(60 + offset);
      now += 0.016;
      tickAt(now);
      await flush();
      const err = actualErrorB(engines, plan, conductor.getMixTime());
      expect(Math.abs(err)).toBeLessThan(0.005);
    }
  });
});

describe('DeckEngine.playAt — the machine-grade start seam (#173)', () => {
  it('starts a paused deck exactly at the requested position despite an audible gridded peer', async () => {
    const engines = makeEngines();
    await loadEngine(engines.A, 1);
    await loadEngine(engines.B, 2);
    engines.A.seek(10.3); // off-beat peer phase
    engines.A.play();
    await flush();

    startLog.length = 0;
    engines.B.playAt(20.1); // off the peer's beat by 0.2
    await flush();

    const bStarts = startLog.filter((s) => s.deck === 'B');
    expect(bStarts).toHaveLength(1); // immediate — never deferred
    expect(bStarts[0].positionSec).toBeCloseTo(20.1, 3);
    expect(engines.B.getPlayhead()).toBeCloseTo(20.1, 3);
    expect(engines.B.getSnapshot().playing).toBe(true);
  });

  it('restarts a playing deck exactly (seek parity)', async () => {
    const engines = makeEngines();
    await loadEngine(engines.A, 1);
    await loadEngine(engines.B, 2);
    engines.A.seek(10.3);
    engines.A.play();
    engines.B.seek(5);
    engines.B.play(); // performer start; position irrelevant here
    await vi.advanceTimersByTimeAsync(300); // let any deferred launch land
    await flush();

    startLog.length = 0;
    engines.B.playAt(20.1);
    await flush();
    const bStarts = startLog.filter((s) => s.deck === 'B');
    expect(bStarts).toHaveLength(1);
    expect(bStarts[0].positionSec).toBeCloseTo(20.1, 3);
    expect(engines.B.getPlayhead()).toBeCloseTo(20.1, 3);
  });
});

describe('editor audition actual phase (#173)', () => {
  function auditionMix(): EditorMix {
    return {
      trackAId: 1,
      trackBId: 2,
      transition: {
        startSec: 60,
        durationSec: 10,
        bInSec: 0,
        tempoMatch: false,
        lanes: {},
      },
    };
  }

  async function makePlayer() {
    const engines = makeEngines();
    await loadEngine(engines.A, 1);
    await loadEngine(engines.B, 2);
    const player = new MixPlayer(auditionMix(), {
      mixer: fakeMixer(),
      engineA: engines.A,
      engineB: engines.B,
    });
    return { player, engines };
  }

  /** B's actual offset from the drawn alignment: with bInSec 0 and unity
   * rate, B's track time inside the window is (mixTime − startSec). */
  function alignmentErrorB(engines: { B: DeckEngine }, mixTime: number): number {
    return engines.B.getPlayhead() - (mixTime - 60);
  }

  it('a mid-window audition starts B at the drawn alignment', async () => {
    const { player, engines } = await makePlayer();
    player.seek(60.1);
    player.play();
    await flush();
    expect(engines.B.getSnapshot().playing).toBe(true);
    expect(Math.abs(alignmentErrorB(engines, 60.1))).toBeLessThan(0.005);
  });

  it('repeated auditions of the same artifact land identical alignment', async () => {
    const { player, engines } = await makePlayer();

    player.seek(60.1);
    player.play();
    await flush();
    const firstErr = alignmentErrorB(engines, 60.1);

    player.pause();
    sharedNow += 1;
    player.seek(60.2); // a different scrub point — a different A phase
    player.play();
    await flush();
    const secondErr = alignmentErrorB(engines, 60.2);

    expect(Math.abs(firstErr - secondErr)).toBeLessThan(0.005);
    expect(Math.abs(secondErr)).toBeLessThan(0.005);
  });
});
