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
  followSummary,
  followTier,
  orderByTier,
  reduceFollow,
  tierLabel,
  unionIds,
  type FollowEvent,
  type FollowFlags,
  type FollowReference,
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

describe('followedReferences — facts read through the track cache (ADR 0027 §7)', () => {
  // loadedTrack is a load-time snapshot (identity + display); tempo FACTS
  // come from the ['track', id] cache row when one exists. After a re-tempo
  // 87→174 the follow query must center on 174 without a re-Load.
  const flags: FollowFlags = { A: true, B: false };
  const stale = track({ id: 7, bpm: 87 });

  it('builds the reference from the fresh cache row when available', () => {
    const fresh = track({ id: 7, bpm: 174 });
    const refs = followedReferences(flags, { A: stale, B: null }, () => fresh);
    expect(refs).toEqual([{ deck: 'A', reference: fresh }]);
    const q = deriveFollowQuery(refs[0].reference, DEFAULT_FOLLOW_PARAMS);
    expect(q.bpmCenter).toBe(174);
  });

  it('falls back to the loaded snapshot when the cache has no row', () => {
    const refs = followedReferences(flags, { A: stale, B: null }, () => undefined);
    expect(refs).toEqual([{ deck: 'A', reference: stale }]);
  });

  it('keeps working without a lookup (identity-only callers)', () => {
    const refs = followedReferences(flags, { A: stale, B: null });
    expect(refs).toEqual([{ deck: 'A', reference: stale }]);
  });
});

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

  it('renders the enabled axes from the reference', () => {
    expect(
      followSummary(reference, {
        harmonicKeys: true,
        bpm: true,
        bpmThresholdPercent: 4,
        tags: true,
        energy: true,
        energyPreset: 'near',
        knownOnly: false,
      })
    ).toBe('10m·128±4%·E2–4·tags');
  });

  it('marks known-only and skips disabled axes', () => {
    expect(
      followSummary(reference, { ...DEFAULT_FOLLOW_PARAMS, harmonicKeys: false, bpm: false, knownOnly: true })
    ).toBe('◆🔗only');
  });

  it('skips axes the reference has no data for; nothing enabled renders a dash', () => {
    expect(followSummary(track({}), DEFAULT_FOLLOW_PARAMS)).toBe('—');
  });
});

describe('followTier / orderByTier — candidate strength (follow-mode 04 / linked-pairs 04)', () => {
  // Engine key ids (keyUtils): 19=10m(Cm) 18=10d(Eb) 21=11m(Gm) 17=9m(Fm)
  // 9=5m(C#m) 23=12m(Dm) 1=1m(Am).
  // Known strengths (links/known.ts): favorited=0, linked=1, saved=2.
  const ref = (
    key: number | undefined,
    known: Record<number, 0 | 1 | 2> = {}
  ): FollowReference => ({
    track: track({ id: 999, key }),
    knownStrength: (id) => known[id] ?? null,
  });

  it('tiers: known (by strength) < same Key < relative < one up < one down < rest', () => {
    const r = ref(19, { 50: 0, 51: 1, 52: 2 }); // 10m reference
    expect(followTier(track({ id: 50, key: 9 }), [r])).toBe(0); // favorited trumps key
    expect(followTier(track({ id: 51, key: 9 }), [r])).toBe(1); // linked
    expect(followTier(track({ id: 52, key: 9 }), [r])).toBe(2); // unfavorited saved
    expect(followTier(track({ id: 1, key: 19 }), [r])).toBe(3); // 10m same
    expect(followTier(track({ id: 2, key: 18 }), [r])).toBe(4); // 10d relative
    expect(followTier(track({ id: 3, key: 21 }), [r])).toBe(5); // 11m up
    expect(followTier(track({ id: 4, key: 17 }), [r])).toBe(6); // 9m down
    expect(followTier(track({ id: 5, key: 9 }), [r])).toBe(7); // 5m unrelated
    expect(followTier(track({ id: 6, key: undefined }), [r])).toBe(7); // keyless
  });

  it('any known strength outranks every Key tier', () => {
    const r = ref(19, { 52: 2 });
    // Weakest known (unfavorited saved) still beats same-Key.
    expect(followTier(track({ id: 52, key: 19 }), [r])).toBe(2);
  });

  it('wraps the wheel: 12m→1m is one up, 1m→12m is one down', () => {
    expect(followTier(track({ id: 1, key: 1 }), [ref(23)])).toBe(5); // 12m ref, 1m up
    expect(followTier(track({ id: 2, key: 23 }), [ref(1)])).toBe(6); // 1m ref, 12m down
  });

  it('a keyless reference contributes only its known tier', () => {
    const r = ref(undefined, { 7: 0 });
    expect(followTier(track({ id: 7, key: 19 }), [r])).toBe(0);
    expect(followTier(track({ id: 8, key: 19 }), [r])).toBe(7);
  });

  it('best tier wins across followed references (a pair takes its best)', () => {
    // Same key as ref B (tier 3) but merely one-up from ref A (tier 5).
    const refs = [ref(19), ref(21)];
    expect(followTier(track({ id: 1, key: 21 }), refs)).toBe(3);
    // Linked to A (1) but favorited from B (0): best wins.
    const known = [ref(19, { 9: 1 }), ref(21, { 9: 0 })];
    expect(followTier(track({ id: 9, key: 9 }), known)).toBe(0);
  });

  it('orderByTier groups by tier and keeps the incoming order within a tier', () => {
    const r = ref(19, { 40: 0, 41: 1 }); // 10m; 40 favorited, 41 linked
    const input = [
      track({ id: 10, key: 9 }), // rest
      track({ id: 11, key: 19 }), // same
      track({ id: 41, key: 9 }), // linked
      track({ id: 12, key: 19 }), // same (after 11 in input)
      track({ id: 40, key: 9 }), // favorited
      track({ id: 13, key: 18 }), // relative
    ];
    expect(orderByTier(input, [r]).map((t) => t.id)).toEqual([40, 41, 11, 12, 13, 10]);
    // Input untouched; no references = no reordering.
    expect(input.map((t) => t.id)).toEqual([10, 11, 41, 12, 40, 13]);
    expect(orderByTier(input, []).map((t) => t.id)).toEqual([10, 11, 41, 12, 40, 13]);
  });
});

