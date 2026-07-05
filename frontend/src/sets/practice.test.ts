/**
 * Practice cue positioning (sets 13) — pure math for the rehearsal
 * affordance: where each deck parks when an adjacency is practiced.
 */
import { describe, expect, it } from 'vitest';
import { PRACTICE_RUNWAY_SEC, practiceCuePositions } from './practice';

describe('planned adjacency (pinned, windowed)', () => {
  const planned = {
    // Outgoing anchored at mix 0; window opens at track time 200.
    adjacency: { kind: 'transition' as const, mixStartSec: 200 },
    outgoingEntry: { mixOffsetSec: 0 },
    incomingEntry: { entrySec: 12.5 },
    outgoingDurationSec: 300,
    outgoingHotCueSecs: [50, 180], // ignored on the planned path
    incomingMainCueSec: 30, // ignored on the planned path
  };

  it('cues A a runway before the planned window start, B at its planned entry', () => {
    expect(practiceCuePositions(planned)).toEqual({
      outgoingSec: 200 - PRACTICE_RUNWAY_SEC,
      incomingSec: 12.5,
    });
  });

  it('subtracts the outgoing mix anchor (window start is mix-axis, cue is track time)', () => {
    const shifted = {
      ...planned,
      adjacency: { kind: 'take' as const, mixStartSec: 450 },
      outgoingEntry: { mixOffsetSec: 250 }, // track time 0 sits at mix 250
    };
    expect(practiceCuePositions(shifted).outgoingSec).toBe(450 - 250 - PRACTICE_RUNWAY_SEC);
  });

  it('clamps the runway at the track start', () => {
    const early = { ...planned, adjacency: { kind: 'transition' as const, mixStartSec: 10 } };
    expect(practiceCuePositions(early).outgoingSec).toBe(0);
  });

  it('accepts a custom runway', () => {
    expect(practiceCuePositions({ ...planned, runwaySec: 10 }).outgoingSec).toBe(190);
  });
});

describe('unresolved adjacency (hard cut / no plan)', () => {
  const base = {
    adjacency: { kind: 'hardcut' as const, mixStartSec: 300 },
    outgoingEntry: { mixOffsetSec: 0 },
    incomingEntry: { entrySec: 30 },
    outgoingDurationSec: 300,
    outgoingHotCueSecs: [50, 240, 180],
    incomingMainCueSec: 30,
  };

  it('cues A at its LAST hot cue (the mix-out convention), B at its Main cue', () => {
    expect(practiceCuePositions(base)).toEqual({ outgoingSec: 240, incomingSec: 30 });
  });

  it('falls back to a runway before the end when the outgoing has no hot cues', () => {
    expect(practiceCuePositions({ ...base, outgoingHotCueSecs: [] })).toEqual({
      outgoingSec: 300 - PRACTICE_RUNWAY_SEC,
      incomingSec: 30,
    });
  });

  it('clamps the end fallback at 0 for very short tracks', () => {
    expect(
      practiceCuePositions({ ...base, outgoingHotCueSecs: [], outgoingDurationSec: 20 })
        .outgoingSec
    ).toBe(0);
  });

  it('treats a missing plan slice the same as a hard cut', () => {
    expect(
      practiceCuePositions({
        ...base,
        adjacency: undefined,
        outgoingEntry: undefined,
        incomingEntry: undefined,
      })
    ).toEqual({ outgoingSec: 240, incomingSec: 30 });
  });
});
