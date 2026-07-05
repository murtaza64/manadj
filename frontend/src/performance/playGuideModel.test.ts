/**
 * Play guide model (play-guides PRD) — pure, under vitest.
 *
 * Glossary: Play guide — a derived, view-only marker in the Performance
 * view, one per saved Transition from the playing Track to the paused
 * Track, marking the instant to press play on the paused Deck so the pair
 * rides that Transition's alignment.
 *
 * Expected values in these tests are independent literals worked out from
 * the Transition arithmetic by hand — never recomputed through the code
 * under test (same discipline as the follow-mode model tests).
 */
import { describe, expect, it } from 'vitest';
import { computePlayGuides, guideScreenFraction } from './playGuideModel';

/** Most tests exercise a single direction — grab its frame. */
function computeFrame(...args: Parameters<typeof computePlayGuides>) {
  const frames = computePlayGuides(...args);
  return frames.length > 0 ? frames[0] : null;
}
import type { GuideDeck } from './playGuideModel';
import type { PairStore } from '../editor/pairStore';
import type { Transition } from '../editor/mixModel';

/** A saved Transition with the shape knobs the guide math reads. */
function savedTransition(
  overrides: Partial<Transition> & { uuid?: string; name?: string; favorite?: boolean } = {}
) {
  const { uuid = 'u1', name = 'Transition 1', favorite, ...transition } = overrides;
  return {
    uuid,
    name,
    favorite,
    transition: {
      startSec: 64,
      durationSec: 32,
      bInSec: 16,
      tempoMatch: false,
      lanes: {},
      ...transition,
    },
  };
}

function pairStore(key: string, items: ReturnType<typeof savedTransition>[]): PairStore {
  return { [key]: { items, active: 0 } } as PairStore;
}

function deck(overrides: Partial<GuideDeck>): GuideDeck {
  return {
    trackId: null,
    playing: false,
    playhead: 0,
    bpm: null,
    pitchPercent: 0,
    ...overrides,
  };
}

describe('computePlayGuides — dynamic projection', () => {
  it('cueing the incoming Track at bInSec recovers the static alignment point', () => {
    // startSec=64, bInSec=16, no tempo match (r=1): B cued exactly at the
    // Transition's entry → press play when A reaches the window start, 64.
    const store = pairStore('1:2', [savedTransition()]);
    const frame = computeFrame(store, {
      A: deck({ trackId: 1, playing: true, playhead: 10 }),
      B: deck({ trackId: 2, playhead: 16 }),
    });
    expect(frame).not.toBeNull();
    expect(frame!.outgoing).toBe('A');
    expect(frame!.incoming).toBe('B');
    expect(frame!.guides).toHaveLength(1);
    expect(frame!.guides[0].aTime).toBe(64);
  });

  it('marker follows the paused playhead: cued 8s past the entry → press 8s later (r=1)', () => {
    // playheadB=24 is 8 B-seconds past bInSec=16; at 1:1 the coincidence
    // instant is 64+8 = 72 in A-track-time.
    const store = pairStore('1:2', [savedTransition()]);
    const frame = computeFrame(store, {
      A: deck({ trackId: 1, playing: true, playhead: 10 }),
      B: deck({ trackId: 2, playhead: 24 }),
    });
    expect(frame!.guides[0].aTime).toBe(72);
  });

  it('tempo match uses the SAVED ratio: 128→160 BPM means B rides at 0.8 B-sec per A-sec', () => {
    // r = bpmA/bpmB = 128/160 = 0.8. playheadB=24 is 8 B-seconds past the
    // entry → 8/0.8 = 10 A-seconds after the window start: 64+10 = 74.
    const store = pairStore('1:2', [savedTransition({ tempoMatch: true })]);
    const frame = computeFrame(store, {
      A: deck({ trackId: 1, playing: true, playhead: 10, bpm: 128 }),
      B: deck({ trackId: 2, playhead: 24, bpm: 160 }),
    });
    expect(frame!.guides[0].aTime).toBe(74);
  });

  it('actual pitch faders never move the marker', () => {
    const store = pairStore('1:2', [savedTransition({ tempoMatch: true })]);
    const frame = computeFrame(store, {
      A: deck({ trackId: 1, playing: true, playhead: 10, bpm: 128, pitchPercent: 4 }),
      B: deck({ trackId: 2, playhead: 24, bpm: 160, pitchPercent: -2 }),
    });
    expect(frame!.guides[0].aTime).toBe(74);
  });

  it('negative bInSec (silent lead gap) needs no special case: B cued at 0 → press 4s after window start', () => {
    // bInSec=−4: B's audio begins 4 mix-seconds into the window (r=1).
    const store = pairStore('1:2', [savedTransition({ bInSec: -4 })]);
    const frame = computeFrame(store, {
      A: deck({ trackId: 1, playing: true, playhead: 10 }),
      B: deck({ trackId: 2, playhead: 0 }),
    });
    expect(frame!.guides[0].aTime).toBe(68);
  });

  it('tempo match with an unknowable ratio (missing BPM) degrades to 1:1', () => {
    const store = pairStore('1:2', [savedTransition({ tempoMatch: true })]);
    const frame = computeFrame(store, {
      A: deck({ trackId: 1, playing: true, playhead: 10, bpm: 128 }),
      B: deck({ trackId: 2, playhead: 24, bpm: null }),
    });
    expect(frame!.guides[0].aTime).toBe(72);
  });
});

