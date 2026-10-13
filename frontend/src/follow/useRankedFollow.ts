import { useMemo, useState } from 'react';
import { useQueries, type UseQueryResult } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Track } from '../types';
import type { ChannelId } from '../playback/mixer';
import { transitionsFrom, type TransitionIndex } from '../editor/transitionIndex';
import { linkedIdsOf, type LinkKey } from '../links/linkStore';
import { knownStrengthOf } from '../links/known';
import { deriveFollowQuery, followedReferences } from './model';
import { useFollowFlags } from './followStore';
import { useFollowParams, useFollowSeed } from './paramsStore';
import { FollowRanking } from './rankedFollow';

const trackRows = (results: UseQueryResult<Track>[]) => results.map(r => r.data);
interface CandidateResult { referenceId: number; items: Track[] }
const candidateRows = (results: UseQueryResult<CandidateResult>[]) => results.map(r => r.data);

/** Query completion/status changes are not ranking inputs: combine retains
 * structurally shared data, while track queries subscribe to same-ID edits. */
export function useRankedFollow(
  loaded: Record<ChannelId, Track | null>,
  transitions: TransitionIndex,
  links: ReadonlySet<LinkKey>,
  archived: boolean,
) {
  const flags = useFollowFlags();
  const params = useFollowParams();
  const seed = useFollowSeed();
  const [cache] = useState(() => new FollowRanking());
  const { A, B, C, D } = loaded;
  const slots = useMemo(() => {
    const seen = new Set<number>();
    return followedReferences(flags, { A, B, C, D }).filter(({ reference }) => {
      if (seen.has(reference.id)) return false;
      seen.add(reference.id);
      return true;
    });
  }, [flags, A, B, C, D]);
  const fresh = useQueries({
    queries: slots.map(({ reference }) => ({
      queryKey: ['track', reference.id], queryFn: () => api.tracks.get(reference.id),
    })),
    combine: trackRows,
  });
  // During observer-list changes, combine can still expose the previous
  // tuple. Join by identity, never by its transient array position.
  const references = useMemo(() => slots.map(slot => ({
    ...slot, reference: fresh.find(track => track?.id === slot.reference.id) ?? slot.reference,
  })), [slots, fresh]);
  const candidates = useQueries({
    queries: references.map(({ reference }) => {
      const q = deriveFollowQuery(reference, params);
      return {
        queryKey: ['tracks', 'follow', reference.id, q, archived],
        queryFn: async (): Promise<CandidateResult> => ({
          referenceId: reference.id,
          items: (await api.tracks.list(1, 10000, {
            bpmCenter: q.bpmCenter, bpmThresholdPercent: q.bpmThresholdPercent,
            archived: archived ? true : undefined,
          })).items,
        }),
        placeholderData: (previous: CandidateResult | undefined) => previous,
      };
    }),
    combine: candidateRows,
  });
  const snapshot = useMemo(() => cache.derive(references.map(({ reference }) => {
    const from = transitionsFrom(transitions, reference.id);
    const known = new Map<number, number>();
    for (const id of [...from.keys(), ...linkedIdsOf(links, reference.id)]) {
      known.set(id, knownStrengthOf(from, links, reference.id, id)!);
    }
    return { track: reference, candidates: candidates.find(r => r?.referenceId === reference.id)?.items, known };
  }), { knownOnly: params.knownOnly, bpmThresholdPercent: params.bpmThresholdPercent }),
  [cache, references, candidates, transitions, links, params.knownOnly, params.bpmThresholdPercent]);
  return useMemo(() => ({
    ...snapshot,
    project: (source: Track[], scoreSort: boolean) => snapshot.project(source, scoreSort, params.temperature, seed),
  }), [snapshot, params.temperature, seed]);
}
