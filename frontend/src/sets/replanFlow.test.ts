/**
 * Live re-plan store flow (sets 24) — replanSetPlayback end-to-end over
 * fakes (pickupDualDriver.test.ts's harness style): the ongoing run
 * re-plans in place, the sounding window's geometry defers until the
 * window completes (the graft expiry poll lands it), and the
 * anchor-gone fallback stands the Conductor down with the decks still
 * sounding (takeover semantics — the Pickup button teaches the rest).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Transition } from '../editor/mixModel';
import { _resetAudibleSurfacesForTests } from '../playback/audibleSurface';
import type { DeckEngine } from '../playback/DeckEngine';
import type { ChannelId, Mixer } from '../playback/mixer';
import {
  getConductor,
  replanSetPlayback,
  startSetPlayback,
  stopSetPlayback,
} from './conductorStore';
import { planSet, type PlanInput } from './planner';

// ── Fakes (Conductor.test.ts's clock-anchored engine, zero latency) ────

let now = 0;
let pendingFrame: (() => void) | null = null;

function tickAt(t: number): void {
  now = t;
  const frame = pendingFrame;
  pendingFrame = null;
  frame?.();
}

class FakeEngine {
  trackId: number | null = null;
  seeks = 0;
  pauses = 0;
  pitchPercent = 0;
  private playingFlag = false;
  private parkedAt = 0;
  private anchorPos = 0;
  private anchorCtx = 0;
  private subs = new Set<() => void>();

  getSnapshot() {
    return {
      trackId: this.trackId,
      loadState: this.trackId === null ? 'empty' : 'ready',
      playing: this.playingFlag,
      duration: 240,
      pitchPercent: this.pitchPercent,
      bendPercent: 0,
      previewing: false,
      hotCuePreviewSlot: null,
      keyLock: true,
    } as ReturnType<DeckEngine['getSnapshot']>;
  }

  getPlayhead(): number {
    if (!this.playingFlag) return this.parkedAt;
    return this.anchorPos + (now - this.anchorCtx);
  }

  seek(t: number): void {
    this.seeks++;
    if (this.playingFlag) {
      this.anchorPos = t;
      this.anchorCtx = now;
    } else {
      this.parkedAt = t;
    }
    this.emit();
  }

  play(): void {
    if (this.playingFlag) return;
    this.playingFlag = true;
    this.anchorPos = this.parkedAt;
    this.anchorCtx = now;
    this.emit();
  }

  pause(): void {
    if (!this.playingFlag) return;
    this.pauses++;
    this.parkedAt = this.getPlayhead();
    this.playingFlag = false;
    this.emit();
  }

  setPitch(p: number): void {
    this.pitchPercent = p;
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

function fakeMixer(): Mixer {
  const channel = { fader: 1, trim: 0.5, eq: { low: 0.5, mid: 0.5, high: 0.5 }, filter: 0, pfl: false };
  return {
    now: () => now,
    engageAutomation: () => Symbol('test-owner'),
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

const tr = (over: Partial<Transition> = {}): Transition => ({
  startSec: 60,
  durationSec: 20,
  bInSec: 8,
  tempoMatch: false,
  lanes: {},
  ...over,
});

/** Two tracks, window w on the mix axis 60..80 (B in at its own t=8). */
function makeInput(over: Partial<PlanInput> = {}): PlanInput {
  return {
    entries: [
      { trackId: 1, pin: { kind: 'transition', uuid: 'w' } },
      { trackId: 2, pin: null },
    ],
    tracks: {
      1: { durationSec: 90, bpm: 120, hotCue1Sec: null },
      2: { durationSec: 240, bpm: 120, hotCue1Sec: null },
    },
    transitionsByUuid: { w: tr() },
    takesByUuid: {},
    ...over,
  };
}

function harness() {
  const engines = { A: new FakeEngine(), B: new FakeEngine() };
  const audio = {
    mixer: fakeMixer(),
    engines: engines as unknown as Record<ChannelId, DeckEngine>,
  };
  const loadTrack = (deck: ChannelId, trackId: number) => {
    engines[deck].trackId = trackId;
  };
  return { engines, audio, loadTrack };
}