describe('computePlayGuides — Jump events', () => {
  it('projects on the pre-first-Jump trajectory only: jumps never move the marker', () => {
    // A jump at x=0.25 (mix 64+8=72, B-time 24) replays 15s back. A cued
    // position past the jump still projects on the straight initial ratio:
    // playheadB=40 → 64 + (40−16)/1 = 88, jump or no jump.
    const store = pairStore('1:2', [
      savedTransition({ jumps: [{ x: 0.25, deltaSec: -15 }] }),
    ]);
    const frame = computeFrame(store, {
      A: deck({ trackId: 1, playing: true, playhead: 10 }),
      B: deck({ trackId: 2, playhead: 40 }),
    });
    expect(frame!.guides[0].aTime).toBe(88);
  });
});

describe('computePlayGuides — missed markers', () => {
  it('a press moment behind the playing playhead is flagged missed, not dropped', () => {
    // Marker at 72 (as above), A already at 100.
    const store = pairStore('1:2', [savedTransition()]);
    const frame = computeFrame(store, {
      A: deck({ trackId: 1, playing: true, playhead: 100 }),
      B: deck({ trackId: 2, playhead: 24 }),
    });
    expect(frame!.guides).toHaveLength(1);
    expect(frame!.guides[0]).toMatchObject({ aTime: 72, missed: true });
  });

  it('an upcoming press moment is not missed', () => {
    const store = pairStore('1:2', [savedTransition()]);
    const frame = computeFrame(store, {
      A: deck({ trackId: 1, playing: true, playhead: 10 }),
      B: deck({ trackId: 2, playhead: 24 }),
    });
    expect(frame!.guides[0].missed).toBe(false);
  });
});

