/**
 * Follow mode model (follow-mode 01) — derivation face.
 *
 * Expected values are independent literals from OpenKey harmonic-mixing
 * theory (CONTEXT.md: Harmonically compatible) and the PRD's parameter
 * semantics, never recomputed through the code under test.
 */
import { describe, expect, it } from 'vitest';

import { buildTransitionIndex, transitionsFrom } from '../editor/transitionIndex';
import type { PairStore } from '../editor/pairStore';
import type { Tag, Track } from '../types';
import {
  candidateIdSet,
  DEFAULT_FOLLOW_PARAMS,
  deriveFollowQuery,
  followedReferences,
  followMacroToggles,
  partitionFollowedTracks,
  followSummary,
  reduceFollow,
  unionIds,
  type FollowEvent,
  type FollowFlags,
} from './model';

const followFlags = (A = false, B = false, C = false, D = false): FollowFlags => ({ A, B, C, D });
const loaded = (A: Track | null, B: Track | null = null) => ({ A, B, C: null, D: null });

/** Minimal Track for derivation: only key/bpm/energy/tags are read. */
function track(fields: Partial<Track> = {}): Track {
  return {
    id: 1,
    filename: '/t/1.mp3',
    tags: [],
    ...fields,
  } as unknown as Track;
}

describe('followedReferences — facts read through the track cache (ADR 0027 §7)', () => {
  // loadedTrack is a load-time snapshot (identity + display); tempo FACTS
  // come from the ['track', id] cache row when one exists. After a re-tempo
  // 87→174 the follow query must center on 174 without a re-Load.
  const followed = followFlags(true);
  const stale = track({ id: 7, bpm: 87 });

  it('builds the reference from the fresh cache row when available', () => {
    const fresh = track({ id: 7, bpm: 174 });
    const refs = followedReferences(followed, loaded(stale), () => fresh);
    expect(refs).toEqual([{ deck: 'A', reference: fresh }]);
    const q = deriveFollowQuery(refs[0].reference, DEFAULT_FOLLOW_PARAMS);
    expect(q.bpmCenter).toBe(174);
  });

  it('falls back to the loaded snapshot when the cache has no row', () => {
    const refs = followedReferences(followed, loaded(stale), () => undefined);
    expect(refs).toEqual([{ deck: 'A', reference: stale }]);
  });

  it('keeps working without a lookup (identity-only callers)', () => {
    const refs = followedReferences(followed, loaded(stale));
    expect(refs).toEqual([{ deck: 'A', reference: stale }]);
  });
});

describe('partitionFollowedTracks', () => {
  it('pins followed Tracks in reference order and dedupes doubles', () => {
    const tracks = [track({ id: 1 }), track({ id: 2 }), track({ id: 3 }), track({ id: 4 })];
    const result = partitionFollowedTracks(tracks, [3, 1, 3]);
    expect(result.followed.map((item) => item.id)).toEqual([3, 1]);
    expect(result.rest.map((item) => item.id)).toEqual([2, 4]);
  });

  it('does not inject a followed Track outside the visible source list', () => {
    const result = partitionFollowedTracks([track({ id: 2 })], [9, 2]);
    expect(result.followed.map((item) => item.id)).toEqual([2]);
    expect(result.rest).toEqual([]);
  });
});