beforeEach(() => {
  now = 0;
  pendingFrame = null;
  _resetAudibleSurfacesForTests();
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
    pendingFrame = cb;
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {
    pendingFrame = null;
  });
});

afterEach(() => {
  stopSetPlayback();
  vi.useRealTimers();
  _resetAudibleSurfacesForTests();
  vi.unstubAllGlobals();
});

describe('live re-plan store flow (sets 24)', () => {
  it('a downstream edit re-plans in place; the same run continues', () => {
    const { audio, loadTrack, engines } = harness();
    startSetPlayback(1, planSet(makeInput()), audio, loadTrack);
    tickAt(0);
    tickAt(0.05);
    tickAt(30); // track 1 solo
    const before = getConductor()!;
    const seeks = engines.A.seeks;
    replanSetPlayback(1, makeInput({ transitionsByUuid: { w: tr({ startSec: 50 }) } }));
    const after = getConductor()!;
    expect(after).toBe(before); // same run — the borrow never bounced
    expect(after.plan.adjacencies[0].transition!.startSec).toBe(50);
    expect(engines.A.seeks).toBe(seeks); // anchor untouched
    expect(after.isPlaying()).toBe(true);
    expect(after.getMixTime()).toBeCloseTo(30, 3);
  });

  it('a mid-window geometry edit defers until the window completes, then lands', () => {
    const { audio, loadTrack } = harness();
    startSetPlayback(1, planSet(makeInput()), audio, loadTrack);
    tickAt(0);
    tickAt(0.05);
    tickAt(65); // inside the window (60..80)
    const newLanes = { faderA: [{ x: 0, y: 0.25 }] };
    replanSetPlayback(
      1,
      makeInput({
        transitionsByUuid: { w: tr({ startSec: 40, durationSec: 5, bInSec: 0, lanes: newLanes }) },
      })
    );
    const c = getConductor()!;
    // Deferred: the sounding window keeps its executed geometry…
    expect(c.plan.adjacencies[0].transition!.startSec).toBe(60);
    expect(c.plan.adjacencies[0].transition!.durationSec).toBe(20);
    // …while its lane VALUES ride live…
    expect(c.plan.adjacencies[0].transition!.lanes).toEqual(newLanes);
    // …and the position is unmoved (the graft keeps the timeline).
    expect(c.getMixTime()).toBeCloseTo(65, 3);

    // The window completes: the expiry poll lands the deferred geometry.
    tickAt(81);
    vi.advanceTimersByTime(300);
    const landed = getConductor()!;
    expect(landed).toBe(c);
    expect(landed.plan.adjacencies[0].transition!.startSec).toBe(40);
    expect(landed.plan.adjacencies[0].transition!.durationSec).toBe(5);
    // The anchor (track 2, deck B) still plays the same track-time.
    // In the old timeline t=81 → B at 8 + 20 + 1 = 29.
    const state = landed.plan.entries[1];
    expect((landed.getMixTime() - state.mixOffsetSec) * state.rate).toBeCloseTo(29, 2);
  });

  it('a reorder that removes the anchor track stands down: decks keep sounding, conducting stops', () => {
    const { audio, loadTrack, engines } = harness();
    startSetPlayback(1, planSet(makeInput()), audio, loadTrack);
    tickAt(0);
    tickAt(0.05);
    tickAt(30); // track 1 solo on deck A
    expect(engines.A.getSnapshot().playing).toBe(true);
    replanSetPlayback(
      1,
      makeInput({
        entries: [{ trackId: 2, pin: null }],
        transitionsByUuid: {},
      })
    );
    // Takeover semantics: idle store, deck A never paused, still playing.
    expect(getConductor()).toBeNull();
    expect(engines.A.pauses).toBe(0);
    expect(engines.A.getSnapshot().playing).toBe(true);
  });
});