describe('computePlayGuides — multiplicity and direction', () => {
  it('every saved Transition of the pair yields a guide, in stored order, with name/favorite through', () => {
    const store = pairStore('1:2', [
      savedTransition({ uuid: 'u1', name: 'smooth blend' }),
      savedTransition({ uuid: 'u2', name: 'double drop', favorite: true, bInSec: 32 }),
    ]);
    const frame = computeFrame(store, {
      A: deck({ trackId: 1, playing: true, playhead: 10 }),
      B: deck({ trackId: 2, playhead: 32 }),
    });
    expect(frame!.guides.map((g) => [g.uuid, g.name, g.favorite])).toEqual([
      ['u1', 'smooth blend', false],
      ['u2', 'double drop', true],
    ]);
  });

  it('a Transition saved in the opposite direction produces nothing', () => {
    // Only 2→1 exists; 1 is playing — no guide.
    const store = pairStore('2:1', [savedTransition()]);
    const frame = computeFrame(store, {
      A: deck({ trackId: 1, playing: true, playhead: 10 }),
      B: deck({ trackId: 2, playhead: 16 }),
    });
    expect(frame).toBeNull();
  });

  it('swapping which Deck plays swaps the direction: outgoing follows playback', () => {
    const store = pairStore('2:1', [savedTransition()]);
    const frame = computeFrame(store, {
      A: deck({ trackId: 1, playhead: 16 }),
      B: deck({ trackId: 2, playing: true, playhead: 10 }),
    });
    expect(frame!.outgoing).toBe('B');
    expect(frame!.incoming).toBe('A');
    expect(frame!.guides[0].aTime).toBe(64);
  });

  it('doubles need no special case: same Track on both Decks with a self-Transition', () => {
    const store = pairStore('5:5', [savedTransition()]);
    const frame = computeFrame(store, {
      A: deck({ trackId: 5, playing: true, playhead: 10 }),
      B: deck({ trackId: 5, playhead: 16 }),
    });
    expect(frame!.guides[0].aTime).toBe(64);
  });
});

describe('computePlayGuides — pitch mismatch (surfaced, never corrected)', () => {
  it('tempo match with the fader still at 0 → warn with the required pitch', () => {
    // r = 126/120 = 1.05: B must run +5% for the alignment to hold.
    const store = pairStore('1:2', [savedTransition({ tempoMatch: true })]);
    const frame = computeFrame(store, {
      A: deck({ trackId: 1, playing: true, playhead: 10, bpm: 126 }),
      B: deck({ trackId: 2, playhead: 16, bpm: 120 }),
    });
    expect(frame!.guides[0].requiredPitchPercent).toBeCloseTo(5, 6);
  });

  it('fader already at the required pitch → no warning', () => {
    const store = pairStore('1:2', [savedTransition({ tempoMatch: true })]);
    const frame = computeFrame(store, {
      A: deck({ trackId: 1, playing: true, playhead: 10, bpm: 126 }),
      B: deck({ trackId: 2, playhead: 16, bpm: 120, pitchPercent: 5 }),
    });
    expect(frame!.guides[0].requiredPitchPercent).toBeNull();
  });

  it('the playing Deck\u2019s pitch factors into the requirement: rates compose', () => {
    // A rides at +2%: required B rate = 1.05 × 1.02 = 1.071 → +7.1%.
    const store = pairStore('1:2', [savedTransition({ tempoMatch: true })]);
    const frame = computeFrame(store, {
      A: deck({ trackId: 1, playing: true, playhead: 10, bpm: 126, pitchPercent: 2 }),
      B: deck({ trackId: 2, playhead: 16, bpm: 120 }),
    });
    expect(frame!.guides[0].requiredPitchPercent).toBeCloseTo(7.1, 6);
  });

  it('a 1:1 Transition still drifts when the faders differ → warn with the outgoing pitch', () => {
    const store = pairStore('1:2', [savedTransition()]);
    const frame = computeFrame(store, {
      A: deck({ trackId: 1, playing: true, playhead: 10, pitchPercent: 3 }),
      B: deck({ trackId: 2, playhead: 16 }),
    });
    expect(frame!.guides[0].requiredPitchPercent).toBeCloseTo(3, 6);
  });

  it('within tolerance → quiet (fader granularity is 0.1%)', () => {
    const store = pairStore('1:2', [savedTransition()]);
    const frame = computeFrame(store, {
      A: deck({ trackId: 1, playing: true, playhead: 10, pitchPercent: 0.1 }),
      B: deck({ trackId: 2, playhead: 16 }),
    });
    expect(frame!.guides[0].requiredPitchPercent).toBeNull();
  });

  it('unknowable ratio (missing BPM under tempo match) → no warning, not a false one', () => {
    const store = pairStore('1:2', [savedTransition({ tempoMatch: true })]);
    const frame = computeFrame(store, {
      A: deck({ trackId: 1, playing: true, playhead: 10, bpm: 126 }),
      B: deck({ trackId: 2, playhead: 16, bpm: null, pitchPercent: 4 }),
    });
    expect(frame!.guides[0].requiredPitchPercent).toBeNull();
  });
});

