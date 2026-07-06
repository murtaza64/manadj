/** Set-row column grid (sets 31): geometry invariants + the pure BPM
 * delta and time-column rules. */
import { describe, expect, it } from 'vitest';
import { DECK_COLORS } from '../theme/deckColors';
import type { PlannedEntry } from './planner';
import {
  ADJ_GUTTER_W,
  ADJ_PAD_LEFT,
  ADJ_ROW_GAP,
  bpmDeltaColor,
  bpmDeltaPercent,
  bpmDeltaTitle,
  fmtInTime,
  fmtPlayTime,
  TITLE_X,
} from './rowColumns';

const entry = (over: Partial<PlannedEntry> = {}): PlannedEntry => ({
  trackId: 1,
  deck: 'A',
  mixOffsetSec: 0,
  rate: 1,
  entrySec: 0,
  exitSec: 180,
  entryMixSec: 0,
  exitMixSec: 180,
  ...over,
});

describe('column geometry', () => {
  it('adjacency gutter puts the first chip exactly at the title x', () => {
    expect(ADJ_PAD_LEFT + ADJ_GUTTER_W + ADJ_ROW_GAP).toBe(TITLE_X);
  });

  it('locks the grid against accidental constant edits (sets-20 contract successor)', () => {
    // ▶ 18 + # 24 + in 40 + key 24 + BPM 40 + energy 22, with 8px gaps
    // behind a 3px accent and 12px padding. Recompute deliberately if a
    // column moves.
    expect(TITLE_X).toBe(231);
    expect(ADJ_GUTTER_W).toBe(208);
  });
});

describe('bpmDeltaPercent', () => {
  it('is the signed percent against the reference', () => {
    expect(bpmDeltaPercent(130, { kind: 'set-tempo', bpm: 125 })).toBeCloseTo(4.0);
    expect(bpmDeltaPercent(120, { kind: 'predecessor', bpm: 125 })).toBeCloseTo(-4.0);
    expect(bpmDeltaPercent(125, { kind: 'set-tempo', bpm: 125 })).toBe(0);
  });

  it('is null when either side is missing (neutral render)', () => {
    expect(bpmDeltaPercent(null, { kind: 'set-tempo', bpm: 125 })).toBeNull();
    expect(bpmDeltaPercent(undefined, { kind: 'set-tempo', bpm: 125 })).toBeNull();
    expect(bpmDeltaPercent(128, null)).toBeNull();
    expect(bpmDeltaPercent(128, { kind: 'predecessor', bpm: 0 })).toBeNull();
    expect(bpmDeltaPercent(0, { kind: 'predecessor', bpm: 125 })).toBeNull();
  });
});

describe('bpmDeltaColor', () => {
  it('bands by delta magnitude, sign-agnostic', () => {
    expect(bpmDeltaColor(0)).toBe('var(--green)');
    expect(bpmDeltaColor(2)).toBe('var(--green)');
    expect(bpmDeltaColor(-2)).toBe('var(--green)');
    expect(bpmDeltaColor(2.1)).toBe('var(--yellow)');
    expect(bpmDeltaColor(-4)).toBe('var(--yellow)');
    expect(bpmDeltaColor(4.1)).toBe('#ff9500');
    expect(bpmDeltaColor(-8)).toBe('#ff9500');
    expect(bpmDeltaColor(8.1)).toBe('var(--red)');
    expect(bpmDeltaColor(-25)).toBe('var(--red)');
  });

  it('never uses the deck identity colors (glossary: identity ≠ state)', () => {
    for (const d of [0, 3, 6, 50]) {
      const c = bpmDeltaColor(d)!.toLowerCase();
      expect(c).not.toContain(DECK_COLORS.A.toLowerCase());
      expect(c).not.toContain(DECK_COLORS.B.toLowerCase());
    }
  });

  it('is null (neutral) for a null delta', () => {
    expect(bpmDeltaColor(null)).toBeNull();
  });
});

describe('bpmDeltaTitle', () => {
  it('carries the signed delta and the reference kind', () => {
    expect(bpmDeltaTitle(130, { kind: 'set-tempo', bpm: 125 })).toBe(
      '130.0 BPM — +4.0% vs the Set tempo 125.0'
    );
    expect(bpmDeltaTitle(120, { kind: 'predecessor', bpm: 125 })).toBe(
      "120.0 BPM — -4.0% vs the previous track's 125.0"
    );
  });

  it('degrades to the absolute value without a reference, and names the gap', () => {
    expect(bpmDeltaTitle(128, null)).toBe('128.0 BPM');
    expect(bpmDeltaTitle(null, { kind: 'set-tempo', bpm: 125 })).toBe('no BPM');
  });
});

describe('time columns', () => {
  it('in = the plan entry mix time; play = audible span over total', () => {
    const e = entry({ entrySec: 30, exitSec: 210, entryMixSec: 754 });
    expect(fmtInTime(e)).toBe('12:34');
    expect(fmtPlayTime(e, 310)).toBe('3:00/5:10');
  });

  it('blank without a plan (or track duration)', () => {
    expect(fmtInTime(undefined)).toBe('');
    expect(fmtPlayTime(undefined, 310)).toBe('');
    expect(fmtPlayTime(entry(), null)).toBe('');
  });

  it('NEVER AUDIBLE keeps its badge behavior: both time cells blank', () => {
    // entrySec > 0 with exitSec ≤ entrySec = the never-audible condition.
    const dead = entry({ entrySec: 200, exitSec: 180, entryMixSec: 400 });
    expect(fmtInTime(dead)).toBe('');
    expect(fmtPlayTime(dead, 310)).toBe('');
  });
});
