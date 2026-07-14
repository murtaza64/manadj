/**
 * Follow mode model (follow-mode 01) — the feature's single seam.
 *
 * Pure, framework-free. This file owns:
 *   - derivation: reference Track + Follow parameters → per-reference
 *     track-list query params (the heuristic Compatible tier);
 *   - union: per-reference result sets → one candidate id set
 *     (per-track OR of full conjunctions — never per-axis merging).
 *
 * Follow composes BESIDE the manual filters (it never writes FilterState):
 * visible = manual-filtered list ∩ union of candidate sets. The playback
 * state machine (spread/drop/sticky rules) is issue 02; ranking is 04.
 */
import type { Track } from '../types';
import { CHANNEL_IDS } from '../playback/mixer';
import type { ChannelId } from '../playback/mixer';

// ── State machine (follow-mode 02) ──────────────────────────────────────

/** Which Decks are being followed. */
export type FollowFlags = Readonly<Record<ChannelId, boolean>>;

/**
 * Inputs to the Follow state machine. Transport events carry the
 * POST-event deck-running map (`playing`) — the reducer never asks the
 * Decks anything.
 */
export type FollowEvent =
  | { type: 'toggle'; deck: ChannelId; loaded: boolean }
  | { type: 'play'; deck: ChannelId; playing: Record<ChannelId, boolean> }
  | { type: 'pause'; deck: ChannelId; playing: Record<ChannelId, boolean> };

/**
 * Follow rides playback (mirrors the transport-reducer pattern):
 *
 * - toggle: off always works; on requires a loaded Track. A manual enable
 *   is never blocked by playback state — the user's act wins; the rules
 *   re-assert on the next transport event.
 * - play: never self-enables (with Follow off everywhere, playback changes
 *   nothing). Otherwise the starting Deck begins following, and any
 *   following Deck that is not playing loses Follow — sticky expiry: a
 *   paused Deck may only follow while nothing plays.
 * - pause: the pausing Deck stops following unless it was the only Deck
 *   playing (the list survives mid-set silence).
 */
export function reduceFollow(flags: FollowFlags, event: FollowEvent): FollowFlags {
  switch (event.type) {
    case 'toggle': {
      if (flags[event.deck]) return { ...flags, [event.deck]: false };
      if (!event.loaded) return flags;
      return { ...flags, [event.deck]: true };
    }
    case 'play': {
      if (!CHANNEL_IDS.some((d) => flags[d])) return flags;
      const next: Record<ChannelId, boolean> = { ...flags, [event.deck]: true };
      for (const d of CHANNEL_IDS) {
        if (next[d] && !event.playing[d]) next[d] = false;
      }
      return next;
    }
    case 'pause': {
      if (!flags[event.deck]) return flags;
      const otherStillPlaying = CHANNEL_IDS.some((d) => d !== event.deck && event.playing[d]);
      return otherStillPlaying ? { ...flags, [event.deck]: false } : flags;
    }
  }
}

/**
 * The assistant button's Follow macro (midi-performance-ops 08): a pure
 * decision over the untouched per-Deck model — follow states + playing
 * states in, the decks to toggle out. The caller dispatches ordinary
 * `toggle` events, so the reducer's own rules (the loaded gate) still
 * apply: the macro is a shortcut, not a new model.
 *
 * - No Deck follows → enable Follow on all playing Decks; if nothing
 *   plays, on both Decks (legal: paused Decks may follow while nothing
 *   plays). The press satisfies "turning Follow on from nothing is the
 *   user's act".
 * - Any Deck follows → all Follow off, regardless of which deck had it or
 *   how it got there.
 *
 * Asymmetric on purpose: adding a second following Deck while one already
 * follows is a screen action, not the button's.
 */
export function followMacroToggles(
  flags: FollowFlags,
  playing: Record<ChannelId, boolean>
): readonly ChannelId[] {
  const following = CHANNEL_IDS.filter((d) => flags[d]);
  if (following.length > 0) return following; // toggle-off always works
  const playingDecks = CHANNEL_IDS.filter((d) => playing[d]);
  return playingDecks.length > 0 ? playingDecks : [...CHANNEL_IDS];
}

// ── Parameters ──────────────────────────────────────────────────────────

/**
 * The matching parameters (the Follow parameters modal edits these).
 * The gate is BPM-only (match-score PRD): the per-axis key/tag/energy
 * toggles retired with the gates they controlled — those signals inform
 * the Match score now, and per-signal score toggles can return later as
 * one-line weights if wanted.
 */
export interface FollowParams {
  bpm: boolean;
  bpmThresholdPercent: number;
  /** Narrow the candidates to the known tier only — Linked ∪ saved
   * Transition (glossary: Known; formerly "proven only"). Consumed by
   * candidateIdSet, not by the per-reference query derivation. */
  knownOnly: boolean;
}

/** Canonical defaults — the params store boots from these. */
export const DEFAULT_FOLLOW_PARAMS: FollowParams = {
  bpm: true,
  bpmThresholdPercent: 5,
  knownOnly: false,
};

// ── Derivation ──────────────────────────────────────────────────────────

/**
 * Query params for one reference Track — the shape the track-list API
 * accepts. Axes the parameters (or the Track's missing fields) exclude
 * derive to their neutral values.
 */
