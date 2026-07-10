import type { Track } from '../types';
import { engineIdToOpenKey } from '../utils/keyUtils';
import { sharedArtist } from './sharedArtist';
import { DEFAULT_FOLLOW_PARAMS } from './model';
import type { FollowReference } from './model';

/**
 * Match score (match-score PRD): the heuristic stratum's single order.
 * A weighted sum over five signals — key relation, Tag overlap, Shared
 * artist (AFFINITY signals: evidence two Tracks go together) plus BPM
 * proximity and energy neighborhood (CONTEXT signals: evidence the blend
 * is mechanically comfortable). Key is a bonus with a zero floor: a clash
 * earns nothing and costs nothing. Missing data contributes 0 everywhere —
 * Unprocessed tracks are unboosted, never buried.
 *
 * The Affinity floor keeps noise out: a candidate's affinity subtotal
 * alone must reach what the weakest compatible key relation would earn.
 * Context signals order, but never admit. Known candidates bypass floor
 * and gate entirely (confirmed evidence outranks all heuristics — the
 * comparator pins Known strata on top).
 *
 * Pure functions, deliberately isolated like followTier was (its PRD
 * marked the tiering provisional for exactly this redesign); weight
 * tuning is an edit to the constants below.
 */

/** Weight allocation — the whole thing is tunable heuristics. */
export const WEIGHTS = {
  tags: 30,
  key: 25,
  artist: 20,
  energy: 15,
  bpm: 10,
} as const;

/** Key-relation bonus ladder. Never negative: 'other' includes clashes
 * AND missing keys — neither is punished. */
export const KEY_BONUS = {
  same: 1.0,
  relative: 0.8,
  up: 0.7,
  down: 0.6,
  other: 0,
} as const;

export type KeyRelation = keyof typeof KEY_BONUS;

/** Shared-tag count at which the log curve reaches 1.0. More keeps
 * scoring (monotone, never flat) — the curve just grows gently past it. */
export const TAG_NORM_COUNT = 8;

/** BPM flat zone: within this % of the nearest dyadic fold the
 * contribution is full; beyond it, linear decay to the gate edge. */
export const BPM_FLAT_PERCENT = 2;

/** The Affinity floor: what the weakest compatible key relation would
 * earn by itself (−1 wheel). Affinity subtotal must reach it. */
export const AFFINITY_FLOOR = WEIGHTS.key * KEY_BONUS.down;

// ── Signal curves ───────────────────────────────────────────────────────

function parseOpenKey(keyId: number | null | undefined): { num: number; mode: string } | null {
  const openKey = engineIdToOpenKey(keyId);
  const match = openKey?.match(/^(\d+)(m|d)$/);
  return match ? { num: parseInt(match[1]), mode: match[2] } : null;
}

/** Wheel relation of the candidate's key to the reference's. Missing or
 * unparseable keys are 'other' (neutral) by design. */
export function keyRelation(
  referenceKey: number | null | undefined,
  candidateKey: number | null | undefined
): KeyRelation {
  const ref = parseOpenKey(referenceKey);
  const cand = parseOpenKey(candidateKey);
  if (!ref || !cand) return 'other';
  if (cand.num === ref.num) return cand.mode === ref.mode ? 'same' : 'relative';
  if (cand.mode !== ref.mode) return 'other';
  const up = ref.num === 12 ? 1 : ref.num + 1;
  const down = ref.num === 1 ? 12 : ref.num - 1;
  if (cand.num === up) return 'up';
  if (cand.num === down) return 'down';
  return 'other';
}

/** Log-shaped tag contribution: steep at first, gentle forever. Monotone
 * and never flat — normalized to 1.0 at TAG_NORM_COUNT shared tags but
 * deliberately unclamped past it. */
export function tagContribution(sharedCount: number): number {
  if (sharedCount <= 0) return 0;
  return Math.log2(1 + sharedCount) / Math.log2(1 + TAG_NORM_COUNT);
}

/** Energy neighborhood, asymmetric: a rise slightly over a drop, ±2 or
 * more counts for nothing. Missing energy on either side: 0. */
export function energyContribution(
  referenceEnergy: number | null | undefined,
  candidateEnergy: number | null | undefined
): number {
  if (referenceEnergy == null || candidateEnergy == null) return 0;
  const delta = candidateEnergy - referenceEnergy;
  if (delta === 0) return 1.0;
  if (delta === 1) return 0.9;
  if (delta === -1) return 0.7;
  return 0;
}

/** Nearest dyadic fold of the reference tempo (center, ×2, ÷2) and the
 * candidate's percent distance from it. Exported for the gate tests. */