describe('deriveFollowQuery — the gate is BPM-only (match-score PRD)', () => {
  const tag = (id: number): Tag => ({ id, name: `t${id}` }) as unknown as Tag;

  it('the query carries the BPM window and nothing else — key/tags/energy score, never filter', () => {
    const reference = track({ key: 19, energy: 3, bpm: 174, tags: [tag(4), tag(9)] });
    const q = deriveFollowQuery(reference, DEFAULT_FOLLOW_PARAMS);
    expect(q).toEqual({
      bpmCenter: 174,
      bpmThresholdPercent: DEFAULT_FOLLOW_PARAMS.bpmThresholdPercent,
    });
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

describe('candidateIdSet — known tier folded in (follow-mode 03 / linked-pairs 04)', () => {
  const t = (id: number) => track({ id });

  it('known candidates OR in beyond the heuristic sets', () => {
    // Track 30 is Known from a followed reference (saved Transition or
    // Link) but fails the heuristics (e.g. a tempo-jump outside the BPM
    // window).
    const ids = candidateIdSet([[t(1), t(2)]], [new Set([2, 30])], false);
    expect([...ids].sort()).toEqual([1, 2, 30]);
  });

  it('known only narrows to just the known tier', () => {
    const ids = candidateIdSet([[t(1), t(2)]], [new Set([2, 30])], true);
    expect([...ids].sort()).toEqual([2, 30]);
  });

  it('dual follow unions the known tiers of both references', () => {
    const ids = candidateIdSet([], [new Set([5]), new Set([6, 5])], true);
    expect([...ids].sort()).toEqual([5, 6]);
  });

  it('nothing known leaves the heuristic union untouched', () => {
    expect([...candidateIdSet([[t(1)]], [new Set()], false)]).toEqual([1]);
  });

  it('a followed reference is never its own candidate (self-match, loaded)', () => {
    // Reference 100 self-matches into its heuristic set; a dual-follow
    // partner may even hold it in a known set. Both excluded.
    const ids = candidateIdSet([[t(100), t(1)]], [new Set([100, 2])], false, [100]);
    expect([...ids].sort()).toEqual([1, 2]);
    expect([...candidateIdSet([], [new Set([100])], true, [100])]).toEqual([]);
  });

  it("accepts the transition index's from-direction map (constructed index)", () => {
    // The production shape: a real index built from a pair store. Track 7
    // has a saved Transition into 30; the 7:31 pair is empty (pristine
    // pairs never persist as items) and must not produce a candidate.
    const index = buildTransitionIndex({
      '7:30': { items: [{ favorite: false }], active: null },
      '7:31': { items: [], active: null },
    } as unknown as PairStore);
    const ids = candidateIdSet([[t(1)]], [transitionsFrom(index, 7)], false);
    expect([...ids].sort()).toEqual([1, 30]);
    expect([...candidateIdSet([[t(1)]], [transitionsFrom(index, 7)], true)]).toEqual([30]);
  });
});

describe('followSummary — the FilterBar indicator text (follow-mode 05)', () => {
  const tag = (id: number): Tag => ({ id, name: `t${id}` }) as unknown as Tag;
  const reference = track({ key: 19, bpm: 128, energy: 3, tags: [tag(1), tag(2)] });

  it('renders the BPM gate only — retired axes never appear (match-score PRD)', () => {
    expect(
      followSummary(reference, { bpm: true, bpmThresholdPercent: 4, knownOnly: false })
    ).toBe('128±4%');
  });

  it('marks known-only and skips disabled axes', () => {
    expect(
      followSummary(reference, { ...DEFAULT_FOLLOW_PARAMS, bpm: false, knownOnly: true })
    ).toBe('◆🔗only');
  });

  it('skips axes the reference has no data for; nothing enabled renders a dash', () => {
    expect(followSummary(track({}), DEFAULT_FOLLOW_PARAMS)).toBe('—');
  });
});

describe('reduceFollow — the Follow state machine', () => {
  // Event `playing` maps are POST-event deck-running state.
  const OFF = followFlags();
  const play = (deck: 'A' | 'B' | 'C' | 'D', playing: FollowFlags): FollowEvent => ({
    type: 'play',
    deck,
    playing,
  });
  const pause = (deck: 'A' | 'B' | 'C' | 'D', playing: FollowFlags): FollowEvent => ({
    type: 'pause',
    deck,
    playing,
  });

  describe('manual toggle', () => {
    it('enables a Deck with a loaded Track', () => {
      expect(reduceFollow(OFF, { type: 'toggle', deck: 'A', loaded: true })).toEqual(followFlags(true));
    });

    it('rejects enabling an empty Deck', () => {
      expect(reduceFollow(OFF, { type: 'toggle', deck: 'A', loaded: false })).toEqual(OFF);
    });

    it('disables regardless of loaded state', () => {
      expect(
        reduceFollow(followFlags(true), { type: 'toggle', deck: 'A', loaded: false })
      ).toEqual(OFF);
    });

    it("is never blocked by playback state — the user's act wins", () => {
      // Enabling a paused Deck while the other plays is allowed (toggle
      // events carry no playing context at all); the spread/expiry rules
      // re-assert on the next transport event.
      expect(
        reduceFollow(followFlags(false, true), { type: 'toggle', deck: 'A', loaded: true })
      ).toEqual(followFlags(true, true));
    });
  });

  describe('spread on play', () => {
    it('a Deck starting while any Deck follows begins following', () => {
      expect(reduceFollow(followFlags(true), play('B', followFlags(true, true)))).toEqual(followFlags(true, true));
    });

    it('never self-enables: with Follow off everywhere, play changes nothing', () => {
      expect(reduceFollow(OFF, play('A', followFlags(true)))).toEqual(OFF);
    });
  });

  describe('drop on pause', () => {
    it('a pausing Deck stops following when another Deck still plays', () => {
      expect(reduceFollow(followFlags(true, true), pause('A', followFlags(false, true)))).toEqual(followFlags(false, true));
    });

    it('the sole playing Deck keeps following through mid-set silence', () => {
      expect(reduceFollow(followFlags(true), pause('A', followFlags()))).toEqual(followFlags(true));
    });

    it('pausing a non-following Deck changes nothing', () => {
      expect(reduceFollow(followFlags(true), pause('B', followFlags(true)))).toEqual(followFlags(true));
    });
  });

  describe('sticky expiry', () => {
    it('any Deck starting revokes Follow from a paused following Deck', () => {
      // A follows from the sole-playing exception (paused); starting B
      // spreads to B and expires A's stickiness.
      expect(reduceFollow(followFlags(true), play('B', followFlags(false, true)))).toEqual(followFlags(false, true));
    });
  });

  it('rides a whole transition: enable → spread → fade out → hand over', () => {
    // Enable Follow on A (loaded, playing), start B, then pause A.
    let flags = reduceFollow(OFF, { type: 'toggle', deck: 'A', loaded: true });
    flags = reduceFollow(flags, play('A', followFlags(true)));
    flags = reduceFollow(flags, play('B', followFlags(true, true)));
    expect(flags).toEqual(followFlags(true, true));
    flags = reduceFollow(flags, pause('A', followFlags(false, true)));
    expect(flags).toEqual(followFlags(false, true));
  });

  it('rides a three-Deck blend and retains every playing reference', () => {
    let flags = reduceFollow(OFF, { type: 'toggle', deck: 'A', loaded: true });
    flags = reduceFollow(flags, play('A', followFlags(true)));
    flags = reduceFollow(flags, play('B', followFlags(true, true)));
    flags = reduceFollow(flags, play('C', followFlags(true, true, true)));
    expect(flags).toEqual(followFlags(true, true, true));
    flags = reduceFollow(flags, pause('B', followFlags(true, false, true)));
    expect(flags).toEqual(followFlags(true, false, true));
  });
});

describe('followMacroToggles — the assistant button (midi-performance-ops 08)', () => {
  const OFF = followFlags();

  describe('no Deck follows: enable on the playing Decks', () => {
    it('one playing Deck → toggle that Deck only', () => {
      expect(followMacroToggles(OFF, followFlags(true))).toEqual(['A']);
      expect(followMacroToggles(OFF, followFlags(false, true))).toEqual(['B']);
    });

    it('both playing → toggle both', () => {
      expect(followMacroToggles(OFF, followFlags(true, true))).toEqual(['A', 'B']);
    });

    it('nothing plays → toggle both Decks (paused Decks may follow while nothing plays)', () => {
      expect(followMacroToggles(OFF, followFlags())).toEqual(['A', 'B', 'C', 'D']);
    });
  });

  describe('any Deck follows: all Follow off', () => {
    it('one following Deck → toggle exactly that Deck off, whatever plays', () => {
      expect(followMacroToggles(followFlags(true), followFlags(false, true))).toEqual(['A']);
      expect(followMacroToggles(followFlags(false, true), followFlags(true, true))).toEqual(['B']);
    });

    it('both following → toggle both off', () => {
      expect(followMacroToggles(followFlags(true, true), followFlags(true, true))).toEqual(['A', 'B']);
    });

    it('a paused following Deck is still turned off — never "add the other" (asymmetric on purpose)', () => {
      // B follows while paused (sole-playing sticky); A plays. The press
      // dismisses assistance, it does not spread it to A.
      expect(followMacroToggles(followFlags(false, true), followFlags(true))).toEqual(['B']);
    });
  });

  it('composes with the reducer: enable-from-nothing then dismiss round-trips to OFF', () => {
    // Press 1 with A playing (both loaded): enable on A.
    let flags = OFF;
    for (const deck of followMacroToggles(flags, followFlags(true))) {
      flags = reduceFollow(flags, { type: 'toggle', deck, loaded: true });
    }
    expect(flags).toEqual(followFlags(true));
    // Press 2: any Deck follows → all off.
    for (const deck of followMacroToggles(flags, followFlags(true))) {
      flags = reduceFollow(flags, { type: 'toggle', deck, loaded: true });
    }
    expect(flags).toEqual(OFF);
  });

  it('the reducer\u2019s loaded gate still applies: an empty Deck\u2019s enable no-ops', () => {
    // Nothing plays, only A is loaded: the macro proposes both, the
    // reducer enables A only — the button is a shortcut, not a new model.
    let flags = OFF;
    const loadedDecks = followFlags(true);
    for (const deck of followMacroToggles(flags, followFlags())) {
      flags = reduceFollow(flags, { type: 'toggle', deck, loaded: loadedDecks[deck] });
    }
    expect(flags).toEqual(followFlags(true));
  });
});
