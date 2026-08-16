/**
 * Session replay driver tests (sessions 05): seed/cue/sync application,
 * refusals, and takeover semantics — fake engines + a notifying fake
 * mixer + a manual clock (the Conductor suite's mold, four decks). The
 * real audibleSurface singleton arbitrates, as in production.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeckEngine } from '../playback/DeckEngine';
import type { ChannelId, Mixer } from '../playback/mixer';
import { audibleHolder } from '../playback/audibleSurface';
import type { CaptureEvent } from '../capture/events';
import { planReplay } from './replayPlanner';
import type { ReplayPlan } from './replayPlanner';
import { SessionReplayDriver } from './SessionReplayDriver';
import type { ReplayStopReason } from './SessionReplayDriver';

// ── Fakes ────────────────────────────────────────────────────────────────

class FakeEngine {
  trackId: number | null = null;
  playing = false;
  playhead = 0;
  playheadAt = 0;
  pitchPercent = 0;
  seeks: number[] = [];
  private subs = new Set<() => void>();
  private taps = new Set<() => void>();
  private readonly clock: () => number;

  constructor(clock: () => number) {
    this.clock = clock;
  }

  getSnapshot() {
    return {
      trackId: this.trackId,
      loadState: this.trackId === null ? 'empty' : 'ready',
      playing: this.playing,
      duration: 600,
      pitchPercent: this.pitchPercent,
      bendPercent: 0,
      previewing: false,
      hotCuePreviewSlot: null,
      keyLock: true,
    } as ReturnType<DeckEngine['getSnapshot']>;
  }

  getPlayhead(): number {
    return this.playing ? this.playhead + (this.clock() - this.playheadAt) : this.playhead;
  }

  seek(t: number): void {
    this.seeks.push(t);
    this.playhead = t;
    this.playheadAt = this.clock();
    this.emit();
  }

  play(): void {
    if (this.playing) return;
    this.playhead = this.getPlayhead();
    this.playheadAt = this.clock();
    this.playing = true;
    this.emit();
  }

  pause(): void {
    if (!this.playing) return;
    this.playhead = this.getPlayhead();
    this.playing = false;
    this.emit();
  }

  setPitch(p: number): void {
    this.pitchPercent = p;
    this.emit();
  }

  /** The load path completing: trackId lands + ready, emits (async flow). */
  finishLoad(trackId: number): void {
    this.trackId = trackId;
    this.playing = false;
    this.playhead = 0;
    this.emit();
  }

  /** A HUMAN transport gesture (outside any driver call). */
  humanPause(): void {
    this.pause();
  }

  /** A HUMAN seek through the transport tap. */
  humanSeekGesture(): void {
    for (const fn of this.taps) fn();
  }

  subscribe(fn: () => void): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }

  addTransportEventListener(fn: () => void): () => void {
    this.taps.add(fn);
    return () => this.taps.delete(fn);
  }

  private emit(): void {
    for (const fn of this.subs) fn();
  }
}

interface ChannelShape {
  fader: number;
  trim: number;
  eq: { low: number; mid: number; high: number };
  filter: number;
  pfl: boolean;
}

type LaneShape = { fader: number; eq: { low: number; mid: number; high: number }; filter: number };

class FakeMixer {
  /** The automation overlay (null = disengaged). Writes never notify. */
  automation: Partial<Record<ChannelId, LaneShape>> | null = null;
  channels: Record<ChannelId, ChannelShape> = {
    A: freshChannel(),
    B: freshChannel(),
    C: freshChannel(),
    D: freshChannel(),
  };
  crossfader = 0;
  crossfaderEnabled = true;
  master = 0.5;
  assignments: Record<ChannelId, string> = { A: 'left', B: 'right', C: 'left', D: 'right' };
  private subs = new Set<() => void>();
  private readonly clock: () => number;

  constructor(clock: () => number) {
    this.clock = clock;
  }

  now(): number {
    return this.clock();
  }

