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

describe('default gate', () => {
  it('omitted audible = standalone player, always audible', () => {
    const { player, engineA } = makePlayer();
    player.play();
    expect(player.isPlaying()).toBe(true);
    expect(engineA.calls).toContain('play');
  });
});
