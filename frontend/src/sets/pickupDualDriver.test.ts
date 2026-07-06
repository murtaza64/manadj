/**
 * Issue 25 regression — the pickup/audition dual-driver bug, at the
 * arbiter seam.
 *
 * The incident: with the Transition editor AUDITIONING (editor holds the
 * audible surface, its MixPlayer conducting the shared decks), pressing
 * Pick up in the Set pane installed a Conductor with silencePrevious:
 * false — the displaced editor was never silenced, its rAF loop kept
 * conducting, and two drivers fought over deck B (alternating seeks and
 * rate writes: the audible rubber-band).
 *
 * The fix under test: `evaluatePickup` refuses any non-'shared' holder
 * (you cannot pick up from an editor audition — its deck state is
 * mix-timeline semantics, not a live performance), so the executor
 * (`pickupSetPlayback`) is a pure no-op while the editor holds: no
 * Conductor, no engine commands, no claim — the audition keeps playing,
 * ONE driver on the shared decks. The companion test proves the same
 * deck state lights and executes once the editor releases (the refusal
 * is the holder's doing, nothing else).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MixPlayer } from '../editor/MixPlayer';
import { defaultMix, type Transition } from '../editor/mixModel';
import {
  _resetAudibleSurfacesForTests,
  audibleHolder,
  claimAudible,
  isAudible,
  registerSurface,
  releaseAudible,
  unregisterSurface,
} from '../playback/audibleSurface';
import type { DeckEngine } from '../playback/DeckEngine';
import type { ChannelId, Mixer } from '../playback/mixer';
import { getConductor, pickupSetPlayback, stopSetPlayback } from './conductorStore';
import { planSet, type SetPlan } from './planner';

// ── Fakes (action logs — harness style per issue 25's acceptance) ──────

class FakeEngine {
  trackId: number | null = null;
  playhead = 0;
  playing = false;
  /** Every command any driver sends this deck. */
  calls: string[] = [];

  getSnapshot() {
    return {
      trackId: this.trackId,
      loadState: this.trackId === null ? 'empty' : 'ready',
      duration: 240,
      playing: this.playing,
      pitchPercent: 0,
      bendPercent: 0,
      previewing: false,
      hotCuePreviewSlot: null,
      keyLock: true,
    } as ReturnType<DeckEngine['getSnapshot']>;
  }

  getPlayhead(): number {
    return this.playhead;
  }

  seek(t: number): void {
    this.calls.push(`seek:${t.toFixed(2)}`);
    this.playhead = t;
  }

  play(): void {
    this.calls.push('play');
    this.playing = true;
  }

  pause(): void {
    this.calls.push('pause');
    this.playing = false;
  }

  setPitch(p: number): void {
    this.calls.push(`pitch:${p.toFixed(2)}`);
  }

  subscribe(): () => void {
    return () => {};
  }

  addTransportEventListener(): () => void {
    return () => {};
  }
}

function fakeMixer(): Mixer {
  // Channel A open, channel B faded out: the one-deck pickup case (A
  // anchors; B is loaded for the editor but silent on the Master bus).
  const channels = {
    A: { trim: 0.5, fader: 1, eq: { low: 0.5, mid: 0.5, high: 0.5 }, filter: 0 },
    B: { trim: 0.5, fader: 0, eq: { low: 0.5, mid: 0.5, high: 0.5 }, filter: 0 },
  };
  return {
    now: () => 0,
    engageAutomation: () => Symbol('test-owner'),
    disengageAutomation: () => {},
    setAutomation: () => {},
    subscribe: () => () => {},
    getChannelState: (ch: ChannelId) => channels[ch],
    getCrossfader: () => 0,
    getCrossfaderEnabled: () => false,
    getMaster: () => 1,
  } as unknown as Mixer;
}

/** Two-track plan; deck A playing track 1 at 30s maps cleanly (lit). */
function plan(): SetPlan {
  const transition: Transition = {
    startSec: 60,
    durationSec: 20,
    bInSec: 8,
    tempoMatch: false,
    lanes: {},
  };
  return planSet({
    entries: [
      { trackId: 1, pin: { kind: 'transition', uuid: 'w' } },
      { trackId: 2, pin: null },
    ],
    tracks: {
      1: { durationSec: 90, bpm: 120, hotCue1Sec: null },
      2: { durationSec: 240, bpm: 120, hotCue1Sec: null },
    },
    transitionsByUuid: { w: transition },
    takesByUuid: {},
  });
}

beforeEach(() => {
  _resetAudibleSurfacesForTests();
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});

afterEach(() => {
  stopSetPlayback();
  _resetAudibleSurfacesForTests();
  vi.unstubAllGlobals();
});

function harness() {
  const engines = { A: new FakeEngine(), B: new FakeEngine() };
  engines.A.trackId = 1;
  engines.B.trackId = 2;
  const mixer = fakeMixer();
  // The editor's wiring shape (TransitionEditor): registered surface,
  // MixPlayer gated on the editor's holder membership.
  const player = new MixPlayer(defaultMix(), {
    mixer,
    engineA: engines.A as unknown as DeckEngine,
    engineB: engines.B as unknown as DeckEngine,
    audible: () => isAudible('editor'),
  });
  registerSurface('editor', {
    transport: { togglePlay: () => {} },
    silence: () => player.pause(),
  });
  const audio = {
    mixer,
    engines: engines as unknown as Record<ChannelId, DeckEngine>,
  };
  const loads: string[] = [];
  const pickup = () =>
    pickupSetPlayback(
      7,
      plan(),
      audio,
      (deck, trackId) => {
        loads.push(`${deck}:${trackId}`);
        engines[deck].trackId = trackId;
      },
      { rampSec: 1.5 }
    );
  return { engines, player, pickup, loads };
}

describe('pickup during an editor audition (the issue-25 repro)', () => {
  it('is refused: no Conductor, no engine commands, the audition keeps playing', () => {
    const { engines, player, pickup, loads } = harness();
    claimAudible('editor'); // the audition gesture's claim (sets 21)
    player.play();
    expect(player.isPlaying()).toBe(true);
    engines.A.playhead = 30; // deck state that WOULD light when shared

    const before = { A: [...engines.A.calls], B: [...engines.B.calls] };
    const decision = pickup();

    expect(decision).toMatchObject({ lit: false, reason: 'not-performance' });
    expect(getConductor()).toBeNull(); // no second driver installed
    expect(audibleHolder()).toBe('editor'); // the audition was not displaced
    expect(player.isPlaying()).toBe(true); // …and keeps conducting alone
    expect(engines.A.calls).toEqual(before.A); // the attempt wrote nothing
    expect(engines.B.calls).toEqual(before.B);
    expect(loads).toEqual([]);
  });

  it('the same deck state lights and executes once the editor releases', () => {
    const { engines, player, pickup } = harness();
    claimAudible('editor');
    player.play();
    engines.A.playhead = 30;
    releaseAudible('editor'); // stop the audition (silence() pauses the player)
    expect(player.isPlaying()).toBe(false);
    unregisterSurface('editor');

    const decision = pickup();
    expect(decision).toMatchObject({ lit: true, mixTime: 30 });
    expect(getConductor()).not.toBeNull(); // the ONE driver now conducting
    expect(audibleHolder()).toBe('conductor');
  });
});
