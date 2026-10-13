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
import type { BeatFxSectionState } from '../playback/beatFx';
import { planReplay } from './replayPlanner';
import type { ReplayPlan } from './replayPlanner';
import { SessionReplayDriver } from './SessionReplayDriver';
import type { ReplayStopReason } from './SessionReplayDriver';
import { scratchPosition, scratchFilterAt, moveScratch } from '../playback/worklet/scratchMotion';
import type { ScratchFrame, ScratchFilter } from '../playback/worklet/scratchMotion';
import { followScrollTarget } from './followScroll';

// ── Fakes ────────────────────────────────────────────────────────────────

class FakeEngine {
  trackId: number | null = null;
  playing = false;
  scratching = false;
  slipMode = false;
  vinylMode = true;
  scratch: ScratchFilter | null = null;
  scratchCalls: { deltaSeconds: number; durationSeconds: number }[] = [];
  scratchEnds: number[] = [];
  loop: { start: number; end: number; lengthBeats: number } | null = null;
  scheduled: { owner: symbol; frames: ScratchFrame[]; index: number } | null = null;
  private preserveSchedule = false;
  previewing = false;
  playhead = 0;
  playheadAt = 0;
  pitchPercent = 0;
  seeks: number[] = [];
  /** Machine preview calls (sessions 12): what the driver executed. */
  previews: ({ kind: 'start'; at: number } | { kind: 'end'; returnTo: number })[] = [];
  private subs = new Set<() => void>();
  private taps = new Set<() => void>();
  private readonly clock: () => number;

  constructor(clock: () => number) {
    this.clock = clock;
  }

  getSnapshot() {
    this.syncScheduledScratch();
    return {
      trackId: this.trackId,
      loadState: this.trackId === null ? 'empty' : 'ready',
      playing: this.playing,
      scratching: this.scratching,
      slipMode: this.slipMode,
      vinylMode: this.vinylMode,
      loop: this.loop,
      duration: 600,
      pitchPercent: this.pitchPercent,
      bendPercent: 0,
      previewing: this.previewing,
      hotCuePreviewSlot: null,
      keyLock: true,
    } as ReturnType<DeckEngine['getSnapshot']>;
  }

  getPlayhead(): number {
    this.syncScheduledScratch();
    if (this.scratch) return scratchPosition({ ...this.scratch, position: this.playhead,
      time: this.playheadAt, trackDuration: 600, loop: this.loop }, this.clock());
    // Pitch-aware (sessions 18): the engine advances at its true rate, so
    // rate-inference tests can assert drift actually stops.
    const rate = 1 + this.pitchPercent / 100;
    return this.playing ? this.playhead + (this.clock() - this.playheadAt) * rate : this.playhead;
  }

  setLoopRegion(loop: { start: number; end: number } | null, position?: number) {
    this.loop = loop ? { ...loop, lengthBeats: 4 } : null;
    if (position !== undefined) {
      this.playhead = position;
      this.playheadAt = this.clock();
      this.scratching = false;
      this.scratch = null;
    }
  }
  async prepareScratchReplay() {}
  scheduleScratch(frames: ScratchFrame[]): symbol {
    const owner = Symbol();
    this.scheduled = { owner, frames, index: -1 };
    return owner;
  }
  withScratchSchedule<T>(fn: () => T): T {
    const before = this.preserveSchedule;
    this.preserveSchedule = true;
    try { return fn(); } finally { this.preserveSchedule = before; }
  }
  syncScheduledScratch(): number | null {
    const s = this.scheduled;
    if (!s) return null;
    while (s.frames[s.index + 1]?.time <= this.clock()) {
      const f = s.frames[++s.index];
      if (!f.motion && this.scratching) this.scratchEnds.push(f.position);
      this.playhead = f.position;
      this.playheadAt = f.time;
      this.playing = f.playing;
      this.setLoopRegion(f.loop);
      this.pitchPercent = (f.rate - 1) * 100;
      this.scratching = f.motion !== null;
      this.scratch = f.motion ? { drive: f.motion.drive, rate: f.motion.rate } : null;
    }
    return s.frames[s.index]?.time ?? null;
  }
  cancelScheduledScratch(owner?: symbol): void {
    if (!this.scheduled || (owner && owner !== this.scheduled.owner)) return;
    this.syncScheduledScratch();
    this.scheduled = null;
    if (this.scratching) this.endScratch(this.getPlayhead());
  }

  setSlipMode(on: boolean): void { this.slipMode = on; this.emit(); }
  setVinylMode(on: boolean): void {
    if (this.vinylMode === on) return;
    if (!on && this.scratching && !this.preserveSchedule) this.endScratch(this.getPlayhead());
    this.vinylMode = on;
    this.emit();
  }
  getScratchState() {
    this.syncScheduledScratch();
    if (!this.scratch) return null;
    return scratchFilterAt({ ...this.scratch, time: this.playheadAt }, this.clock());
  }
  beginScratch(): void {
    if (!this.preserveSchedule) this.cancelScheduledScratch();
    this.playhead = this.getPlayhead();
    this.playheadAt = this.clock();
    this.scratching = true;
    this.scratch = { drive: 0, rate: 0 };
    this.emit();
  }
  scratchMove(deltaSeconds: number, durationSeconds: number): void {
    const previous = this.getScratchState();
    this.playhead = this.getPlayhead();
    this.playheadAt = this.clock();
    this.scratchCalls.push({ deltaSeconds, durationSeconds });
    this.scratch = moveScratch({ drive: previous?.drive ?? 0, rate: previous?.rate ?? 0,
      position: this.playhead, time: this.playheadAt, trackDuration: 600, loop: this.loop },
    this.clock(), deltaSeconds, durationSeconds);
  }
  endScratch(positionSeconds: number): void {
    this.scratchEnds.push(positionSeconds);
    this.playhead = positionSeconds;
    this.playheadAt = this.clock();
    this.scratching = false;
    this.scratch = null;
    this.emit();
  }

  seek(t: number): void {
    if (!this.preserveSchedule) this.cancelScheduledScratch();
    this.seeks.push(t);
    this.loop = null;
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
    if (!this.preserveSchedule) this.cancelScheduledScratch();
    if (!this.playing) return;
    this.playhead = this.getPlayhead();
    this.playing = false;
    this.emit();
  }

  setPitch(p: number): void {
    // Rebase before the rate flips (rates apply forward, not retroactively).
    this.playhead = this.getPlayhead();
    this.playheadAt = this.clock();
    this.pitchPercent = p;
    this.emit();
  }

  /** Machine-grade preview entry point (sessions 12) — real-engine
   * semantics: no-op while playing or already previewing; release no-ops
   * unless a preview runs (the mid-window skip boundary). */
  previewAt(at: number): void {
    if (this.playing || this.previewing) return;
    this.previews.push({ kind: 'start', at });
    this.previewing = true;
    this.playhead = at;
    this.playheadAt = this.clock();
    this.emit();
  }
  endPreview(returnTo: number): void {
    if (!this.previewing) return;
    this.previews.push({ kind: 'end', returnTo });
    this.previewing = false;
    this.playhead = returnTo;
    this.emit();
  }

