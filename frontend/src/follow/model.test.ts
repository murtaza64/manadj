/**
 * Follow mode model (follow-mode 01) — derivation face.
 *
 * Expected values are independent literals from OpenKey harmonic-mixing
 * theory (CONTEXT.md: Harmonically compatible) and the PRD's parameter
 * semantics, never recomputed through the code under test.
 */
import { describe, expect, it } from 'vitest';

import type { Tag, Track } from '../types';
import {
  DEFAULT_FOLLOW_PARAMS,
  deriveFollowQuery,
  reduceFollow,
  unionIds,
  type FollowEvent,
  type FollowFlags,
} from './model';

/** Minimal Track for derivation: only key/bpm/energy/tags are read. */
function track(fields: Partial<Track> = {}): Track {
  return {
    id: 1,
    filename: '/t/1.mp3',
    tags: [],
    ...fields,
  } as unknown as Track;
}

describe('deriveFollowQuery — harmonic keys', () => {
  it('derives same key, adjacents (same mode), and relative for 10m (Cm)', () => {
    // Engine key id 19 = 10m (Cm). Wheel neighbours 9m/11m, relative 10d.
    const q = deriveFollowQuery(track({ key: 19 }), {
      ...DEFAULT_FOLLOW_PARAMS,
      harmonicKeys: true,
    });
    expect([...q.keyCamelotIds].sort()).toEqual(['10d', '10m', '11m', '9m']);
  });

  it('wraps the wheel at 12/1', () => {
    // Engine key id 0 = 1d (C): neighbours 12d and 2d, relative 1m.
    const q = deriveFollowQuery(track({ key: 0 }), {
      ...DEFAULT_FOLLOW_PARAMS,
      harmonicKeys: true,
    });
    expect([...q.keyCamelotIds].sort()).toEqual(['12d', '1d', '1m', '2d']);
  });

  it('derives no key filter when the axis is off or the Track has no Key', () => {
    expect(
      deriveFollowQuery(track({ key: 19 }), { ...DEFAULT_FOLLOW_PARAMS, harmonicKeys: false })
        .keyCamelotIds
    ).toEqual([]);
    expect(
      deriveFollowQuery(track({ key: undefined }), {
        ...DEFAULT_FOLLOW_PARAMS,
        harmonicKeys: true,
      }).keyCamelotIds
    ).toEqual([]);
  });
});

describe('deriveFollowQuery — BPM', () => {
  it('derives the reference BPM as center with the parameter threshold', () => {
    const q = deriveFollowQuery(track({ bpm: 128 }), {
      ...DEFAULT_FOLLOW_PARAMS,
      bpm: true,
      bpmThresholdPercent: 4,
    });
    expect(q.bpmCenter).toBe(128);
    expect(q.bpmThresholdPercent).toBe(4);
  });

  it('derives no BPM window when the axis is off or the Track has no BPM', () => {
    expect(
      deriveFollowQuery(track({ bpm: 128 }), { ...DEFAULT_FOLLOW_PARAMS, bpm: false }).bpmCenter
    ).toBeNull();
    expect(
      deriveFollowQuery(track({}), { ...DEFAULT_FOLLOW_PARAMS, bpm: true }).bpmCenter
    ).toBeNull();
  });
});

describe('deriveFollowQuery — energy presets', () => {
  const at3 = (preset: 'up' | 'down' | 'near' | 'equal') =>
    deriveFollowQuery(track({ energy: 3 }), {
      ...DEFAULT_FOLLOW_PARAMS,
      energy: true,
      energyPreset: preset,
    });

  it('equal / near / up / down around energy 3', () => {
    expect(at3('equal')).toMatchObject({ energyMin: 3, energyMax: 3 });
    expect(at3('near')).toMatchObject({ energyMin: 2, energyMax: 4 });
    expect(at3('up')).toMatchObject({ energyMin: 3, energyMax: 5 });
    expect(at3('down')).toMatchObject({ energyMin: 1, energyMax: 3 });
  });

  it('near clamps to the 1–5 scale at the edges', () => {
    const q = deriveFollowQuery(track({ energy: 5 }), {
      ...DEFAULT_FOLLOW_PARAMS,
      energy: true,
      energyPreset: 'near',
    });
    expect(q).toMatchObject({ energyMin: 4, energyMax: 5 });
  });

  it('axis off leaves the full range', () => {
    expect(deriveFollowQuery(track({ energy: 3 }), DEFAULT_FOLLOW_PARAMS)).toMatchObject({
      energyMin: 1,
      energyMax: 5,
    });
  });
});

