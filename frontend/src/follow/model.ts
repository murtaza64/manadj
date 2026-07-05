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
import type { ChannelId } from '../playback/mixer';
import { KNOWN_FAVORITED, KNOWN_SAVED } from '../links/known';
import { engineIdToOpenKey, formatKeyDisplay } from '../utils/keyUtils';

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

const DECKS: readonly ChannelId[] = ['A', 'B'];

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
      if (!DECKS.some((d) => flags[d])) return flags;
      const next: Record<ChannelId, boolean> = { ...flags, [event.deck]: true };
      for (const d of DECKS) {
        if (next[d] && !event.playing[d]) next[d] = false;
      }
      return next;
    }
    case 'pause': {
      if (!flags[event.deck]) return flags;
      const otherStillPlaying = DECKS.some((d) => d !== event.deck && event.playing[d]);
      return otherStillPlaying ? { ...flags, [event.deck]: false } : flags;
    }
  }
}

// ── Parameters ──────────────────────────────────────────────────────────

/** Energy relation of candidates to the reference. */
export type EnergyPreset = 'up' | 'down' | 'near' | 'equal';

/**
 * The matching parameters (the Follow parameters modal edits these).
 * Tag agreement is any-shared by definition (CONTEXT.md: Compatible) —
 * there is no ALL mode and no reference-deck choice (per-Deck toggles).
 */
export interface FollowParams {
  harmonicKeys: boolean;
  bpm: boolean;
  bpmThresholdPercent: number;
  tags: boolean;
  energy: boolean;
  energyPreset: EnergyPreset;
  /** Narrow the candidates to the known tier only — Linked ∪ saved
   * Transition (glossary: Known; formerly "proven only"). Consumed by
   * candidateIdSet, not by the per-reference query derivation. */
  knownOnly: boolean;
}

/** Canonical defaults — the params store boots from these. */
export const DEFAULT_FOLLOW_PARAMS: FollowParams = {
  harmonicKeys: true,
  bpm: true,
  bpmThresholdPercent: 5,
  tags: false,
  energy: false,
  energyPreset: 'near',
  knownOnly: false,
};

// ── Derivation ──────────────────────────────────────────────────────────

/**
 * Query params for one reference Track — the shape the track-list API
 * accepts. Axes the parameters (or the Track's missing fields) exclude
 * derive to their neutral values.
 */
export interface FollowQuery {
  keyCamelotIds: string[];
  bpmCenter: number | null;
  bpmThresholdPercent: number | null;
  tagIds: number[];
  tagMatchMode: 'ANY';
  energyMin: number;
  energyMax: number;
}

/**
 * Harmonically compatible keys of a Track's Key, in OpenKey notation:
 * same key, wheel neighbours (±1, same mode), relative major/minor.
 */
export function getHarmonicKeys(keyId: number | null | undefined): string[] {
  if (keyId === null || keyId === undefined) return [];

  const openKey = formatKeyDisplay(keyId);
  const match = openKey.match(/^(\d+)(m|d)$/);
  if (!match) return [];

  const num = parseInt(match[1]);
  const mode = match[2];
  const prev = num === 1 ? 12 : num - 1;
  const next = num === 12 ? 1 : num + 1;
  const opposite = mode === 'm' ? 'd' : 'm';

  return [openKey, `${prev}${mode}`, `${next}${mode}`, `${num}${opposite}`];
}

/** Candidate energy range for a reference energy under a preset. */
export function getEnergyRange(
  referenceEnergy: number,
  preset: EnergyPreset
): { min: number; max: number } {
  switch (preset) {
    case 'equal':
      return { min: referenceEnergy, max: referenceEnergy };
    case 'near':
      return {
        min: Math.max(1, referenceEnergy - 1),
        max: Math.min(5, referenceEnergy + 1),
      };
    case 'up':
      return { min: referenceEnergy, max: 5 };
    case 'down':
      return { min: 1, max: referenceEnergy };
  }
}

