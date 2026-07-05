/**
 * Follow mode model (follow-mode 01) — derivation face.
 *
 * Expected values are independent literals from OpenKey harmonic-mixing
 * theory (CONTEXT.md: Harmonically compatible) and the PRD's parameter
 * semantics, never recomputed through the code under test.
 */
import { describe, expect, it } from 'vitest';

import type { Tag, Track } from '../types';
import { DEFAULT_FOLLOW_PARAMS, deriveFollowQuery, unionIds } from './model';

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