describe('tierLabel — section headers (follow-mode 08)', () => {
  it('names all eight tiers', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(tierLabel)).toEqual([
      '★ Favorited transition',
      '🔗 Linked',
      '◆ Saved transition',
      'Same key',
      'Relative key',
      'Key up',
      'Key down',
      'Other matches',
    ]);
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

describe('followMacroToggles — the assistant button (midi-performance-ops 08)', () => {
  const OFF: FollowFlags = { A: false, B: false };

  describe('no Deck follows: enable on the playing Decks', () => {
    it('one playing Deck → toggle that Deck only', () => {
      expect(followMacroToggles(OFF, { A: true, B: false })).toEqual(['A']);
      expect(followMacroToggles(OFF, { A: false, B: true })).toEqual(['B']);
    });

    it('both playing → toggle both', () => {
      expect(followMacroToggles(OFF, { A: true, B: true })).toEqual(['A', 'B']);
    });

    it('nothing plays → toggle both Decks (paused Decks may follow while nothing plays)', () => {
      expect(followMacroToggles(OFF, { A: false, B: false })).toEqual(['A', 'B']);
    });
  });

  describe('any Deck follows: all Follow off', () => {
    it('one following Deck → toggle exactly that Deck off, whatever plays', () => {
      expect(followMacroToggles({ A: true, B: false }, { A: false, B: true })).toEqual(['A']);
      expect(followMacroToggles({ A: false, B: true }, { A: true, B: true })).toEqual(['B']);
    });

    it('both following → toggle both off', () => {
      expect(followMacroToggles({ A: true, B: true }, { A: true, B: true })).toEqual(['A', 'B']);
    });

    it('a paused following Deck is still turned off — never "add the other" (asymmetric on purpose)', () => {
      // B follows while paused (sole-playing sticky); A plays. The press
      // dismisses assistance, it does not spread it to A.
      expect(followMacroToggles({ A: false, B: true }, { A: true, B: false })).toEqual(['B']);
    });
  });

  it('composes with the reducer: enable-from-nothing then dismiss round-trips to OFF', () => {
    // Press 1 with A playing (both loaded): enable on A.
    let flags = OFF;
    for (const deck of followMacroToggles(flags, { A: true, B: false })) {
      flags = reduceFollow(flags, { type: 'toggle', deck, loaded: true });
    }
    expect(flags).toEqual({ A: true, B: false });
    // Press 2: any Deck follows → all off.
    for (const deck of followMacroToggles(flags, { A: true, B: false })) {
      flags = reduceFollow(flags, { type: 'toggle', deck, loaded: true });
    }
    expect(flags).toEqual(OFF);
  });

  it('the reducer\u2019s loaded gate still applies: an empty Deck\u2019s enable no-ops', () => {
    // Nothing plays, only A is loaded: the macro proposes both, the
    // reducer enables A only — the button is a shortcut, not a new model.
    let flags = OFF;
    const loaded = { A: true, B: false };
    for (const deck of followMacroToggles(flags, { A: false, B: false })) {
      flags = reduceFollow(flags, { type: 'toggle', deck, loaded: loaded[deck] });
    }
    expect(flags).toEqual({ A: true, B: false });
  });
});