describe('guideScreenFraction — screen projection', () => {
  it('offsets from the fixed playhead marker by the track-time delta over the visible window', () => {
    // Marker pinned at 0.25 of the width; guide 30 track-seconds ahead in a
    // 60-second window → 0.25 + 30/60 = 0.75.
    expect(guideScreenFraction(130, 100, 60, 0.25)).toBe(0.75);
  });

  it('a missed guide projects behind the marker', () => {
    expect(guideScreenFraction(94, 100, 60, 0.25)).toBeCloseTo(0.15, 9);
  });
});

describe('computePlayGuides — appearance conditions', () => {
  const store = pairStore('1:2', [savedTransition()]);

  it('both Decks playing → nothing (nothing to press)', () => {
    const frame = computeFrame(store, {
      A: deck({ trackId: 1, playing: true, playhead: 10 }),
      B: deck({ trackId: 2, playing: true, playhead: 16 }),
    });
    expect(frame).toBeNull();
  });

  it('paused Deck empty → nothing', () => {
    const frame = computeFrame(store, {
      A: deck({ trackId: 1, playing: true, playhead: 10 }),
      B: deck({ trackId: null, playhead: 0 }),
    });
    expect(frame).toBeNull();
  });
});

describe('computePlayGuides — both Decks paused (prep state, issue 01)', () => {
  it('shows the saved direction, projected from the static playheads', () => {
    const store = pairStore('1:2', [savedTransition()]);
    const frames = computePlayGuides(store, {
      A: deck({ trackId: 1, playhead: 10 }),
      B: deck({ trackId: 2, playhead: 24 }),
    });
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ outgoing: 'A', incoming: 'B' });
    expect(frames[0].guides[0].aTime).toBe(72);
  });

  it('both directions at once when both are saved', () => {
    // A→B on A's timeline: 64 + (24−16) = 72.
    // B→A on B's timeline: 30 + (10−4) = 36.
    const store = {
      ...pairStore('1:2', [savedTransition({ uuid: 'ab' })]),
      ...pairStore('2:1', [savedTransition({ uuid: 'ba', startSec: 30, bInSec: 4 })]),
    };
    const frames = computePlayGuides(store, {
      A: deck({ trackId: 1, playhead: 10 }),
      B: deck({ trackId: 2, playhead: 24 }),
    });
    expect(frames.map((f) => [f.outgoing, f.incoming])).toEqual([
      ['A', 'B'],
      ['B', 'A'],
    ]);
    expect(frames[0].guides[0].aTime).toBe(72);
    expect(frames[1].guides[0].aTime).toBe(36);
  });

  it('starting a Deck prunes to the live direction', () => {
    const store = {
      ...pairStore('1:2', [savedTransition({ uuid: 'ab' })]),
      ...pairStore('2:1', [savedTransition({ uuid: 'ba', startSec: 30, bInSec: 4 })]),
    };
    const frames = computePlayGuides(store, {
      A: deck({ trackId: 1, playhead: 10 }),
      B: deck({ trackId: 2, playing: true, playhead: 24 }),
    });
    expect(frames.map((f) => [f.outgoing, f.incoming])).toEqual([['B', 'A']]);
  });

  it('missed works off the static outgoing playhead: re-cueing the outgoing Deck past the press moment flags it', () => {
    const store = pairStore('1:2', [savedTransition()]);
    const frames = computePlayGuides(store, {
      A: deck({ trackId: 1, playhead: 90 }),
      B: deck({ trackId: 2, playhead: 24 }),
    });
    expect(frames[0].guides[0]).toMatchObject({ aTime: 72, missed: true });
  });
});