describe('deriveFollowQuery — tags (any-shared)', () => {
  const tag = (id: number): Tag => ({ id, name: `t${id}` }) as unknown as Tag;

  it("derives the reference's tag ids with ANY semantics", () => {
    const q = deriveFollowQuery(track({ tags: [tag(4), tag(9)] }), {
      ...DEFAULT_FOLLOW_PARAMS,
      tags: true,
    });
    expect(q.tagIds).toEqual([4, 9]);
    expect(q.tagMatchMode).toBe('ANY');
  });

  it('derives no tag filter when the axis is off or the reference is untagged', () => {
    expect(
      deriveFollowQuery(track({ tags: [tag(4)] }), { ...DEFAULT_FOLLOW_PARAMS, tags: false })
        .tagIds
    ).toEqual([]);
    expect(deriveFollowQuery(track({}), { ...DEFAULT_FOLLOW_PARAMS, tags: true }).tagIds).toEqual(
      []
    );
  });
});

describe('unionIds — per-track OR of candidate sets', () => {
  const t = (id: number) => track({ id });

  it('unions and dedupes across per-reference result sets', () => {
    const ids = unionIds([
      [t(1), t(2), t(3)],
      [t(2), t(4)],
    ]);
    expect([...ids].sort()).toEqual([1, 2, 3, 4]);
  });

  it('a single reference passes through; no references yields an empty set', () => {
    expect([...unionIds([[t(7)]])]).toEqual([7]);
    expect(unionIds([]).size).toBe(0);
  });
});

describe('reduceFollow — the Follow state machine', () => {
  // Event `playing` maps are POST-event deck-running state.
  const OFF: FollowFlags = { A: false, B: false };
  const play = (deck: 'A' | 'B', playing: Record<'A' | 'B', boolean>): FollowEvent => ({
    type: 'play',
    deck,
    playing,
  });
  const pause = (deck: 'A' | 'B', playing: Record<'A' | 'B', boolean>): FollowEvent => ({
    type: 'pause',
    deck,
    playing,
  });

  describe('manual toggle', () => {
    it('enables a Deck with a loaded Track', () => {
      expect(reduceFollow(OFF, { type: 'toggle', deck: 'A', loaded: true })).toEqual({
        A: true,
        B: false,
      });
    });

    it('rejects enabling an empty Deck', () => {
      expect(reduceFollow(OFF, { type: 'toggle', deck: 'A', loaded: false })).toEqual(OFF);
    });

    it('disables regardless of loaded state', () => {
      expect(
        reduceFollow({ A: true, B: false }, { type: 'toggle', deck: 'A', loaded: false })
      ).toEqual(OFF);
    });

    it("is never blocked by playback state — the user's act wins", () => {
      // Enabling a paused Deck while the other plays is allowed (toggle
      // events carry no playing context at all); the spread/expiry rules
      // re-assert on the next transport event.
      expect(
        reduceFollow({ A: false, B: true }, { type: 'toggle', deck: 'A', loaded: true })
      ).toEqual({ A: true, B: true });
    });
  });

  describe('spread on play', () => {
    it('a Deck starting while any Deck follows begins following', () => {
      expect(reduceFollow({ A: true, B: false }, play('B', { A: true, B: true }))).toEqual({
        A: true,
        B: true,
      });
    });

    it('never self-enables: with Follow off everywhere, play changes nothing', () => {
      expect(reduceFollow(OFF, play('A', { A: true, B: false }))).toEqual(OFF);
    });
  });

  describe('drop on pause', () => {
    it('a pausing Deck stops following when another Deck still plays', () => {
      expect(reduceFollow({ A: true, B: true }, pause('A', { A: false, B: true }))).toEqual({
        A: false,
        B: true,
      });
    });

    it('the sole playing Deck keeps following through mid-set silence', () => {
      expect(reduceFollow({ A: true, B: false }, pause('A', { A: false, B: false }))).toEqual({
        A: true,
        B: false,
      });
    });

    it('pausing a non-following Deck changes nothing', () => {
      expect(reduceFollow({ A: true, B: false }, pause('B', { A: true, B: false }))).toEqual({
        A: true,
        B: false,
      });
    });
  });

  describe('sticky expiry', () => {
    it('any Deck starting revokes Follow from a paused following Deck', () => {
      // A follows from the sole-playing exception (paused); starting B
      // spreads to B and expires A's stickiness.
      expect(reduceFollow({ A: true, B: false }, play('B', { A: false, B: true }))).toEqual({
        A: false,
        B: true,
      });
    });
  });

  it('rides a whole transition: enable → spread → fade out → hand over', () => {
    // Enable Follow on A (loaded, playing), start B, then pause A.
    let flags = reduceFollow(OFF, { type: 'toggle', deck: 'A', loaded: true });
    flags = reduceFollow(flags, play('A', { A: true, B: false }));
    flags = reduceFollow(flags, play('B', { A: true, B: true }));
    expect(flags).toEqual({ A: true, B: true });
    flags = reduceFollow(flags, pause('A', { A: false, B: true }));
    expect(flags).toEqual({ A: false, B: true });
  });
});
