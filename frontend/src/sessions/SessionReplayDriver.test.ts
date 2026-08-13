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

class FakeMixer {
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

function rig(plan: ReplayPlan, loadOk = true): Rig {
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
    expect(r.mixer.channels.A.fader).toBe(1);
    expect(r.mixer.crossfaderEnabled).toBe(false);

    // t+1 → nothing yet; the fader cue lands at offset 1 (t=6).
    r.advance(1.0);
    expect(r.mixer.channels.A.fader).toBe(0.25);
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
    // No state restore — the deck plays on exactly as replay left it.
    expect(r.engines.A.playing).toBe(true);
    expect(r.mixer.channels.B.fader).toBe(0.4);
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