  setFader(ch: ChannelId, v: number): void {
    this.channels[ch] = { ...this.channels[ch], fader: v };
    this.notify();
  }
  setTrim(ch: ChannelId, v: number): void {
    this.channels[ch] = { ...this.channels[ch], trim: v };
    this.notify();
  }
  setEq(ch: ChannelId, band: 'low' | 'mid' | 'high', v: number): void {
    this.channels[ch] = { ...this.channels[ch], eq: { ...this.channels[ch].eq, [band]: v } };
    this.notify();
  }
  setFilter(ch: ChannelId, v: number): void {
    this.channels[ch] = { ...this.channels[ch], filter: v };
    this.notify();
  }
  setPfl(ch: ChannelId, v: boolean): void {
    this.channels[ch] = { ...this.channels[ch], pfl: v };
    this.notify();
  }
  setCrossfader(v: number): void {
    this.crossfader = v;
    this.notify();
  }
  setCrossfaderEnabled(v: boolean): void {
    this.crossfaderEnabled = v;
    this.notify();
  }
  setCrossfaderAssignment(ch: ChannelId, a: string): void {
    this.assignments[ch] = a;
    this.notify();
  }
  setMaster(v: number): void {
    this.master = v;
    this.notify();
  }

  getChannelState(ch: ChannelId): ChannelShape {
    return this.channels[ch];
  }
  getCrossfader(): number {
    return this.crossfader;
  }
  getCrossfaderEnabled(): boolean {
    return this.crossfaderEnabled;
  }
  getMaster(): number {
    return this.master;
  }

  engageAutomation(): symbol {
    this.automation = {};
    return Symbol('automation-owner');
  }
  setAutomation(ch: ChannelId, v: LaneShape): void {
    if (this.automation) this.automation[ch] = v; // never notifies
  }
  disengageAutomation(): void {
    this.automation = null;
  }
  getAutomation(ch: ChannelId): LaneShape | null {
    return this.automation?.[ch] ?? null;
  }

  subscribe(fn: () => void): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }

  private notify(): void {
    for (const fn of this.subs) fn();
  }
}

function freshChannel(): ChannelShape {
  return { fader: 1, trim: 0.5, eq: { low: 0.5, mid: 0.5, high: 0.5 }, filter: 0, pfl: false };
}

// ── Harness ──────────────────────────────────────────────────────────────

function seedEvents(t: number): CaptureEvent[] {
  const evs: CaptureEvent[] = [];
  for (const ch of ['A', 'B', 'C', 'D'] as const) {
    evs.push({ t, kind: 'control', control: 'fader', channel: ch, value: 1 });
    evs.push({
      t,
      kind: 'control',
      control: 'crossfaderAssignment',
      channel: ch,
      value: ch === 'A' || ch === 'C' ? -1 : 1,
    });
  }
  evs.push({ t, kind: 'control', control: 'crossfaderEnabled', channel: null, value: 0 });
  return evs;
}

function simpleLog(): CaptureEvent[] {
  return [
    ...seedEvents(0),
    { t: 1, kind: 'load', channel: 'A', trackId: 11, bpm: 174 },
    { t: 2, kind: 'transport', channel: 'A', action: 'play', playhead: 50 },
    { t: 3, kind: 'tick', playheads: { A: 51 } },
    { t: 4, kind: 'tick', playheads: { A: 52 } },
    { t: 6, kind: 'control', control: 'fader', channel: 'A', value: 0.25 },
    { t: 8, kind: 'transport', channel: 'A', action: 'pause', playhead: 56 },
    { t: 10, kind: 'tick', playheads: {} },
  ];
}

interface Rig {
  clock: { t: number };
  mixer: FakeMixer;
  engines: Record<ChannelId, FakeEngine>;
  stops: ReplayStopReason[];
  driver: SessionReplayDriver;
  pump(): void;
  advance(dt: number): void;
}

function rig(
  plan: ReplayPlan,
  loadOk = true,
  loader?: (engines: Record<ChannelId, FakeEngine>, deck: ChannelId, trackId: number) => Promise<boolean>
): Rig {
  const clock = { t: 100 };
  const read = () => clock.t;
  const mixer = new FakeMixer(read);
  const engines = {
    A: new FakeEngine(read),
    B: new FakeEngine(read),
    C: new FakeEngine(read),
    D: new FakeEngine(read),
  };
  const stops: ReplayStopReason[] = [];
  const driver = new SessionReplayDriver(
    plan,
    { mixer: mixer as unknown as Mixer, engines: engines as unknown as Record<ChannelId, DeckEngine> },
    {
      loadTrack: async (deck, trackId) => {
        if (loader) return loader(engines, deck, trackId);
        if (!loadOk) return false;
        engines[deck].finishLoad(trackId);
        return true;
      },
      onStopped: (r) => stops.push(r),
    }
  );
  return {
    clock,
    mixer,
    engines,
    stops,
    driver,
    pump: () => {
      for (const cb of rafQueue.splice(0)) cb();
    },
    advance: (dt: number) => {
      clock.t += dt;
      for (const cb of rafQueue.splice(0)) cb();
    },
  };
}

