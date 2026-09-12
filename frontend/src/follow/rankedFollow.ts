import type { Track } from '../types';
import { partitionFollowedTracks } from './model';
import {
  AFFINITY_FLOOR, affinitySubtotal, rankAgainst,
  matchedSignals, compareRanks, compareKnownStrata, orderRanked, rankLabel,
  type CandidateRank, type MatchedSignals,
} from './matchScore';

export interface RankedReference {
  track: Track;
  /** Undefined means unresolved, not an empty candidate set. */
  candidates: readonly Track[] | undefined;
  known: ReadonlyMap<number, number>;
}

interface PairEvidence { affinity: number; signals: MatchedSignals }

/** Lifetime-scoped evidence cache. Equivalent rows from different query keys
 * share evidence; changed scoring facts invalidate even with the same ID. */
export class FollowRanking {
  private pairs = new WeakMap<Track, WeakMap<Track, PairEvidence>>();
  private identities = new WeakMap<Track, Track>();
  private facts = new Map<number, { key: string; track: Track }>();

  private canonical(track: Track): Track {
    const cached = this.identities.get(track);
    if (cached) return cached;
    const key = JSON.stringify([track.artist, track.key, track.bpm, track.energy,
      (track.tags ?? []).map(t => t.id).sort((a, b) => a - b)]);
    const previous = this.facts.get(track.id);
    const canonical = previous?.key === key ? previous.track : track;
    this.facts.delete(track.id);
    this.facts.set(track.id, { key, track: canonical });
    // Bound retained cross-query identities; weak entries survive only while
    // their source rows/snapshots do. One full candidate query is 10,000 rows.
    if (this.facts.size > 10_000) this.facts.delete(this.facts.keys().next().value!);
    this.identities.set(track, canonical);
    return canonical;
  }

  private evidence(reference: Track, candidate: Track): PairEvidence {
    reference = this.canonical(reference);
    candidate = this.canonical(candidate);
    let candidates = this.pairs.get(reference);
    if (!candidates) this.pairs.set(reference, candidates = new WeakMap());
    let evidence = candidates.get(candidate);
    if (!evidence) {
      evidence = {
        affinity: affinitySubtotal(reference, candidate),
        signals: matchedSignals(candidate, [{ track: reference, knownStrength: () => null }]),
      };
      candidates.set(candidate, evidence);
    }
    return evidence;
  }

  derive(references: readonly RankedReference[], params: { knownOnly: boolean; bpmThresholdPercent: number }) {
    const followedIds = references.map(r => r.track.id);
    const following = new Set(followedIds);
    const filtering = references.length > 0 && (params.knownOnly || references.some(r => r.candidates !== undefined));
    const candidateIds = new Set<number>();
    for (const reference of references) {
      for (const id of reference.known.keys()) candidateIds.add(id);
      if (!params.knownOnly) {
        for (const candidate of reference.candidates ?? []) {
          if (this.evidence(reference.track, candidate).affinity >= AFFINITY_FLOOR) candidateIds.add(candidate.id);
        }
      }
    }
    const rows = new WeakMap<Track, { rank: CandidateRank; signals: MatchedSignals }>();
    const rankingReferences = references.map(r => ({
      track: r.track, knownStrength: (id: number) => r.known.get(id) ?? null,
    }));
    const row = (candidate: Track) => {
      candidate = this.canonical(candidate);
      let value = rows.get(candidate);
      if (value) return value;
      const rank = rankAgainst(candidate, rankingReferences, params.bpmThresholdPercent,
        (reference, track) => this.evidence(reference, track).affinity);
      const signals: MatchedSignals = { key: false, tagIds: new Set() };
      for (const reference of references) {
        const pair = this.evidence(reference.track, candidate);
        signals.key ||= pair.signals.key;
        for (const id of pair.signals.tagIds) signals.tagIds.add(id);
      }
      value = { rank, signals };
      rows.set(candidate, value);
      return value;
    };
    // Retain only the latest ordering per source array, not every reroll.
    const projections = new WeakMap<Track[], { key: string; tracks: Track[] }>();
    return {
      project: (source: Track[], scoreSort: boolean, temperature: number, seed: number): Track[] => {
        if (!references.length) return source;
        const key = `${scoreSort}:${temperature}:${seed}`;
        const previous = projections.get(source);
        if (previous?.key === key) return previous.tracks;
        const { followed, rest } = partitionFollowedTracks(source, followedIds);
        const candidates = filtering ? rest.filter(t => candidateIds.has(t.id)) : rest;
        const ranks = new Map(filtering ? candidates.map(t => [t.id, row(t).rank]) : []);
        const ordered = filtering ? orderRanked(candidates, ranks, followedIds,
          scoreSort ? compareRanks : compareKnownStrata,
          scoreSort ? { temperature, seed } : undefined) : candidates;
        const tracks = [...followed, ...ordered];
        projections.set(source, { key, tracks });
        return tracks;
      },
      groupLabelFor: references.length ? (t: Track) => following.has(t.id) ? 'Following'
        : filtering ? rankLabel(row(t).rank) : 'Library' : undefined,
      scoreFor: filtering ? (t: Track) => following.has(t.id) || row(t).rank.known !== null
        ? null : row(t).rank.score : undefined,
      matchSignalsFor: filtering ? (t: Track) => following.has(t.id)
        ? { key: true, tagIds: new Set(t.tags.map(tag => tag.id)) } : row(t).signals : undefined,
    };
  }
}
