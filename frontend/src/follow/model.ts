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
import { formatKeyDisplay } from '../utils/keyUtils';

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
}

/** Canonical defaults. Production currently projects the stored one-shot
 * settings instead; this becomes the params store's default when the
 * parameters move to their own preference key (issue 05). */
export const DEFAULT_FOLLOW_PARAMS: FollowParams = {
  harmonicKeys: true,
  bpm: true,
  bpmThresholdPercent: 5,
  tags: false,
  energy: false,
  energyPreset: 'near',
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