  /** A HUMAN stab (outside any driver call): previewing flips. */
  humanStab(): void {
    this.previewing = true;
    this.emit();
  }

  /** The load path completing: trackId lands + ready, emits (async flow). */
  finishLoad(trackId: number): void {
    this.scheduled = null;
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

type LaneShape = {
  fader: number;
  trim?: number;
  eq: { low: number; mid: number; high: number };
  filter: number;
};

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

  beatFx: BeatFxSectionState = { selected: 'echo', target: 'A', on: false, depth: 0, beats: 0.5 };
  getBeatFxSection(): BeatFxSectionState {
    return this.beatFx;
  }
  setBeatFxSection(state: BeatFxSectionState): void {
    this.beatFx = { ...state };
    this.notify();
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

it('keeps the playhead and follow viewport at the requested moment during startup loading', async () => {
  let finish!: () => void;
  const r = rig(planFor(simpleLog(), 5), true, async (engines, deck, id) => {
    await new Promise<void>(resolve => { finish = resolve; });
    engines[deck].finishLoad(id);
    return true;
  });
  const started = r.driver.start();
  try {
    for (let i = 0; i < 3; i++) {
      r.clock.t += 1;
      const t = r.driver.nowT()!;
      expect({ t, scroll: followScrollTarget(t * 100, 200, 600, 1000) })
        .toEqual({ t: 5, scroll: null });
    }
  } finally {
    finish();
    await started;
    r.driver.stop();
  }
});

describe('SessionReplayDriver — seed and schedule', () => {
  it.each([false, true])('replays an unchanged-loop phase anchor (scheduled scratch: %s)', async scheduled => {
    const region = { start: 10, end: 12 };
    const events: CaptureEvent[] = [
      { t: 0, kind: 'load', channel: 'A', trackId: 11, bpm: 120 },
      { t: 0, kind: 'loop', channel: 'A', playhead: 10, region },
      { t: 0, kind: 'transport', channel: 'A', action: 'play', playhead: 10 },
      { t: 1, kind: 'loop', channel: 'A', playhead: 11.2, region },
      ...(scheduled ? [
        { t: 3, kind: 'transport', channel: 'A', action: 'scratchBegin', playhead: 11.2 },
        { t: 4, kind: 'transport', channel: 'A', action: 'scratchEnd', playhead: 11.2 },
      ] as CaptureEvent[] : []),
      { t: 6, kind: 'tick', playheads: {} },
    ];
    const r = rig(planFor(events, 0));
    try {
      await r.driver.start();
      r.advance(1.25);
      expect(r.engines.A.loop).toMatchObject(region);
      expect(r.engines.A.getPlayhead()).toBeGreaterThanOrEqual(11.2);
      expect(r.engines.A.getPlayhead()).toBeLessThan(11.5);
      expect(r.stops).toEqual([]);
    } finally { r.driver.stop(); }
  });

  it('retains equal-timestamp loop/scratch ordering on the audio clock', async () => {
    const events: CaptureEvent[] = [
      { t: 0, kind: 'load', channel: 'A', trackId: 11, bpm: 120 },
      { t: 1, kind: 'loop', channel: 'A', playhead: 11, region: { start: 11, end: 13 } },
      { t: 1, kind: 'transport', channel: 'A', action: 'play', playhead: 11 },
      { t: 1, kind: 'transport', channel: 'A', action: 'scratchBegin', playhead: 11 },
      { t: 1, kind: 'transport', channel: 'A', action: 'scratchMove', playhead: 11, filter: { drive: -8, rate: -2 } },
      { t: 2, kind: 'transport', channel: 'A', action: 'scratchEnd', playhead: 12 },
      { t: 2, kind: 'loop', channel: 'A', playhead: 14, region: null },
      { t: 4, kind: 'tick', playheads: {} },
    ];
    const r = rig(planFor(events, 0));
    try {
      await r.driver.start();
      r.advance(1.06);
      expect(r.engines.A.getSnapshot().scratching).toBe(true);
      expect(r.engines.A.loop).toMatchObject({ start: 11, end: 13 });
      r.advance(1);
      expect(r.engines.A.getSnapshot().scratching).toBe(false);
      expect(r.engines.A.loop).toBeNull();
      expect(r.engines.A.getPlayhead()).toBeCloseTo(14.01);
      expect(r.stops).toEqual([]);
    } finally { r.driver.stop(); }
  });

  it('preserves an armed loop across recorded Play, Pause, and resume', async () => {
    const events: CaptureEvent[] = [
      { t: 0, kind: 'load', channel: 'A', trackId: 11, bpm: 120 },
      { t: 0, kind: 'loop', channel: 'A', playhead: 10, region: { start: 10, end: 12 }, slip: true },
      { t: 1, kind: 'transport', channel: 'A', action: 'play', playhead: 10 },
      { t: 2, kind: 'transport', channel: 'A', action: 'pause', playhead: 11 },
      { t: 2, kind: 'loop', channel: 'A', playhead: 11, region: { start: 10, end: 12 }, slip: false },
      { t: 3, kind: 'transport', channel: 'A', action: 'play', playhead: 11 },
      { t: 5, kind: 'tick', playheads: {} },
    ];
    const r = rig(planFor(events, 0));
    try {
      await r.driver.start();
      for (let t = 1; t <= 3; t++) {
        r.advance(1);
        expect(r.engines.A.loop).toMatchObject({ start: 10, end: 12 });
        expect(r.engines.A.playing).toBe(t !== 2);
      }
    } finally { r.driver.stop(); }
  });

  it('a human loop change takes over replay', async () => {
    const r = rig(planFor(simpleLog(), 2));
    try {
      await r.driver.start();
      r.engines.A.setLoopRegion({ start: 50, end: 52 });
      r.engines.A.setSlipMode(false); // notify without changing the preference
      expect(r.stops).toEqual(['takeover']);
    } finally { r.driver.stop(); }
  });

  it.each([0, 3])('replays the resolved Slip loop exit from start %s without a correcting tick', async start => {
    const events: CaptureEvent[] = [
      { t: 0, kind: 'load', channel: 'A', trackId: 11, bpm: 120 },
      { t: 0, kind: 'transport', channel: 'A', action: 'play', playhead: 10 },
      { t: 1, kind: 'loop', channel: 'A', playhead: 11, region: { start: 11, end: 13 } },
      { t: 4, kind: 'loop', channel: 'A', playhead: 11, region: { start: 11, end: 12 } },
      { t: 6, kind: 'loop', channel: 'A', playhead: 16, region: null },
      { t: 10, kind: 'tick', playheads: {} },
    ];
    const plan = planFor(events, start);
    expect(plan.cues.find(c => c.kind === 'loop' && c.region === null)).toMatchObject({ playhead: 16 });
    const r = rig(plan);
    try {
      await r.driver.start();
      if (start === 0) r.advance(1);
      r.advance(4 - Math.max(1, start));
      expect(r.engines.A.getPlayhead()).toBe(11);
      expect(r.engines.A.loop).toMatchObject({ start: 11, end: 12 });
      r.advance(2);
      expect(r.engines.A.loop).toBeNull();
      expect(r.engines.A.getPlayhead()).toBe(16);
      for (let i = 0; i < 10; i++) r.advance(0.1);
      expect(r.engines.A.getPlayhead()).toBeCloseTo(17);
    } finally { r.driver.stop(); }
  });

  it('bounds scratch seed and resume loops without truncating transport loop intent', async () => {
    const loop = { start: 599, end: 601 }; // FakeEngine's track duration is 600.
    const events: CaptureEvent[] = [
      { t: 0, kind: 'load', channel: 'A', trackId: 1, bpm: 120 },
      { t: 0, kind: 'loop', channel: 'A', playhead: 599.9, region: loop },
      { t: 1, kind: 'transport', channel: 'A', action: 'scratchBegin', playhead: 599.9, trackDuration: 600 },
      { t: 1, kind: 'transport', channel: 'A', action: 'scratchMove', playhead: 599.9,
        trackDuration: 600, filter: { drive: 16, rate: 16 } },
      { t: 2, kind: 'tick', playheads: {} },
    ];
    const r = rig(planFor(events, 1.001));
    await r.driver.start();
    expect(r.engines.A.scheduled!.frames[0]).toMatchObject({ loop, motion: { loop: { start: 599, end: 600 } } });
    r.advance(0.05);
    r.driver.pauseReplay();
    r.driver.resumeReplay();
    expect(r.engines.A.scheduled!.frames[0]).toMatchObject({ loop, motion: { loop: { start: 599, end: 600 } } });
    r.driver.stop();
  });
  it('delayed rAF applies off/on preferences without erasing the newer scratch', async () => {
    const events: CaptureEvent[] = [
      { t: 0, kind: 'load', channel: 'A', trackId: 1, bpm: 120 },
      { t: 0.1, kind: 'control', channel: 'A', control: 'vinylMode', value: 0 },
      { t: 0.2, kind: 'control', channel: 'A', control: 'vinylMode', value: 1 },
      { t: 0.3, kind: 'transport', channel: 'A', action: 'scratchBegin', playhead: 20 },
      { t: 0.3, kind: 'transport', channel: 'A', action: 'scratchMove', playhead: 20, filter: { drive: -8, rate: -2 } },
      { t: 2, kind: 'transport', channel: 'A', action: 'scratchEnd', playhead: 19.2 },
      { t: 3, kind: 'tick', playheads: {} },
    ];
    const r = rig(planFor(events, 0));
    await r.driver.start();
    r.advance(0.85);
    expect(r.engines.A.getSnapshot()).toMatchObject({ scratching: true, vinylMode: true });
    expect(r.engines.A.getPlayhead()).toBeCloseTo(19.92);
    expect(r.stops).toEqual([]);
    r.driver.stop();
  });

  it.each([false, true])('cached load with scratch 40ms later (deadline missed=%s)', async (missed) => {
    const events: CaptureEvent[] = [
      { t: 0, kind: 'load', channel: 'A', trackId: 1, bpm: 120 },
      { t: 0, kind: 'transport', channel: 'A', action: 'play', playhead: 0 },
      { t: 1, kind: 'load', channel: 'A', trackId: 2, bpm: 120 },
      { t: 1.04, kind: 'transport', channel: 'A', action: 'scratchBegin', playhead: 20 },
      { t: 1.04, kind: 'transport', channel: 'A', action: 'scratchMove', playhead: 20, filter: { drive: -8, rate: -2 } },
      { t: 2, kind: 'transport', channel: 'A', action: 'scratchEnd', playhead: 19 },
      { t: 3, kind: 'tick', playheads: {} },
    ];
    const r = rig(planFor(events, 0));
    await r.driver.start();
    r.advance(missed ? 1.11 : 1.05);
    for (let i = 0; i < 6; i++) await Promise.resolve();
    if (missed) {
      expect(r.stops).toEqual(['load-failed']);
      expect(r.engines.A.scheduled).toBeNull();
    } else {
      expect(r.stops).toEqual([]);
      expect(r.engines.A.scheduled?.frames[0].time).toBeCloseTo(101.09);
      r.advance(0.06);
      expect(r.engines.A.getSnapshot().scratching).toBe(true);
      expect(r.engines.A.getPlayhead()).toBeCloseTo(19.9397);
      r.driver.stop();
    }
  });

  it('a cached load catches up same-time ordinary frames without treating them as missed scratch', async () => {
    const events: CaptureEvent[] = [
      { t: 0, kind: 'load', channel: 'A', trackId: 1, bpm: 120 },
      { t: 1, kind: 'load', channel: 'A', trackId: 2, bpm: 120 },
      { t: 1, kind: 'loop', channel: 'A', playhead: 20, region: { start: 20, end: 22 } },
      { t: 1, kind: 'transport', channel: 'A', action: 'play', playhead: 20 },
      { t: 2, kind: 'transport', channel: 'A', action: 'scratchBegin', playhead: 21 },
      { t: 3, kind: 'transport', channel: 'A', action: 'scratchEnd', playhead: 21 },
      { t: 4, kind: 'tick', playheads: {} },
    ];
    const r = rig(planFor(events, 0));
    try {
      await r.driver.start();
      r.advance(1.1);
      for (let i = 0; i < 6; i++) await Promise.resolve();
      expect(r.stops).toEqual([]);
      expect(r.engines.A.getPlayhead()).toBeCloseTo(20.05);
      expect(r.engines.A.loop).toMatchObject({ start: 20, end: 22 });
      r.advance(1);
      expect(r.engines.A.getSnapshot().scratching).toBe(true);
    } finally { r.driver.stop(); }
  });

  it('queues opposite strokes and release before their timestamps, independent of UI frames', async () => {
    const events: CaptureEvent[] = [
      { t: 0, kind: 'load', channel: 'A', trackId: 1, bpm: 120 },
      { t: 0.1, kind: 'transport', channel: 'A', action: 'scratchBegin', playhead: 20 },
      { t: 0.1, kind: 'transport', channel: 'A', action: 'scratchMove', playhead: 20, filter: { drive: 10, rate: 0 } },
      { t: 0.108, kind: 'transport', channel: 'A', action: 'scratchMove', playhead: 20.021139,
        filter: { drive: -6.321206, rate: 3.678794 } },
      { t: 0.114, kind: 'transport', channel: 'A', action: 'scratchEnd', playhead: 20 },
      { t: 1, kind: 'tick', playheads: {} },
    ];
    const r = rig(planFor(events, 0));
    await r.driver.start();
    const frames = r.engines.A.scheduled!.frames;
    expect(frames[2].time).toBeCloseTo(100.15);
    expect(frames[3].time).toBeCloseTo(100.158);
    expect(frames[4].time).toBeCloseTo(100.164);
    r.clock.t = 100.16; // no pump/rAF: the audio-clock mirror still advances
    expect(r.engines.A.getPlayhead()).toBeGreaterThan(20.021);
    expect(r.engines.A.getPlayhead()).toBeLessThan(20.04);
    r.clock.t = 100.17;
    expect(r.engines.A.getSnapshot()).toMatchObject({ scratching: false, playing: false });
    expect(r.engines.A.getPlayhead()).toBe(20);
    expect(r.engines.A.scratchCalls).toEqual([]); // no live increment replay
    r.driver.stop();
  });

  it('seeks into looped scratch while paused without inheriting a live loop or starting audio', async () => {
    const events: CaptureEvent[] = [
      { t: 0, kind: 'load', channel: 'A', trackId: 1, bpm: 120 },
      { t: 0, kind: 'loop', channel: 'A', region: { start: 10, end: 12 }, playhead: 10.1 },
      { t: 1, kind: 'transport', channel: 'A', action: 'scratchBegin', playhead: 10.1 },
      { t: 1, kind: 'transport', channel: 'A', action: 'scratchMove', playhead: 10.1, filter: { drive: -16, rate: -4 } },
      { t: 2, kind: 'transport', channel: 'A', action: 'scratchEnd', playhead: 10.5 },
      { t: 3, kind: 'tick', playheads: {} },
    ];
    const r = rig(planFor(events, 0));
    r.engines.A.setLoopRegion({ start: 50, end: 60 });
    await r.driver.start();
    expect(r.engines.A.loop).toMatchObject({ start: 10, end: 12 });
    r.driver.pauseReplay();
    await r.driver.seekTo(planFor(events, 1.05));
    expect(r.engines.A.scheduled).toBeNull();
    expect(r.engines.A.getSnapshot()).toMatchObject({ scratching: false, playing: false });
    expect(r.engines.A.getPlayhead()).toBeCloseTo(11.94);
    r.driver.resumeReplay();
    r.advance(0.1);
    expect(r.engines.A.getPlayhead()).toBeCloseTo(11.94);
    expect(r.engines.A.loop).toMatchObject({ start: 10, end: 12 });
    r.driver.stop();
  });

  it('queues a later loaded track before its scratch and cancels it on stop', async () => {
    const events: CaptureEvent[] = [
      { t: 0, kind: 'load', channel: 'A', trackId: 1, bpm: 120 },
      { t: 0, kind: 'transport', channel: 'A', action: 'play', playhead: 0 },
      { t: 1, kind: 'load', channel: 'A', trackId: 2, bpm: 120 },
      { t: 2, kind: 'transport', channel: 'A', action: 'scratchBegin', playhead: 20 },
      { t: 2, kind: 'transport', channel: 'A', action: 'scratchMove', playhead: 20, filter: { drive: -8, rate: -2 } },
      { t: 3, kind: 'transport', channel: 'A', action: 'scratchEnd', playhead: 19 },
      { t: 4, kind: 'tick', playheads: {} },
    ];
    const r = rig(planFor(events, 0));
    await r.driver.start();
    r.advance(1.05);
    for (let i = 0; i < 6; i++) await Promise.resolve();
    expect(r.engines.A.trackId).toBe(2);
    expect(r.engines.A.scheduled?.frames[0].time).toBeCloseTo(102.05);
    r.driver.stop();
    expect(r.engines.A.scheduled).toBeNull();
    r.clock.t += 2;
    expect(r.engines.A.getSnapshot().scratching).toBe(false);
  });

  it.each([false, true])('mixer takeover releases replay scratch and preserves prior playing=%s', async (playing) => {
    const events: CaptureEvent[] = [
      { t: 0, kind: 'load', channel: 'A', trackId: 1, bpm: 120 },
      ...(playing ? [{ t: 0, kind: 'transport', channel: 'A', action: 'play', playhead: 20 } as CaptureEvent] : []),
      { t: 0, kind: 'transport', channel: 'A', action: 'scratchBegin', playhead: 20 },
      { t: 0, kind: 'transport', channel: 'A', action: 'scratchMove', playhead: 20, filter: { drive: -8, rate: -2 } },
      { t: 3, kind: 'transport', channel: 'A', action: 'scratchEnd', playhead: 24 },
      { t: 4, kind: 'tick', playheads: {} },
    ];
    const r = rig(planFor(events, 0));
    await r.driver.start();
    r.advance(0.3);
    const position = r.engines.A.getPlayhead();
    r.mixer.setFader('B', 0.3);
    expect(r.stops).toEqual(['takeover']);
    expect(r.engines.A.getSnapshot()).toMatchObject({ scratching: false, playing });
    expect(r.engines.A.getPlayhead()).toBeCloseTo(position);
    expect(r.engines.A.scheduled).toBeNull();
    r.advance(5);
    expect(r.engines.A.getPlayhead()).toBeCloseTo(position + (playing ? 5 : 0));
  });

  it('takeover does not end the replacement human scratch', async () => {
    const events: CaptureEvent[] = [
      { t: 0, kind: 'load', channel: 'A', trackId: 1, bpm: 120 },
      { t: 0, kind: 'transport', channel: 'A', action: 'scratchBegin', playhead: 20 },
      { t: 0, kind: 'transport', channel: 'A', action: 'scratchMove', playhead: 20, filter: { drive: -8, rate: -2 } },
      { t: 3, kind: 'transport', channel: 'A', action: 'scratchEnd', playhead: 24 },
      { t: 4, kind: 'tick', playheads: {} },
    ];
    const r = rig(planFor(events, 0));
    await r.driver.start();
    r.advance(0.3);
    r.engines.A.beginScratch();
    r.engines.A.scratchMove(0.1, 0.02);
    expect(r.stops).toEqual(['takeover']);
    expect(r.engines.A.getSnapshot().scratching).toBe(true);
    expect(r.engines.A.getScratchState()?.drive).toBeGreaterThan(0);
  });

  it('seeds a paused continuous filter, pauses/resumes it, and uses recorded end landing', async () => {
    const events: CaptureEvent[] = [
      { t: 0, kind: 'load', channel: 'A', trackId: 1, bpm: 120 },
      { t: 1, kind: 'transport', channel: 'A', action: 'scratchBegin', playhead: 20 },
      { t: 1, kind: 'transport', channel: 'A', action: 'scratchMove', playhead: 20, filter: { drive: -8, rate: -2 } },
      { t: 4, kind: 'control', channel: 'A', control: 'slipMode', value: 1 },
      { t: 5, kind: 'transport', channel: 'A', action: 'scratchEnd', playhead: 23 },
      { t: 6, kind: 'tick', playheads: {} },
    ];
    const r = rig(planFor(events, 1.008));
    await r.driver.start();
    r.advance(0.05);
    expect(r.engines.A.getSnapshot()).toMatchObject({ playing: false, scratching: true });
    expect(r.engines.A.getScratchState()!.rate).toBeCloseTo(-3.678794, 5);
    r.advance(0.004);
    const position = r.engines.A.getPlayhead();
    const filter = r.engines.A.getScratchState();
    r.driver.pauseReplay();
    expect(r.engines.A.getPlayhead()).toBeCloseTo(position);
    r.advance(10);
    expect(r.engines.A.getPlayhead()).toBeCloseTo(position);
    r.driver.resumeReplay();
    r.advance(0.05);
    expect(r.engines.A.getScratchState()!.rate).toBeCloseTo(filter!.rate, 8);
    r.advance(4);
    expect(r.engines.A.scratchEnds.at(-1)).toBe(23);
    expect(r.engines.A.playing).toBe(false);
    r.driver.stop();
    expect(r.engines.A.scratching).toBe(false);
  });

  it('delivers every batched displacement and never phase-corrects or infers scratch pitch', async () => {
    const events: CaptureEvent[] = [
      { t: 0, kind: 'load', channel: 'A', trackId: 1, bpm: 120 },
      { t: 0, kind: 'transport', channel: 'A', action: 'play', playhead: 20 },
      { t: 1, kind: 'transport', channel: 'A', action: 'scratchBegin', playhead: 21 },
      { t: 1.001, kind: 'transport', channel: 'A', action: 'scratchMove', playhead: 21, filter: { drive: -8, rate: 0 } },
      { t: 1.002, kind: 'transport', channel: 'A', action: 'scratchMove', playhead: 20.998, filter: { drive: -16, rate: -1 } },
      ...[2, 3, 4, 5, 6, 7].map((t): CaptureEvent => ({ t, kind: 'tick', playheads: { A: 100 + t } })),
      { t: 8, kind: 'transport', channel: 'A', action: 'scratchEnd', playhead: 29 },
      { t: 9, kind: 'tick', playheads: {} },
    ];
    const r = rig(planFor(events, 0));
    await r.driver.start();
    r.advance(1.06);
    const seeks = [...r.engines.A.seeks];
    const motions = r.engines.A.scheduled!.frames.filter((f) => f.motion);
    expect(motions).toHaveLength(3);
    expect(motions[2].motion).toMatchObject({ drive: -16, rate: -1 });
    r.advance(0.5);
    expect(r.engines.A.getPlayhead()).toBeCloseTo(20.862);
    for (let i = 0; i < 5; i++) r.advance(1);
    expect(r.engines.A.seeks).toEqual(seeks);
    expect(r.engines.A.pitchPercent).toBe(0);
    r.driver.stop();
  });

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

  it.each([false, true])('pins the playhead to the seek target while loading (paused: %s)', async paused => {
    const r = gatedRig(5);
    await r.driver.start();
    r.advance(2);
    if (paused) r.driver.pauseReplay();
    const seek = r.driver.seekTo(planFor(twoTrackLog(), 25));
    try {
      r.clock.t += 2;
      expect(r.driver.nowT()).toBe(25);
    } finally {
      r.release();
      await seek;
      r.driver.stop();
    }
  });

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

describe('SessionReplayDriver — stab replay (sessions 12)', () => {
  function stabLog(): CaptureEvent[] {
    return [
      ...seedEvents(0),
      { t: 1, kind: 'load', channel: 'A', trackId: 11, bpm: 174 },
      { t: 1.5, kind: 'load', channel: 'C', trackId: 33, bpm: 140 },
      { t: 2, kind: 'transport', channel: 'A', action: 'play', playhead: 50 },
      { t: 3, kind: 'tick', playheads: { A: 51 } },
      { t: 6, kind: 'transport', channel: 'C', action: 'previewStart', playhead: 64, detail: 3 },
      { t: 7, kind: 'tick', playheads: { A: 55, C: 65 } },
      { t: 8, kind: 'transport', channel: 'C', action: 'previewEnd', playhead: 64 },
      { t: 10, kind: 'tick', playheads: { A: 58 } },
    ];
  }

  it('executes a stab audibly on the original deck via the preview entry point', async () => {
    const r = rig(planFor(stabLog(), 4));
    await r.driver.start();
    expect(r.engines.C.previews).toEqual([]);
    // offset 2 (t=6): the stab launches on C — exact position, previewing.
    r.advance(2.0);
    expect(r.engines.C.previews).toEqual([{ kind: 'start', at: 64 }]);
    expect(r.engines.C.previewing).toBe(true);
    expect(r.engines.C.playing).toBe(false);
    // offset 4 (t=8): released — stopped back at the recorded return.
    r.advance(2.0);
    expect(r.engines.C.previews).toEqual([
      { kind: 'start', at: 64 },
      { kind: 'end', returnTo: 64 },
    ]);
    expect(r.engines.C.previewing).toBe(false);
    expect(r.engines.C.playhead).toBe(64);
    // The driver's own preview gestures never tripped the watchers.
    expect(r.stops).toEqual([]);
    r.driver.stop();
  });

  it('a HUMAN stab mid-replay is a takeover (previewing flip outside self-ops)', async () => {
    const r = rig(planFor(stabLog(), 4));
    await r.driver.start();
    r.engines.B.humanStab();
    expect(r.stops).toEqual(['takeover']);
    expect(audibleHolder()).toBe('shared');
  });

  it('a window opening mid-stab skips it (dangling previewEnd no-ops)', async () => {
    const r = rig(planFor(stabLog(), 7)); // inside the stab
    await r.driver.start();
    // C seeds as a paused deck (previewing is not modeled in seeds — v1
    // boundary); the dangling previewEnd cue at offset 1 no-ops.
    r.advance(1.0);
    expect(r.engines.C.previews).toEqual([]);
    expect(r.engines.C.previewing).toBe(false);
    expect(r.stops).toEqual([]);
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

describe('SessionReplayDriver — steady playback is left alone (jitter fix)', () => {
  it('small tick-vs-clock skew never triggers a corrective seek', async () => {
    // A STEADY ~0.1s recorded-tick skew (wall-clock lag, constant): the
    // stream the jitter fix protects. NOTE the original fixture here
    // accidentally encoded GROWING drift (0.1s per tick) — that is real
    // desync and the persistent-drift corrector now fixes it (see the
    // deadband-regression suite); constant skew stays untouched.
    const events: CaptureEvent[] = [
      ...seedEvents(0),
      { t: 1, kind: 'load', channel: 'A', trackId: 11, bpm: 174 },
      { t: 2, kind: 'transport', channel: 'A', action: 'play', playhead: 50 },
      { t: 3, kind: 'tick', playheads: { A: 50.9 } },
      { t: 4, kind: 'tick', playheads: { A: 51.9 } },
      { t: 5, kind: 'tick', playheads: { A: 52.9 } },
      { t: 6, kind: 'tick', playheads: { A: 53.9 } },
      { t: 7, kind: 'tick', playheads: { A: 54.9 } },
    ];
    const r = rig(planFor(events, 2));
    await r.driver.start();
    // The FIRST tick may start-snap (an offset at t=0 is indistinguishable
    // from start stagger, and snapping before any phase is established is
    // free). The invariant this test protects: NO PERIODIC seeks after.
    r.advance(1.0);
    const afterSnap = r.engines.A.seeks.length;
    for (let i = 0; i < 4; i++) r.advance(1.0);
    expect(r.engines.A.seeks.length).toBe(afterSnap);
    r.driver.stop();
  });
});

describe('SessionReplayDriver — trim playback (sessions 15)', () => {
  /** A performance trim ride: play, then duck the trim, then restore. */
  function trimRideLog(): CaptureEvent[] {
    return [
      ...seedEvents(0),
      { t: 0.5, kind: 'control', control: 'trim', channel: 'A', value: 0.6 },
      { t: 1, kind: 'load', channel: 'A', trackId: 11, bpm: 174 },
      { t: 2, kind: 'transport', channel: 'A', action: 'play', playhead: 50 },
      { t: 3, kind: 'tick', playheads: { A: 51 } },
      { t: 5, kind: 'control', control: 'trim', channel: 'A', value: 0.2 }, // the duck
      { t: 7, kind: 'control', control: 'trim', channel: 'A', value: 0.6 }, // restore
      { t: 9, kind: 'transport', channel: 'A', action: 'pause', playhead: 57 },
      { t: 10, kind: 'tick', playheads: {} },
    ];
  }

  it('seeds the recorded trim into the overlay lane; base trim stays live', async () => {
    const r = rig(planFor(trimRideLog(), 3));
    r.mixer.channels.A = { ...r.mixer.channels.A, trim: 0.9 }; // the live user's staging
    await r.driver.start();
    expect(r.mixer.automation?.A?.trim).toBe(0.6); // recorded, on the lane
    expect(r.mixer.channels.A.trim).toBe(0.9); // base untouched
    r.driver.stop();
  });

  it('replays the trim duck and restore at their cue offsets', async () => {
    const r = rig(planFor(trimRideLog(), 3));
    await r.driver.start();
    expect(r.mixer.automation?.A?.trim).toBe(0.6);
    r.advance(2.5); // past t=5
    expect(r.mixer.automation?.A?.trim).toBe(0.2); // the duck landed
    r.advance(2); // past t=7
    expect(r.mixer.automation?.A?.trim).toBe(0.6); // restored
    r.driver.stop();
  });

  it('a takeover lands the lane trim in base — no gain jump', async () => {
    const r = rig(planFor(trimRideLog(), 3));
    await r.driver.start();
    r.advance(2.5); // the duck (0.2) is the sounding trim
    r.engines.A.humanPause(); // manual gesture → takeover
    expect(r.stops).toEqual(['takeover']);
    expect(r.mixer.channels.A.trim).toBe(0.2); // base synced to the sound
    expect(audibleHolder()).toBe('shared');
  });

  it('a live trim move during replay is a takeover (unchanged semantics)', async () => {
    const r = rig(planFor(trimRideLog(), 3));
    await r.driver.start();
    r.mixer.setTrim('A', 0.8); // human reaches for the knob
    expect(r.stops).toEqual(['takeover']);
    // The human's own gesture wins: their trim value survives the sync.
    expect(r.mixer.channels.A.trim).toBe(0.8);
  });
});

describe('SessionReplayDriver — persistent drift correction (deadband regression)', () => {
  /** A log whose recorded playheads advance SLOWER than the replay engine
   * will (0.96 track-sec per wall-sec): the original performer was riding
   * pitch bends the log does not replay (clock-rate skew presents the
   * same way, slower). Engine-vs-record drift grows ~0.04s per tick —
   * real, persistent, and (pre-fix) parked forever in the sub-0.5s
   * deadband: over a beat out at 174 BPM by t≈9. */
  function driftLog(n = 30): CaptureEvent[] {
    const evs: CaptureEvent[] = [
      ...seedEvents(0),
      { t: 1, kind: 'load', channel: 'A', trackId: 11, bpm: 174 },
      { t: 2, kind: 'transport', channel: 'A', action: 'play', playhead: 50 },
    ];
    for (let k = 1; k <= n; k++) {
      evs.push({ t: 2 + k, kind: 'tick', playheads: { A: 50 + k * 0.96 } });
    }
    return evs;
  }

  it('accumulating drift is corrected before it reaches one beat', async () => {
    const r = rig(planFor(driftLog(), 2));
    await r.driver.start();
    const seedSeeks = r.engines.A.seeks.length;
    let maxDrift = 0;
    for (let k = 1; k <= 20; k++) {
      r.advance(1.0);
      const recorded = 50 + k * 0.96;
      maxDrift = Math.max(maxDrift, Math.abs(r.engines.A.getPlayhead() - recorded));
    }
    // The servo + rate blend keep the deck inside a beat at all times —
    // and mostly WITHOUT seeks (sessions 20): at most the one mid-tier
    // coordinated seek while the rate blend converges.
    expect(maxDrift).toBeLessThan(0.345);
    expect(r.engines.A.seeks.length - seedSeeks).toBeLessThanOrEqual(2);
    // Endgame: locked onto the log's trajectory.
    const recorded = 50 + 20 * 0.96;
    expect(Math.abs(r.engines.A.getPlayhead() - recorded)).toBeLessThan(0.1);
    r.driver.stop();
  });

  it('steady-state playback is seek-free (the servo does the work)', async () => {
    const r = rig(planFor(driftLog(), 2));
    await r.driver.start();
    for (let k = 1; k <= 12; k++) r.advance(1.0); // converge
    const seeks = r.engines.A.seeks.length;
    for (let k = 1; k <= 15; k++) r.advance(1.0);
    expect(r.engines.A.seeks.length).toBe(seeks); // zero in steady state
    r.driver.stop();
  });

  it('one janky outlier tick never seeks (median, not sample)', async () => {
    const evs: CaptureEvent[] = [
      ...seedEvents(0),
      { t: 1, kind: 'load', channel: 'A', trackId: 11, bpm: 174 },
      { t: 2, kind: 'transport', channel: 'A', action: 'play', playhead: 50 },
    ];
    for (let k = 1; k <= 12; k++) {
      // Tick 6 is a 0.4s jank spike; every other tick is on-trajectory.
      const spike = k === 6 ? -0.4 : 0;
      evs.push({ t: 2 + k, kind: 'tick', playheads: { A: 50 + k + spike } });
    }
    const r = rig(planFor(evs, 2));
    await r.driver.start();
    const seedSeeks = r.engines.A.seeks.length;
    for (let k = 1; k <= 10; k++) r.advance(1.0);
    expect(r.engines.A.seeks.length).toBe(seedSeeks);
    r.driver.stop();
  });
});

describe('SessionReplayDriver — rate inference + coordinated correction (sessions 18)', () => {
  /** A pitch-less legacy log: the deck was pitched +2% BEFORE the session,
   * so no pitch event exists — recorded playheads advance at 1.02×. */
  function pitchlessLog(n = 40): CaptureEvent[] {
    const evs: CaptureEvent[] = [
      ...seedEvents(0),
      { t: 1, kind: 'load', channel: 'A', trackId: 11, bpm: 174 },
      { t: 2, kind: 'transport', channel: 'A', action: 'play', playhead: 50 },
    ];
    for (let k = 1; k <= n; k++) {
      evs.push({ t: 2 + k, kind: 'tick', playheads: { A: 50 + k * 1.02 } });
    }
    return evs;
  }

  it('converges the engine pitch to the recorded rate and corrections cease', async () => {
    const r = rig(planFor(pitchlessLog(), 2));
    await r.driver.start();
    expect(r.engines.A.pitchPercent).toBe(0); // seeded pitch-less
    for (let k = 1; k <= 8; k++) r.advance(1.0);
    // Rate inference matched the engine to the log's slope.
    expect(r.engines.A.pitchPercent).toBeCloseTo(2, 0);
    // With the rate matched, drift stops growing: NO corrective seeks
    // over a long steady stretch.
    const seeksAfterConverge = r.engines.A.seeks.length;
    for (let k = 1; k <= 20; k++) r.advance(1.0);
    expect(r.engines.A.seeks.length).toBe(seeksAfterConverge);
    // And the deck tracks the recorded trajectory closely (28 advances).
    expect(Math.abs(r.engines.A.getPlayhead() - (50 + 28 * 1.02))).toBeLessThan(0.2);
    r.driver.stop();
  });

  it('a recorded pitch cue is not fought by inference', async () => {
    // Pitch event at t=10 to +2%: ticks advance at 1.0 before, 1.02 after.
    const evs: CaptureEvent[] = [
      ...seedEvents(0),
      { t: 1, kind: 'load', channel: 'A', trackId: 11, bpm: 174 },
      { t: 2, kind: 'transport', channel: 'A', action: 'play', playhead: 50 },
    ];
    for (let k = 1; k <= 8; k++) evs.push({ t: 2 + k, kind: 'tick', playheads: { A: 50 + k } });
    evs.push({ t: 10.5, kind: 'pitch', channel: 'A', value: 2 });
    for (let k = 9; k <= 24; k++)
      evs.push({ t: 2 + k, kind: 'tick', playheads: { A: 58.5 + (k - 8.5) * 1.02 } });
    const r = rig(planFor(evs, 2));
    await r.driver.start();
    for (let k = 1; k <= 20; k++) r.advance(1.0);
    // The cue set +2 and inference found no residual mismatch to fight.
    expect(r.engines.A.pitchPercent).toBeCloseTo(2, 0);
    r.driver.stop();
  });

  it('a common-mode step corrects BOTH decks in one frame — relative phase preserved', async () => {
    // Two decks on-trajectory, then both recorded playheads step +0.25
    // (common-mode). A step is not a rate (linear-fit reject): it must be
    // drained by the coordinated median corrector, both decks together.
    const evs: CaptureEvent[] = [
      ...seedEvents(0),
      { t: 1, kind: 'load', channel: 'A', trackId: 11, bpm: 174 },
      { t: 1.2, kind: 'load', channel: 'B', trackId: 12, bpm: 174 },
      { t: 2, kind: 'transport', channel: 'A', action: 'play', playhead: 50 },
      { t: 2, kind: 'transport', channel: 'B', action: 'play', playhead: 80 },
    ];
    for (let k = 1; k <= 30; k++) {
      const step = k >= 10 ? -0.25 : 0; // recorded falls behind → engine ahead
      evs.push({ t: 2 + k, kind: 'tick', playheads: { A: 50 + k + step, B: 80 + k + step } });
    }
    const r = rig(planFor(evs, 2));
    await r.driver.start();
    const relBefore = r.engines.A.getPlayhead() - r.engines.B.getPlayhead();
    let sawSameFrame = false;
    for (let k = 1; k <= 25; k++) {
      const a0 = r.engines.A.seeks.length;
      const b0 = r.engines.B.seeks.length;
      r.advance(1.0);
      if (r.engines.A.seeks.length > a0 && r.engines.B.seeks.length > b0) sawSameFrame = true;
    }
    expect(sawSameFrame).toBe(true); // both corrected in one frame
    // No spurious pitch change from the step (linear-fit reject).
    expect(r.engines.A.pitchPercent).toBeCloseTo(0, 1);
    // Relative phase across the whole episode is preserved.
    const relAfter = r.engines.A.getPlayhead() - r.engines.B.getPlayhead();
    expect(Math.abs(relAfter - relBefore)).toBeLessThan(0.05);
    r.driver.stop();
  });
});

describe('SessionReplayDriver — phase servo (sessions 20)', () => {
  /** On-trajectory ticks with a constant offset injected from tick `from`:
   * recorded playheads fall back by `step` — the engine is suddenly ahead
   * by `step`, the exact shape of start-latency stagger. */
  function offsetLog(step: number, from = 5, n = 40, deck: 'A' | 'B' = 'A'): CaptureEvent[] {
    const evs: CaptureEvent[] = [
      ...seedEvents(0),
      { t: 1, kind: 'load', channel: deck, trackId: 11, bpm: 174 },
      { t: 2, kind: 'transport', channel: deck, action: 'play', playhead: 50 },
    ];
    for (let k = 1; k <= n; k++) {
      evs.push({ t: 2 + k, kind: 'tick', playheads: { [deck]: 50 + k - (k >= from ? step : 0) } });
    }
    return evs;
  }

  it('a sub-seek-tier offset drains via rate bias — ZERO seeks', async () => {
    const r = rig(planFor(offsetLog(0.08), 2));
    await r.driver.start();
    const seedSeeks = r.engines.A.seeks.length;
    for (let k = 1; k <= 30; k++) r.advance(1.0);
    expect(r.engines.A.seeks.length).toBe(seedSeeks); // no jumps, ever
    // The offset drained: engine back on the recorded trajectory.
    const recorded = 50 + 30 - 0.08;
    expect(Math.abs(r.engines.A.getPlayhead() - recorded)).toBeLessThan(0.03);
    r.driver.stop();
  });

  it('the bias is error-scheduled: firm (≤4%) at large error, gentle (≤1%) small', async () => {
    // 0.15s injected mid-play (past the start-snap window): large-error
    // tier engages, drains fast, then hands off to the gentle tier.
    const r = rig(planFor(offsetLog(0.15, 8), 2));
    await r.driver.start();
    let maxAbsPitch = 0;
    let ticksOver = 0;
    for (let k = 1; k <= 30; k++) {
      r.advance(1.0);
      const p = Math.abs(r.engines.A.pitchPercent);
      maxAbsPitch = Math.max(maxAbsPitch, p);
      if (p > 1.05) ticksOver += 1;
    }
    expect(maxAbsPitch).toBeLessThanOrEqual(4.05); // firm tier cap
    expect(ticksOver).toBeLessThanOrEqual(8); // …but only briefly
    // Converged well inside the old 1%-only timeline.
    const recorded = 50 + 30 - 0.15;
    expect(Math.abs(r.engines.A.getPlayhead() - recorded)).toBeLessThan(0.03);
    r.driver.stop();
  });

  it('start-latency stagger snaps at the FIRST tick — no salvo of correction', async () => {
    // The offset exists from tick 1: exactly what a late engine start
    // looks like. One inaudible-at-start seek, then locked — not 15s of
    // audible half-sync.
    const r = rig(planFor(offsetLog(0.12, 1), 2));
    await r.driver.start();
    const seedSeeks = r.engines.A.seeks.length;
    r.advance(1.0); // first sync tick
    expect(r.engines.A.seeks.length).toBe(seedSeeks + 1); // the snap
    for (let k = 2; k <= 10; k++) r.advance(1.0);
    expect(r.engines.A.seeks.length).toBe(seedSeeks + 1); // and nothing else
    const recorded = 50 + 10 - 0.12;
    expect(Math.abs(r.engines.A.getPlayhead() - recorded)).toBeLessThan(0.03);
    // Bias never had to engage meaningfully.
    expect(Math.abs(r.engines.A.pitchPercent)).toBeLessThan(1.1);
    r.driver.stop();
  });

  it('a replayed play cue re-arms the start snap for that deck', async () => {
    // Deck pauses then plays again in the log; its restart stagger snaps.
    const evs: CaptureEvent[] = [
      ...seedEvents(0),
      { t: 1, kind: 'load', channel: 'A', trackId: 11, bpm: 174 },
      { t: 2, kind: 'transport', channel: 'A', action: 'play', playhead: 50 },
      { t: 3, kind: 'tick', playheads: { A: 51 } },
      { t: 4, kind: 'transport', channel: 'A', action: 'pause', playhead: 52 },
      { t: 6, kind: 'transport', channel: 'A', action: 'play', playhead: 52 },
      // Recorded trajectory shows the deck 0.1 behind the cue landing —
      // restart stagger. Snap expected at the next tick.
      { t: 7, kind: 'tick', playheads: { A: 52.9 } },
      { t: 8, kind: 'tick', playheads: { A: 53.9 } },
      { t: 9, kind: 'tick', playheads: { A: 54.9 } },
      { t: 12, kind: 'tick', playheads: { A: 57.9 } },
    ];
    const r = rig(planFor(evs, 2));
    await r.driver.start();
    for (let k = 1; k <= 6; k++) r.advance(1.0); // now at t=8
    // Locked to the recorded (staggered) trajectory.
    expect(Math.abs(r.engines.A.getPlayhead() - 53.9)).toBeLessThan(0.05);
    r.driver.stop();
  });

  it('opposite offsets on two decks: relative phase converges, zero seeks', async () => {
    // A ends up 0.08 ahead of its log, B 0.08 behind — 0.16 relative,
    // audible, and (pre-servo) permanently under every seek threshold.
    const evs: CaptureEvent[] = [
      ...seedEvents(0),
      { t: 1, kind: 'load', channel: 'A', trackId: 11, bpm: 174 },
      { t: 1.2, kind: 'load', channel: 'B', trackId: 12, bpm: 174 },
      { t: 2, kind: 'transport', channel: 'A', action: 'play', playhead: 50 },
      { t: 2, kind: 'transport', channel: 'B', action: 'play', playhead: 80 },
    ];
    for (let k = 1; k <= 40; k++) {
      const dA = k >= 5 ? 0.08 : 0;
      const dB = k >= 5 ? -0.08 : 0;
      evs.push({ t: 2 + k, kind: 'tick', playheads: { A: 50 + k - dA, B: 80 + k - dB } });
    }
    const r = rig(planFor(evs, 2));
    await r.driver.start();
    const seeksA = r.engines.A.seeks.length;
    const seeksB = r.engines.B.seeks.length;
    for (let k = 1; k <= 30; k++) r.advance(1.0);
    expect(r.engines.A.seeks.length).toBe(seeksA);
    expect(r.engines.B.seeks.length).toBe(seeksB);
    // Both locked to their logs → locked to each other.
    const relTruth = (50 + 30 - 0.08) - (80 + 30 + 0.08);
    const rel = r.engines.A.getPlayhead() - r.engines.B.getPlayhead();
    expect(Math.abs(rel - relTruth)).toBeLessThan(0.05);
    r.driver.stop();
  });
});

describe('SessionReplayDriver — Beat FX (#351)', () => {
  const LIVE: BeatFxSectionState = { selected: 'flanger', target: 'D', on: true, depth: -0.2, beats: 4 };
  const ECHO_A: BeatFxSectionState = { selected: 'echo', target: 'A', on: true, depth: 0.3, beats: 0.5 };
  function fxLog(): CaptureEvent[] {
    const fx: CaptureEvent[] = [
      { t: 1, kind: 'beatFx', ...ECHO_A },
      { t: 7, kind: 'beatFx', ...ECHO_A, on: false },
    ];
    return [...simpleLog(), ...fx].sort((a, b) => a.t - b.t);
  }

  it('seeds the recorded section, fires FX cues, and restores the live section on stop', async () => {
    const r = rig(planFor(fxLog(), 2));
    r.mixer.beatFx = { ...LIVE };
    await r.driver.start();
    expect(r.mixer.beatFx).toEqual(ECHO_A);
    r.advance(5.1); // t = 7.1
    expect(r.mixer.beatFx).toEqual({ ...ECHO_A, on: false });
    expect(r.stops).toEqual([]);
    r.driver.stop();
    expect(r.mixer.beatFx).toEqual(LIVE);
  });

  it('a log without FX evidence replays with FX off, and the live section returns at the end', async () => {
    const r = rig(planFor(simpleLog(), 2));
    r.mixer.beatFx = { ...LIVE };
    await r.driver.start();
    expect(r.mixer.beatFx).toEqual({ ...LIVE, on: false });
    r.advance(9);
    expect(r.stops).toEqual(['ended']);
    expect(r.mixer.beatFx).toEqual(LIVE);
  });

  it('a human FX gesture takes over and keeps the section as the human left it', async () => {
    const r = rig(planFor(fxLog(), 2));
    r.mixer.beatFx = { ...LIVE };
    await r.driver.start();
    r.mixer.setBeatFxSection({ ...ECHO_A, depth: 0.9 });
    expect(r.stops).toEqual(['takeover']);
    expect(r.mixer.beatFx).toEqual({ ...ECHO_A, depth: 0.9 });
  });
});