export function foldedBpmDistancePercent(
  referenceBpm: number,
  candidateBpm: number
): number {
  let best = Infinity;
  for (const fold of [referenceBpm, referenceBpm * 2, referenceBpm / 2]) {
    best = Math.min(best, (Math.abs(candidateBpm - fold) / fold) * 100);
  }
  return best;
}

/** BPM proximity: flat 1.0 within the flat zone of the nearest fold, then
 * linear decay to the gate edge (the follow BPM threshold). No half-time
 * discount — proximity is measured on the fold. Missing BPM: 0. */
export function bpmContribution(
  referenceBpm: number | null | undefined,
  candidateBpm: number | null | undefined,
  thresholdPercent: number = DEFAULT_FOLLOW_PARAMS.bpmThresholdPercent
): number {
  if (referenceBpm == null || candidateBpm == null) return 0;
  if (referenceBpm <= 0 || candidateBpm <= 0) return 0;
  const distance = foldedBpmDistancePercent(referenceBpm, candidateBpm);
  if (distance <= BPM_FLAT_PERCENT) return 1.0;
  if (distance >= thresholdPercent) return 0;
  return 1 - (distance - BPM_FLAT_PERCENT) / (thresholdPercent - BPM_FLAT_PERCENT);
}

// ── Score, floor, rank ──────────────────────────────────────────────────

function sharedTagCount(reference: Track, candidate: Track): number {
  if (!reference.tags?.length || !candidate.tags?.length) return 0;
  const referenceIds = new Set(reference.tags.map((t) => t.id));
  return candidate.tags.reduce((n, t) => n + (referenceIds.has(t.id) ? 1 : 0), 0);
}

/** The affinity signals' weighted subtotal (key + tags + artist) — what
 * the floor tests. Context signals (BPM, energy) are deliberately absent:
 * they order, but never admit. */
export function affinitySubtotal(reference: Track, candidate: Track): number {
  return (
    WEIGHTS.key * KEY_BONUS[keyRelation(reference.key, candidate.key)] +
    WEIGHTS.tags * tagContribution(sharedTagCount(reference, candidate)) +
    WEIGHTS.artist * (sharedArtist(reference.artist, candidate.artist) ? 1 : 0)
  );
}

/** A candidate's affinity evidence must be at least compatible-key-grade. */
export function passesAffinityFloor(reference: Track, candidate: Track): boolean {
  return affinitySubtotal(reference, candidate) >= AFFINITY_FLOOR;
}

/** The Match score: affinity subtotal + context signals. ~0..100. */
export function matchScore(
  reference: Track,
  candidate: Track,
  bpmThresholdPercent: number = DEFAULT_FOLLOW_PARAMS.bpmThresholdPercent
): number {
  return (
    affinitySubtotal(reference, candidate) +
    WEIGHTS.energy * energyContribution(reference.energy, candidate.energy) +
    WEIGHTS.bpm * bpmContribution(reference.bpm, candidate.bpm, bpmThresholdPercent)
  );
}

// ── The one total edge order (two consumers: Follow, suggestions) ───────

/**
 * A candidate's rank against the followed references: its best Known
 * strength (links/known.ts order — confirmed evidence is never outscored),
 * its best Match score, and whether any reference admits it (floor).
 * Dual-follow best-position-wins, like followTier before it.
 */
export interface CandidateRank {
  known: number | null;
  score: number;
  admitted: boolean;
}

export function rankAgainst(
  candidate: Track,
  references: FollowReference[],
  bpmThresholdPercent: number = DEFAULT_FOLLOW_PARAMS.bpmThresholdPercent
): CandidateRank {
  let known: number | null = null;
  let score = -Infinity;
  let admitted = false;
  for (const reference of references) {
    const strength = reference.knownStrength(candidate.id);
    if (strength !== null) known = known === null ? strength : Math.min(known, strength);
    score = Math.max(score, matchScore(reference.track, candidate, bpmThresholdPercent));
    admitted = admitted || passesAffinityFloor(reference.track, candidate);
  }
  // Known bypasses the floor, as it bypasses gates today.
  return { known, score, admitted: admitted || known !== null };
}

/**
 * The shared comparator: Known strata in Known-strength order above any
 * score, then Compatible descending by Match score. Callers exclude
 * unadmitted candidates (rank.admitted) — the floor is the cut, not a
 * sort position.
 */
export function compareRanks(a: CandidateRank, b: CandidateRank): number {
  if (a.known !== null || b.known !== null) {
    if (a.known === null) return 1;
    if (b.known === null) return -1;
    if (a.known !== b.known) return a.known - b.known;
  }
  return b.score - a.score;
}
