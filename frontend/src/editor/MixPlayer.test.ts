/**
 * MixPlayer audibility gate (sets 21): the editor claims the Audible
 * surface on its first audition gesture, not on mount — so a mounted-but-
 * silent editor's MixPlayer must be a pure model. While `audible()` is
 * false, nothing here may touch the shared engines or the Mixer's
 * automation overlay (another holder — the set Conductor — may be
 * sounding through them); once the claim lands, the first play applies
 * pitch and lanes fresh, so nothing armed while silent is lost.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeckEngine } from '../playback/DeckEngine';
import type { Mixer } from '../playback/mixer';
import { defaultMix } from './mixModel';
import { MixPlayer } from './MixPlayer';

class FakeEngine {
  calls: string[] = [];
  pitches: number[] = [];
  playing = false;
  playhead = 0;

  getSnapshot() {
    return {
      trackId: 1,
      loadState: 'ready',
      duration: 120,
      playing: this.playing,
      pitchPercent: this.pitches.at(-1) ?? 0,
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
    this.pitches.push(p);
  }

  subscribe(): () => void {
    return () => {};
  }
}

function fakeMixer() {
  const automationWrites: string[] = [];
  const mixer = {
    now: () => 0,
    setAutomation: (channel: 'A' | 'B') => automationWrites.push(channel),
  } as unknown as Mixer;
  return { mixer, automationWrites };
}

function makePlayer(audible?: () => boolean) {
  const engineA = new FakeEngine();
  const engineB = new FakeEngine();
  const { mixer, automationWrites } = fakeMixer();
  const player = new MixPlayer(defaultMix(), {
    mixer,
    engineA: engineA as unknown as DeckEngine,
    engineB: engineB as unknown as DeckEngine,
    audible,
  });
  return { player, engineA, engineB, automationWrites };
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('while not audible (mounted-but-silent editor)', () => {
  it('play() is refused — sounding requires the claim', () => {
    const { player, engineA, engineB } = makePlayer(() => false);
    player.play();
    expect(player.isPlaying()).toBe(false);
    expect(engineA.calls).toEqual([]);
    expect(engineB.calls).toEqual([]);
  });

  it('a paused seek moves the model but never the decks or the overlay', () => {
    const { player, engineA, engineB, automationWrites } = makePlayer(() => false);
    player.seek(42);
    expect(player.getMixTime()).toBe(42);
    expect(engineA.calls).toEqual([]);
    expect(engineB.calls).toEqual([]);
    expect(automationWrites).toEqual([]);
  });

  it('model edits never write pitch to the shared deck', () => {
    const { player, engineB } = makePlayer(() => false);
    player.setBpm('A', 128);
    player.setBpm('B', 120); // tempo match is on in defaultMix
    player.setMix(defaultMix());
    expect(engineB.pitches).toEqual([]);
  });

  it('mute toggles never write the overlay', () => {
    const { player, automationWrites } = makePlayer(() => false);
    player.setMuted('A', true);
    expect(automationWrites).toEqual([]);
    expect(player.isMuted('A')).toBe(true); // the model still remembers
  });
});

describe('once the claim lands', () => {
  it('the first audition applies pitch and lanes fresh and starts the decks', () => {
    let audible = false;
    const { player, engineA, engineB, automationWrites } = makePlayer(() => audible);
    player.setBpm('A', 128);
    player.setBpm('B', 120);
    player.seek(10); // armed while silent — engines untouched
    expect(engineA.calls).toEqual([]);

    audible = true; // the editor claimed (ensureEditorAudible)
    player.play();
    expect(player.isPlaying()).toBe(true);
    expect(engineA.calls).toContain('play');
    expect(engineA.playhead).toBe(10); // hard-synced to the silent seek
    expect(automationWrites.length).toBeGreaterThan(0);
    // Tempo match applied at play, not stale from the silent edits.
    expect(engineB.pitches.at(-1)).toBeCloseTo((128 / 120 - 1) * 100, 5);
  });

  it('a paused seek parks the decks again (waveforms show the target)', () => {
    const { player, engineA } = makePlayer(() => true);
    player.seek(10);
    expect(engineA.calls).toContain('seek:10.00');
  });
});

describe('losing the claim mid-audition (sets 25: displacement backstop)', () => {
  it('the next tick stands down — pause, decks stopped, no further writes', () => {
    const frames: (() => void)[] = [];
    vi.stubGlobal('requestAnimationFrame', (fn: () => void) => {
      frames.push(fn);
      return 1;
    });
    let audible = true;
    const { player, engineA, engineB, automationWrites } = makePlayer(() => audible);
    player.play();
    expect(player.isPlaying()).toBe(true);

    // Displaced WITHOUT a silence() (the silencePrevious: false claim
    // shape — pickup's) — the rAF loop itself must stop conducting.
    audible = false;
    const writesBefore = automationWrites.length;
    const beforeA = engineA.calls.length;
    const frame = frames.at(-1);
    if (!frame) throw new Error('no frame scheduled');
    frame();

    expect(player.isPlaying()).toBe(false);
    expect(engineA.calls.slice(beforeA)).toEqual(['pause']);
    expect(engineB.calls.at(-1)).toBe('pause');
    expect(automationWrites.length).toBe(writesBefore); // no lane writes on the way out
  });
});

describe('steady state (chopb diagnosis, folded in per issue 25 notes)', () => {
  it('zero-drift ticks issue no corrective engine commands', () => {
    const frames: (() => void)[] = [];
    vi.stubGlobal('requestAnimationFrame', (fn: () => void) => {
      frames.push(fn);
      return 1;
    });
    const { player, engineA, engineB } = makePlayer(() => true);
    player.play();
    const after = { A: engineA.calls.length, B: engineB.calls.length };
    // Frozen clock (fake mixer now() = 0) → the decks sit exactly on the
    // arrangement: ten ticks must not seek, play, or pause anything.
    for (let i = 0; i < 10; i++) frames.at(-1)?.();
    expect(engineA.calls.length).toBe(after.A);
    expect(engineB.calls.length).toBe(after.B);
    expect(player.isPlaying()).toBe(true);
  });
});

describe('default gate', () => {
  it('omitted audible = standalone player, always audible', () => {
    const { player, engineA } = makePlayer();
    player.play();
    expect(player.isPlaying()).toBe(true);
    expect(engineA.calls).toContain('play');
  });
});

describe('track-aware readiness (sets 37: deferred open)', () => {
  // Under a deferred open the shared decks may hold ANOTHER surface's
  // tracks (the conducting set's) in loadState 'ready' — the editor's
  // session pair is a target, not a fact. ready() must compare trackIds,
  // and play() must refuse foreign-ready decks.

  it('no targets set → legacy loadState-only readiness (standalone/tests)', () => {
    const { player } = makePlayer(() => true);
    expect(player.ready()).toBe(true); // FakeEngine: trackId 1, ready
  });

  it('targets matching the decks → ready', () => {
    const { player } = makePlayer(() => true);
    player.setTrack('A', { id: 1, durationSec: 120 });
    player.setTrack('B', { id: 1, durationSec: 120 });
    expect(player.ready()).toBe(true);
  });

  it('a foreign-ready deck is NOT ready, and play() is refused', () => {
    const { player, engineA } = makePlayer(() => true);
    player.setTrack('A', { id: 2, durationSec: 120 }); // deck holds track 1
    player.setTrack('B', { id: 1, durationSec: 120 });
    expect(player.ready()).toBe(false);
    player.play();
    expect(player.isPlaying()).toBe(false);
    expect(engineA.calls).toEqual([]);
  });

  it('clearing a target restores loadState-only readiness', () => {
    const { player } = makePlayer(() => true);
    player.setTrack('A', { id: 2, durationSec: 120 });
    player.setTrack('A', null);
    expect(player.ready()).toBe(true);
  });

  it('model durations fall back to track data while a deck holds a foreign track', () => {
    const { player } = makePlayer(() => true);
    const engineOnly = player.getMixDuration(); // both decks: 120s
    player.setTrack('A', { id: 1, durationSec: 500 }); // matches the deck → engine 120
    player.setTrack('B', { id: 2, durationSec: 500 }); // deck holds 1 → track data 500
    expect(player.getMixDuration()).toBeGreaterThan(engineOnly);
  });

  it('a matching target keeps the engine duration authoritative', () => {
    const { player } = makePlayer(() => true);
    const engineOnly = player.getMixDuration();
    player.setTrack('A', { id: 1, durationSec: 500 });
    player.setTrack('B', { id: 1, durationSec: 500 });
    expect(player.getMixDuration()).toBe(engineOnly);
  });
});

describe('seek taps (sets 37: transport gestures cancel a pending arm)', () => {
  it('every external seek notifies; play/pause do not; unsubscribe stops it', () => {
    const { player } = makePlayer(() => true);
    const taps: number[] = [];
    const unsub = player.subscribeSeek(() => taps.push(player.getMixTime()));
    player.seek(10);
    expect(taps).toEqual([10]);
    player.play();
    player.pause();
    expect(taps).toEqual([10]);
    unsub();
    player.seek(20);
    expect(taps).toEqual([10]);
  });
});