export interface FollowQuery {
  bpmCenter: number | null;
  bpmThresholdPercent: number | null;
}

/** Derive the heuristic-tier query for one reference Track. */
export function deriveFollowQuery(reference: Track, params: FollowParams): FollowQuery {
  // The gate is BPM-only (match-score PRD): key, tags, and energy stopped
  // filtering — they are Match-score signals now (matchScore.ts), so their
  // axes always derive neutral. The backend folds the BPM window
  // dyadically (center, ×2, ÷2); half/double-time candidates arrive and
  // score their proximity on the fold.
  const query: FollowQuery = {
    bpmCenter: null,
    bpmThresholdPercent: null,
  };

  if (params.bpm && reference.bpm) {
    query.bpmCenter = reference.bpm;
    query.bpmThresholdPercent = params.bpmThresholdPercent;
  }

  return query;
}

// ── Indicator summary (follow-mode 05) ──────────────────────────────────

/**
 * Compact "what is Follow deriving" text for one followed reference —
 * the FilterBar indicator's chip. Enabled axes only; axes the reference
 * has no data for are skipped (mirroring deriveFollowQuery); '—' when
 * nothing contributes.
 */
export function followSummary(reference: Track, params: FollowParams): string {
  // Mirrors deriveFollowQuery: the gate is BPM-only (match-score PRD), so
  // key/tags/energy no longer appear — they inform the score, not the cut.
  const parts: string[] = [];
  if (params.bpm && reference.bpm) {
    parts.push(`${Math.round(reference.bpm)}±${params.bpmThresholdPercent}%`);
  }
  if (params.knownOnly) {
    parts.push('◆🔗only');
  }
  return parts.length > 0 ? parts.join('·') : '—';
}

// ── Union (per-track OR) ────────────────────────────────────────────────

/**
 * The candidate id set across followed references: a Track is a candidate
 * if it appears in ANY reference's result set (full conjunction per
 * reference — chimeras that mix with neither Deck cannot arise).
 */
export function unionIds(resultSets: Track[][]): Set<number> {
  const ids = new Set<number>();
  for (const tracks of resultSets) {
    for (const t of tracks) ids.add(t.id);
  }
  return ids;
}

/**
 * The full candidate id set (follow-mode 03 / linked-pairs 04): both
 * evidence tiers. Heuristics propose (per-reference query results), the
 * known tier confirms — Tracks with a saved Transition from a followed
 * reference, and Linked Tracks, are always candidates, even when the
 * heuristic parameters would exclude them. `knownOnly` narrows to just
 * the known tier.
 */
/** The followed references: followed Decks that actually hold a Track,
 * in deck order. One home for the derivation the FilterBar (summary
 * chips, modal context) and the Library (queries, tiering) share.
 *
 * `fresh` is the ['track', id] cache lookup (ADR 0027 §7: identity in
 * context, facts in cache) — a reference's tempo/key/energy facts come
 * from the fresh row when one exists, so an edit (re-tempo 87→174)
 * re-centers the follow query without a re-Load. The loaded snapshot is
 * the fallback. */
export function followedReferences(
  flags: FollowFlags,
  loaded: Record<ChannelId, Track | null>,
  fresh?: (id: number) => Track | null | undefined
): Array<{ deck: ChannelId; reference: Track }> {
  return CHANNEL_IDS.flatMap((deck) => {
    const snapshot = loaded[deck];
    if (!flags[deck] || !snapshot) return [];
    return [{ deck, reference: fresh?.(snapshot.id) ?? snapshot }];
  });
}

/** Split a visible source list into followed Tracks (deduped in Deck/reference
 * order) and everything else. Follow uses the pinned rows as an actionable
 * `Following` section above the ranked candidates. */
export function partitionFollowedTracks(
  tracks: Track[],
  followedIds: readonly number[]
): { followed: Track[]; rest: Track[] } {
  const byId = new Map(tracks.map((track) => [track.id, track]));
  const seen = new Set<number>();
  const followed: Track[] = [];
  for (const id of followedIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const track = byId.get(id);
    if (track) followed.push(track);
  }
  return { followed, rest: tracks.filter((track) => !seen.has(track.id)) };
}

// ── Ranking (follow-mode 04) ────────────────────────────────────────────

/** A followed Deck's reference for tiering: its Track plus its known-tier
 * lookup — the candidate's Known strength (links/known.ts: favorited
 * Transition 0, Linked 1, unfavorited Transition 2; a pair takes its
 * best), or null when the candidate is not Known relative to it. */
export interface FollowReference {
  track: Track;
  knownStrength: (id: number) => number | null;
}

export function candidateIdSet(
  heuristicSets: Track[][],
  // Anything keyed by track id — a Set of ids or the transition index's
  // per-reference Map (trackId → PairInfo).
  knownSets: ReadonlyArray<{ keys(): IterableIterator<number> }>,
  knownOnly: boolean,
  // The followed references themselves: a Track is never its own
  // candidate (it self-matches at full score), and an already-loaded
  // Track isn't a suggestion either way.
  excludeIds: Iterable<number> = []
): Set<number> {
  const ids = knownOnly ? new Set<number>() : unionIds(heuristicSets);
  for (const known of knownSets) {
    for (const id of known.keys()) ids.add(id);
  }
  for (const id of excludeIds) ids.delete(id);
  return ids;
}