/** Derive the heuristic-tier query for one reference Track. */
export function deriveFollowQuery(reference: Track, params: FollowParams): FollowQuery {
  const query: FollowQuery = {
    keyCamelotIds: [],
    bpmCenter: null,
    bpmThresholdPercent: null,
    tagIds: [],
    tagMatchMode: 'ANY',
    energyMin: 1,
    energyMax: 5,
  };

  if (params.harmonicKeys) {
    query.keyCamelotIds = getHarmonicKeys(reference.key);
  }

  if (params.bpm && reference.bpm) {
    query.bpmCenter = reference.bpm;
    query.bpmThresholdPercent = params.bpmThresholdPercent;
  }

  if (params.tags && reference.tags.length > 0) {
    query.tagIds = reference.tags.map((t) => t.id);
  }

  if (params.energy && reference.energy !== undefined) {
    const { min, max } = getEnergyRange(reference.energy, params.energyPreset);
    query.energyMin = min;
    query.energyMax = max;
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
  const parts: string[] = [];
  if (params.harmonicKeys && reference.key !== null && reference.key !== undefined) {
    parts.push(formatKeyDisplay(reference.key));
  }
  if (params.bpm && reference.bpm) {
    parts.push(`${Math.round(reference.bpm)}±${params.bpmThresholdPercent}%`);
  }
  if (params.energy && reference.energy !== undefined) {
    const { min, max } = getEnergyRange(reference.energy, params.energyPreset);
    parts.push(`E${min}–${max}`);
  }
  if (params.tags && reference.tags.length > 0) {
    parts.push('tags');
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
 * chips, modal context) and the Library (queries, tiering) share. */
export function followedReferences(
  flags: FollowFlags,
  loaded: Record<ChannelId, Track | null>
): Array<{ deck: ChannelId; reference: Track }> {
  return DECKS.flatMap((deck) => {
    const reference = loaded[deck];
    return flags[deck] && reference ? [{ deck, reference }] : [];
  });
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

/** Tier order is provisional (PRD) — keep changes inside this face. The
 * known tier's strengths ARE its leading tiers (linked-pairs 04), so the
 * Key tiers start right after the weakest known strength. */
const TIER_KNOWN_BEST = KNOWN_FAVORITED;
const TIER_KNOWN_SPAN = KNOWN_SAVED + 1;
const TIER_SAME_KEY = TIER_KNOWN_SPAN;
const TIER_RELATIVE_KEY = TIER_SAME_KEY + 1;
const TIER_KEY_UP = TIER_RELATIVE_KEY + 1;
const TIER_KEY_DOWN = TIER_KEY_UP + 1;
const TIER_REST = TIER_KEY_DOWN + 1;

function parseOpenKey(keyId: number | null | undefined): { num: number; mode: string } | null {
  const openKey = engineIdToOpenKey(keyId);
  const match = openKey?.match(/^(\d+)(m|d)$/);
  return match ? { num: parseInt(match[1]), mode: match[2] } : null;
}

function tierAgainst(candidate: Track, reference: FollowReference): number {
  const known = reference.knownStrength(candidate.id);
  if (known !== null) return known;
  const ref = parseOpenKey(reference.track.key);
  const cand = parseOpenKey(candidate.key);
  if (!ref || !cand) return TIER_REST;
  if (cand.num === ref.num) {
    return cand.mode === ref.mode ? TIER_SAME_KEY : TIER_RELATIVE_KEY;
  }
  if (cand.mode !== ref.mode) return TIER_REST;
  const up = ref.num === 12 ? 1 : ref.num + 1;
  const down = ref.num === 1 ? 12 : ref.num - 1;
  if (cand.num === up) return TIER_KEY_UP;
  if (cand.num === down) return TIER_KEY_DOWN;
  return TIER_REST;
}

/**
 * Candidate strength: known (favorited Transition, Linked, unfavorited
 * Transition), same Key, relative Key, one Key up, one Key down, then
 * everything else that passed the filter. Best tier wins across followed
 * references.
 */
export function followTier(candidate: Track, references: FollowReference[]): number {
  let best = TIER_REST;
  for (const reference of references) {
    best = Math.min(best, tierAgainst(candidate, reference));
    if (best === TIER_KNOWN_BEST) break;
  }
  return best;
}

/** Section-header names reifying the tiers (follow-mode 08). Indexed by
 * followTier's result; keep in lockstep with the tier constants above. */
const TIER_LABELS: readonly string[] = [
  '★ Favorited transition',
  '🔗 Linked',
  '◆ Saved transition',
  'Same key',
  'Relative key',
  'Key up',
  'Key down',
  'Other matches',
];

export function tierLabel(tier: number): string {
  return TIER_LABELS[tier] ?? TIER_LABELS[TIER_LABELS.length - 1];
}

/**
 * Tier-order the followed list. The sort is stable, so the incoming order
 * (the view's own sort) holds within each tier — tiering groups, never
 * overrides. No references = no reordering.
 */
export function orderByTier(tracks: Track[], references: FollowReference[]): Track[] {
  if (references.length === 0) return tracks;
  const tiers = new Map(tracks.map((t) => [t.id, followTier(t, references)]));
  return [...tracks].sort((x, y) => tiers.get(x.id)! - tiers.get(y.id)!);
}

export function candidateIdSet(
  heuristicSets: Track[][],
  // Anything keyed by track id — a Set of ids or the transition index's
  // per-reference Map (trackId → PairInfo).
  knownSets: ReadonlyArray<{ keys(): IterableIterator<number> }>,
  knownOnly: boolean
): Set<number> {
  const ids = knownOnly ? new Set<number>() : unionIds(heuristicSets);
  for (const known of knownSets) {
    for (const id of known.keys()) ids.add(id);
  }
  return ids;
}
