/**
 * The BPM control's commit seam, against a fake api (deck-controls issue
 * 02): serialization order, invalidation callback, 409 → conflict revert,
 * and the projection/step math (ADR 0016).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createBpmCommitter,
  dominantBpm,
  formatBpm,
  growShrinkBpm,
  isBpmConflict,
  projectBpm,
} from './bpmCommit';
import type { TempoChange } from '../../types';

const tc = (start: number, bpm: number): TempoChange => ({
  start_time: start,
  bpm,
  time_signature_num: 4,
  time_signature_den: 4,
  bar_position: 1,
});

const grid = (...changes: TempoChange[]) => ({
  tempo_changes: changes,
  beat_times: [],
  downbeat_times: [],
});

describe('projectBpm', () => {
  it('is none without a grid or a track BPM', () => {
    expect(projectBpm(null, null)).toEqual({ kind: 'none' });
    expect(projectBpm(null, 0)).toEqual({ kind: 'none' });
  });

  it('falls back to track.bpm without a grid (plain metadata)', () => {
    expect(projectBpm(null, 128)).toEqual({ kind: 'plain', bpm: 128 });
    expect(projectBpm(grid(), 128)).toEqual({ kind: 'plain', bpm: 128 });
  });

  it('projects a constant grid as its tempo, shadowing track.bpm', () => {
    expect(projectBpm(grid(tc(0, 174)), 128)).toEqual({ kind: 'grid', bpm: 174 });
  });

  it('marks variable grids and projects the dominant tempo', () => {
    // 10s of 100 BPM, then 90s of 140 BPM — 140 dominates.
    const p = projectBpm(grid(tc(0, 100), tc(10, 140)), 128, 100);
    expect(p).toEqual({ kind: 'variable', bpm: 140 });
  });
});

describe('dominantBpm', () => {
  it('weights segments by length', () => {
    expect(dominantBpm([tc(0, 100), tc(80, 140)], 100)).toBe(100);
    expect(dominantBpm([tc(0, 100), tc(10, 140)], 100)).toBe(140);
  });

  it('falls back to the first tempo change without a duration', () => {
    expect(dominantBpm([tc(0, 100), tc(10, 140)])).toBe(100);
    expect(dominantBpm([tc(0, 174)], null)).toBe(174);
  });
});

describe('growShrinkBpm', () => {
  it('shrink tightens spacing (+0.03), grow widens it (−0.03)', () => {
    expect(growShrinkBpm(128, 'shrink')).toBe(128.03);
    expect(growShrinkBpm(128.03, 'grow')).toBe(128);
  });

  it('snaps to the integer at x.99 / x.01', () => {
    expect(growShrinkBpm(127.98, 'shrink')).toBe(128); // 128.01 → snap
    expect(growShrinkBpm(128.02, 'grow')).toBe(128); // 127.99 → snap
  });
});

describe('formatBpm', () => {
  it('trims to at most 2 decimals', () => {
    expect(formatBpm(128)).toBe('128');
    expect(formatBpm(128.5)).toBe('128.5');
    expect(formatBpm(128.03)).toBe('128.03');
    expect(formatBpm(128.0000001)).toBe('128');
  });
});

describe('isBpmConflict', () => {
  it('recognizes the tracks PATCH 409 error shape', () => {
    expect(isBpmConflict(new Error('Failed to update track (409): variable grid'))).toBe(true);
    expect(isBpmConflict(new Error('Failed to update track (500): boom'))).toBe(false);
    expect(isBpmConflict('nope')).toBe(false);
  });
});

describe('createBpmCommitter', () => {
  it('serializes commits: a slow first PATCH finishes before the second starts', async () => {
    const events: string[] = [];
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => (releaseFirst = resolve));
    let call = 0;
    const committer = createBpmCommitter({
      save: async (bpm) => {
        call += 1;
        events.push(`start ${bpm}`);
        if (call === 1) await gate;
        events.push(`end ${bpm}`);
      },
    });

    const first = committer.commit(128.03);
    const second = committer.commit(128.06);
    await Promise.resolve(); // let the chain pick up the first commit
    expect(events).toEqual(['start 128.03']); // second is queued, not started
    releaseFirst();
    await first;
    await second;
    expect(events).toEqual(['start 128.03', 'end 128.03', 'start 128.06', 'end 128.06']);
  });

  it('calls onCommitted (invalidation seam) after each successful save', async () => {
    const committed: number[] = [];
    const committer = createBpmCommitter({
      save: async () => {},
      onCommitted: (bpm) => committed.push(bpm),
    });
    await committer.commit(120);
    await committer.commit(121);
    expect(committed).toEqual([120, 121]);
  });

  it('routes a 409 to onConflict (draft revert) and keeps the chain alive', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const conflicts: Error[] = [];
    const committed: number[] = [];
    let fail = true;
    const committer = createBpmCommitter({
      save: async () => {
        if (fail) throw new Error('Failed to update track (409): variable beatgrid');
      },
      onCommitted: (bpm) => committed.push(bpm),
      onConflict: (e) => conflicts.push(e),
    });
    await committer.commit(128);
    fail = false;
    await committer.commit(129);
    expect(conflicts).toHaveLength(1);
    expect(committed).toEqual([129]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('routes other failures to onError and keeps the chain alive', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const errors: unknown[] = [];
    const committed: number[] = [];
    let fail = true;
    const committer = createBpmCommitter({
      save: async () => {
        if (fail) throw new Error('Failed to update track (500): boom');
      },
      onCommitted: (bpm) => committed.push(bpm),
      onError: (e) => errors.push(e),
    });
    await committer.commit(128);
    fail = false;
    await committer.commit(129);
    expect(errors).toHaveLength(1);
    expect(committed).toEqual([129]);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