let rafQueue: (() => void)[] = [];

beforeEach(() => {
  rafQueue = [];
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
    rafQueue.push(cb);
    return rafQueue.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function planFor(events: CaptureEvent[], t: number): ReplayPlan {
  const res = planReplay(events, t);
  if (!res.ok) throw new Error(`plan refused: ${res.reason}`);
  return res.plan;
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('SessionReplayDriver — seed and schedule', () => {
  it('claims the surface, loads, seeds decks + mixer, then rolls the cues', async () => {
    const r = rig(planFor(simpleLog(), 5));
    await r.driver.start();

    expect(audibleHolder()).toBe('replay');
    // Seed: A at ~54 (50 @t=2 + 3s to t=5... via ticks 52 @t=4 + 1), playing.
    expect(r.engines.A.trackId).toBe(11);
    expect(r.engines.A.playing).toBe(true);
    expect(r.engines.A.playhead).toBeCloseTo(53, 0);
    // Mixer output rides the automation OVERLAY (the Conductor protocol);
    // the user's base state is untouched during playback.
    expect(r.mixer.automation?.A?.fader).toBe(1);
    expect(r.mixer.channels.A.fader).toBe(1); // base: user's, unwritten
    expect(r.mixer.crossfaderEnabled).toBe(true); // base spared entirely

    // t+1 → nothing yet; the fader cue lands at offset 1 (t=6).
    r.advance(1.0);
    expect(r.mixer.automation?.A?.fader).toBe(0.25);
    expect(r.mixer.channels.A.fader).toBe(1); // still the user's
    // offset 3 (t=8): pause cue parks A at 56.
    r.advance(2.0);
    expect(r.engines.A.playing).toBe(false);
    expect(r.engines.A.playhead).toBe(56);
    expect(r.stops).toEqual([]);
    r.driver.stop();
  });

  it('ends when the log runs out: decks paused, surface released', async () => {
    const r = rig(planFor(simpleLog(), 5));
    await r.driver.start();
    r.advance(1);
    r.advance(2);
    r.advance(3); // past endT-startT = 5
    expect(r.stops).toEqual(['ended']);
    expect(audibleHolder()).toBe('shared');
    expect(r.engines.A.playing).toBe(false);
  });

  it('sync cues re-seek a drifted deck, and leave an on-time one alone', async () => {
    const events: CaptureEvent[] = [
      ...seedEvents(0),
      { t: 1, kind: 'load', channel: 'A', trackId: 11, bpm: 174 },
      { t: 2, kind: 'transport', channel: 'A', action: 'play', playhead: 50 },
      { t: 3, kind: 'tick', playheads: { A: 51 } },
      { t: 6, kind: 'tick', playheads: { A: 54 } },
      { t: 9, kind: 'tick', playheads: { A: 57 } },
      { t: 12, kind: 'tick', playheads: {} },
    ];
    const r = rig(planFor(events, 4));
    await r.driver.start();
    const seeksAfterSeed = r.engines.A.seeks.length;

    // Advance to the first sync cue (offset 2, t=6): fake engine tracked
    // real time, so it reads ~54 — within tolerance, no re-seek.
    r.advance(2.0);
    expect(r.engines.A.seeks.length).toBe(seeksAfterSeed);

    // Force drift before the next sync cue (offset 5, t=9 → playhead 57).
    r.engines.A.playhead -= 2;
    r.advance(3.0);
    expect(r.engines.A.seeks.length).toBe(seeksAfterSeed + 1);
    expect(r.engines.A.seeks.at(-1)).toBe(57);
    r.driver.stop();
  });

  it('refuses when a track is missing: load-failed, surface released', async () => {
    const r = rig(planFor(simpleLog(), 5), /* loadOk */ false);
    await r.driver.start();
    expect(r.stops).toEqual(['load-failed']);
    expect(audibleHolder()).toBe('shared');
  });
});

describe('SessionReplayDriver — takeover', () => {
  it('a manual mixer move stops replay; decks keep playing; capture-gate releases', async () => {
    const r = rig(planFor(simpleLog(), 5));
    await r.driver.start();
    expect(r.engines.A.playing).toBe(true);

    // Human hand on a fader: base write OUTSIDE the driver's self-ops.
    r.mixer.setFader('B', 0.4);

    expect(r.stops).toEqual(['takeover']);
    expect(audibleHolder()).toBe('shared');
    // The deck plays on exactly as replay left it; the sounding lane
    // values sync into base (the touched B fader keeps the user's value).
    expect(r.engines.A.playing).toBe(true);
    expect(r.mixer.channels.B.fader).toBe(0.4);
    expect(r.mixer.channels.A.fader).toBe(1); // synced from the A lane
    expect(r.mixer.crossfader).toBe(0); // folded into lanes → base neutral
    expect(r.mixer.automation).toBeNull(); // overlay disengaged
  });

  it('a manual transport gesture (pause) is a takeover', async () => {
    const r = rig(planFor(simpleLog(), 5));
    await r.driver.start();
    r.engines.A.humanPause();
    expect(r.stops).toEqual(['takeover']);
    expect(audibleHolder()).toBe('shared');
  });

  it('a seek-class gesture through the transport tap is a takeover', async () => {
    const r = rig(planFor(simpleLog(), 5));
    await r.driver.start();
    r.engines.B.humanSeekGesture();
    expect(r.stops).toEqual(['takeover']);
  });

  it("the driver's own cue application never trips its watchers", async () => {
    const r = rig(planFor(simpleLog(), 5));
    await r.driver.start();
    r.advance(1.0); // fader cue fires through the notifying fake mixer
    r.advance(2.0); // pause cue flips the engine snapshot
    expect(r.stops).toEqual([]);
    r.driver.stop();
    expect(r.stops).toEqual(['stopped']);
  });
});

describe('SessionReplayDriver — four-deck parity (sessions 09)', () => {
  /** C plays; a handler-only C seek cue at offset 1; D joins at offset 2. */
  function fourDeckLog(): CaptureEvent[] {
    return [
      ...seedEvents(0),
      { t: 1, kind: 'load', channel: 'C', trackId: 31, bpm: 170 },
      { t: 2, kind: 'transport', channel: 'C', action: 'play', playhead: 10 },
      { t: 3, kind: 'tick', playheads: { C: 11 } },
      { t: 4, kind: 'tick', playheads: { C: 12 } },
      { t: 6, kind: 'transport', channel: 'C', action: 'seek', playhead: 64 },
      { t: 7, kind: 'load', channel: 'D', trackId: 41, bpm: 172 },
      { t: 8, kind: 'transport', channel: 'D', action: 'play', playhead: 0 },
      { t: 10, kind: 'tick', playheads: { C: 68, D: 2 } },
      { t: 12, kind: 'tick', playheads: {} },
    ];
  }

  it('seeds and executes C/D cues on the original physical decks', async () => {
    const r = rig(planFor(fourDeckLog(), 5));
    await r.driver.start();
    // Seed: C loaded + playing at ~13; A/B untouched.
    expect(r.engines.C.trackId).toBe(31);
    expect(r.engines.C.playing).toBe(true);
    expect(r.engines.A.trackId).toBeNull();
    expect(r.engines.B.trackId).toBeNull();

    // Offset 1 (t=6): the handler-only C seek replays on C.
    r.advance(1.0);
    expect(r.engines.C.seeks.at(-1)).toBe(64);

    // Offsets 2-3 (t=7,8): D loads and plays — on D, never remapped.
    r.advance(2.0);
    expect(r.engines.D.trackId).toBe(41);
    expect(r.engines.D.playing).toBe(true);
    expect(r.stops).toEqual([]);
    r.driver.stop();
  });

  it('a manual C mixer move is a takeover, exactly like A/B', async () => {
    const r = rig(planFor(fourDeckLog(), 5));
    await r.driver.start();
    r.mixer.setFader('C', 0.3);
    expect(r.stops).toEqual(['takeover']);
    expect(audibleHolder()).toBe('shared');
    expect(r.engines.C.playing).toBe(true); // handed over as replay left it
  });

  it('a manual D transport gesture is a takeover, exactly like A/B', async () => {
    const r = rig(planFor(fourDeckLog(), 5));
    await r.driver.start();
    r.advance(3.0); // D playing now
    expect(r.engines.D.playing).toBe(true);
    r.engines.D.humanPause();
    expect(r.stops).toEqual(['takeover']);
    expect(audibleHolder()).toBe('shared');
  });

  it('a seek-class gesture on C through the transport tap is a takeover', async () => {
    const r = rig(planFor(fourDeckLog(), 5));
    await r.driver.start();
    r.engines.C.humanSeekGesture();
    expect(r.stops).toEqual(['takeover']);
  });
});

describe('SessionReplayDriver — pause/resume/seek (04 iteration)', () => {
  it('pause freezes the session clock and parks rolling decks; resume re-anchors', async () => {
    const r = rig(planFor(simpleLog(), 5));
    await r.driver.start();
    expect(r.driver.nowT()).toBeCloseTo(5, 3);
    r.advance(1.0);
    expect(r.driver.nowT()).toBeCloseTo(6, 3);

    r.driver.pauseReplay();
    expect(r.driver.isPaused()).toBe(true);
    expect(r.engines.A.playing).toBe(false); // parked, not taken over
    expect(r.stops).toEqual([]);
    const frozen = r.driver.nowT();
    r.advance(3.0); // wall clock moves; session clock must not
    expect(r.driver.nowT()).toBe(frozen);

    r.driver.resumeReplay();
    expect(r.driver.isPaused()).toBe(false);
    expect(r.engines.A.playing).toBe(true);
    r.advance(0.5);
    expect(r.driver.nowT()).toBeCloseTo(frozen! + 0.5, 3);
    r.driver.stop();
  });

  it('pausing is not a takeover and its own deck ops never trip watchers', async () => {
    const r = rig(planFor(simpleLog(), 5));
    await r.driver.start();
    r.driver.pauseReplay();
    r.driver.resumeReplay();
    expect(r.stops).toEqual([]);
    r.driver.stop();
    expect(r.stops).toEqual(['stopped']);
  });

  it('seekTo swaps plans without releasing the surface (no tenure flap)', async () => {
    const r = rig(planFor(simpleLog(), 5));
    await r.driver.start();
    expect(audibleHolder()).toBe('replay');
    r.advance(0.5);

    await r.driver.seekTo(planFor(simpleLog(), 2));
    expect(audibleHolder()).toBe('replay'); // never released
    expect(r.stops).toEqual([]);
    expect(r.driver.nowT()).toBeCloseTo(2, 1);
    // Seeded back to the earlier moment: A near playhead 50 (t=2 → play @50).
    expect(r.engines.A.playing).toBe(true);
    expect(r.engines.A.playhead).toBeCloseTo(50, 0);
    r.driver.stop();
  });

  it('seeking while paused stays paused at the new moment', async () => {
    const r = rig(planFor(simpleLog(), 5));
    await r.driver.start();
    r.driver.pauseReplay();
    await r.driver.seekTo(planFor(simpleLog(), 3));
    expect(r.driver.isPaused()).toBe(true);
    expect(r.driver.nowT()).toBeCloseTo(3, 3);
    expect(r.engines.A.playing).toBe(false);
    r.driver.resumeReplay();
    expect(r.engines.A.playing).toBe(true);
    r.driver.stop();
  });
});

describe('SessionReplayDriver — pause/seek races (frozen-playhead fix)', () => {
  /** Track 11 early, track 12 later — a seek across the load boundary
   * must actually load, giving the race a window to land in. */
  function twoTrackLog(): CaptureEvent[] {
    return [
      ...seedEvents(0),
      { t: 1, kind: 'load', channel: 'A', trackId: 11, bpm: 174 },
      { t: 2, kind: 'transport', channel: 'A', action: 'play', playhead: 50 },
      { t: 3, kind: 'tick', playheads: { A: 51 } },
      { t: 20, kind: 'load', channel: 'A', trackId: 12, bpm: 170 },
      { t: 21, kind: 'transport', channel: 'A', action: 'play', playhead: 0 },
      { t: 22, kind: 'tick', playheads: { A: 1 } },
      { t: 30, kind: 'tick', playheads: { A: 9 } },
    ];
  }

  /** rig() whose loads of track 12 park until released — holds a seek
   * in flight so races can be aimed into its window. */
  function gatedRig(startAt: number) {
    let release: () => void = () => {};
    const gate = new Promise<void>((res) => {
      release = res;
    });
    const r = rig(planFor(twoTrackLog(), startAt), true, async (engines, deck, trackId) => {
      if (trackId === 12) await gate;
      engines[deck].finishLoad(trackId);
      return true;
    });
    return { ...r, release: () => release() };
  }

  it('a pause landing inside a seek load is refused — the clock never freezes under rolling audio', async () => {
    const r = gatedRig(5);
    await r.driver.start();
    const seek = r.driver.seekTo(planFor(twoTrackLog(), 25));
    await Promise.resolve(); // the seek is now parked on its load
    // THE RACE: space during the load. Before the fix this set
    // pausedAtOffset under the seek's stale wasPaused=false snapshot —
    // status 'playing', decks rolling, nowT pinned forever.
    r.driver.pauseReplay();
    expect(r.driver.isPaused()).toBe(false); // refused mid-seek
    r.release();
    await seek;
    // The seek completed PLAYING with a live clock.
    expect(r.driver.isPaused()).toBe(false);
    const t0 = r.driver.nowT();
    expect(t0).toBeCloseTo(25, 1);
    r.advance(1);
    expect(r.driver.nowT()).toBeCloseTo(t0! + 1, 3);
    // And a deliberate pause afterwards still works.
    r.driver.pauseReplay();
    expect(r.driver.isPaused()).toBe(true);
    const frozen = r.driver.nowT();
    r.advance(1);
    expect(r.driver.nowT()).toBe(frozen);
    r.driver.stop();
  });

  it('a resume landing inside a seek load is refused (no premature tick loop)', async () => {
    const r = gatedRig(5);
    await r.driver.start();
    r.driver.pauseReplay();
    const seek = r.driver.seekTo(planFor(twoTrackLog(), 25)); // seek-while-paused
    await Promise.resolve();
    r.driver.resumeReplay(); // space again, mid-load: must be inert
    r.release();
    await seek;
    // The paused seek honored its wasPaused snapshot: parked at the new
    // moment, clock frozen there.
    expect(r.driver.isPaused()).toBe(true);
    expect(r.driver.nowT()).toBeCloseTo(25, 3);
    r.driver.resumeReplay();
    expect(r.driver.isPaused()).toBe(false);
    r.driver.stop();
  });

  it('a newer seek supersedes an older in-flight one: a single tick loop on the newest plan', async () => {
    const r = gatedRig(5);
    await r.driver.start();
    r.pump(); // drain the start() frame
    const seek1 = r.driver.seekTo(planFor(twoTrackLog(), 25)); // parks on track 12's load
    await Promise.resolve();
    rafQueue.splice(0); // both seeks canceled the loop: count fresh restarts
    await r.driver.seekTo(planFor(twoTrackLog(), 6)); // track 11 already on deck — completes
    expect(r.driver.nowT()).toBeCloseTo(6, 1);
    expect(rafQueue.length).toBe(1); // seek 2's restart
    r.release();
    await seek1; // superseded: must NOT restart a second loop or re-seed
    expect(r.driver.nowT()).toBeCloseTo(6, 1); // still the newest plan's moment
    expect(rafQueue.length).toBe(1); // STILL one tick loop — no double restart
    r.advance(0.1);
    expect(rafQueue.length).toBe(1); // the one loop re-queued itself
    r.driver.stop();
  });
});

describe('SessionReplayDriver — Conductor protocol parity', () => {
  it('exposes lanes on ALL FOUR decks via getAutomation (the ghost display feed)', async () => {
    const r = rig(planFor(simpleLog(), 5));
    await r.driver.start();
    // useAutomationGhost polls getAutomation — every deck must serve it,
    // beyond the Conductor's A/B (four-deck replay, sessions 09).
    for (const d of ['A', 'B', 'C', 'D'] as const) {
      expect(r.mixer.getAutomation(d)).not.toBeNull();
    }
    r.driver.stop();
    expect(r.mixer.automation).toBeNull();
  });

  it('folds the recorded crossfader into the fader lanes (value·√xf)', async () => {
    const events: CaptureEvent[] = [
      ...seedEvents(0),
      // Crossfader ENABLED, hard left: B (right side) is cut.
      { t: 0.5, kind: 'control', control: 'crossfaderEnabled', channel: null, value: 1 },
      { t: 0.6, kind: 'control', control: 'crossfader', channel: null, value: -1 },
      { t: 1, kind: 'load', channel: 'A', trackId: 11, bpm: 174 },
      { t: 1.5, kind: 'load', channel: 'B', trackId: 22, bpm: 172 },
      { t: 2, kind: 'transport', channel: 'A', action: 'play', playhead: 0 },
      { t: 3, kind: 'transport', channel: 'B', action: 'play', playhead: 0 },
      { t: 6, kind: 'control', control: 'crossfader', channel: null, value: 0 },
      { t: 8, kind: 'tick', playheads: { A: 6, B: 5 } },
    ];
    const r = rig(planFor(events, 4));
    await r.driver.start();
    // At T=4: xf hard left → A (left) full, B (right) silent.
    expect(r.mixer.automation?.A?.fader).toBeCloseTo(1, 5);
    expect(r.mixer.automation?.B?.fader).toBeCloseTo(0, 5);
    // Base crossfader untouched during playback.
    expect(r.mixer.crossfader).toBe(0);
    // The center cue at offset 2 restores B's lane (center transparent).
    r.advance(2.0);
    expect(r.mixer.automation?.B?.fader).toBeCloseTo(1, 5);
    r.driver.stop();
  });
});

describe('SessionReplayDriver — status callbacks (playhead desync fix)', () => {
  function rigWithStatus(plan: ReplayPlan) {
    const clock = { t: 100 };
    const read = () => clock.t;
    const mixer = new FakeMixer(read);
    const engines = {
      A: new FakeEngine(read), B: new FakeEngine(read),
      C: new FakeEngine(read), D: new FakeEngine(read),
    };
    const statuses: string[] = [];
    const stops: ReplayStopReason[] = [];
    const driver = new SessionReplayDriver(
      plan,
      { mixer: mixer as unknown as Mixer, engines: engines as unknown as Record<ChannelId, DeckEngine> },
      {
        loadTrack: async (deck, trackId) => { engines[deck].finishLoad(trackId); return true; },
        onStopped: (r) => stops.push(r),
        onStatus: (s) => statuses.push(s),
      }
    );
    return { clock, mixer, engines, statuses, stops, driver,
             advance: (dt: number) => { clock.t += dt; for (const cb of rafQueue.splice(0)) cb(); } };
  }

  it('pushes loading → playing on start, and never leaves status stale', async () => {
    const r = rigWithStatus(planFor(simpleLog(), 5));
    await r.driver.start();
    expect(r.statuses).toEqual(['loading', 'playing']);
    // The driver clock is live and authoritative while rolling.
    expect(r.driver.nowT()).not.toBeNull();
    r.driver.stop();
    // Stop reports via onStopped (store maps to idle), not onStatus.
    expect(r.stops).toEqual(['stopped']);
    expect(r.driver.nowT()).toBeNull();
  });

  it('pushes paused/playing on pause/resume', async () => {
    const r = rigWithStatus(planFor(simpleLog(), 5));
    await r.driver.start();
    r.driver.pauseReplay();
    r.driver.resumeReplay();
    expect(r.statuses).toEqual(['loading', 'playing', 'paused', 'playing']);
    r.driver.stop();
  });

  it('seekTo keeps status coherent (playing→playing, no idle flap)', async () => {
    const r = rigWithStatus(planFor(simpleLog(), 5));
    await r.driver.start();
    await r.driver.seekTo(planFor(simpleLog(), 2));
    // No 'idle'/stop emitted; still rolling and reporting a clock.
    expect(r.stops).toEqual([]);
    expect(r.statuses.filter((s) => s === 'playing').length).toBeGreaterThanOrEqual(2);
    expect(r.driver.nowT()).not.toBeNull();
    r.driver.stop();
  });
});
