/**
 * ConductorPlanFeed (sets 24): the live re-plan subscription seam.
 *
 * The Conductor survives view switches (conductorStore), but the plan
 * is assembled from React-side stores and queries (useSetPlanParts) —
 * so while a Set is conducting, THIS headless App-level component keeps
 * a plan assembly mounted for that Set and pushes every recomputed
 * PlanInput into replanSetPlayback. One component above the view switch
 * means "edit anywhere, hear it in the ongoing set": Transition
 * autosaves (pair store), pins/dormancy/order (set store), tempo
 * policy (the Set row's query cache), hot cues, and tunables all flow
 * through the same assembly the Set view plans with. Issue 26's
 * auto-resolves will widen useSetPlanParts and arrive here for free.
 *
 * Coalescing: editor drags reach the pair store through the autosave
 * debounce (300 ms), and each recompute is one memoized input object —
 * one replan per settled edit, no extra debounce needed here.
 */
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Track } from '../types';
import { replanSetPlayback, useConductorState } from './conductorStore';
import { ensureSetEntriesLoaded, useSetEntries } from './setStore';
import { useSetPlanParts } from './useSetPlan';

export function ConductorPlanFeed(): React.ReactElement | null {
  const { setId, status } = useConductorState();
  if (setId === null || status === 'idle') return null;
  return <Feed key={setId} setId={setId} />;
}

function Feed({ setId }: { setId: number }): null {
  const entries = useSetEntries(setId);
  useEffect(() => {
    void ensureSetEntriesLoaded(setId);
  }, [setId]);

  // Same query keys as SetDetailPane: the caches are shared, and the
  // tempo chip's ['sets'] invalidation re-plans the run.
  const { data: sets = [] } = useQuery({ queryKey: ['sets'], queryFn: api.sets.list });
  const set = sets.find((s) => s.id === setId);
  const trackIds = (entries ?? []).map((e) => e.trackId);
  const { data: trackMap } = useQuery({
    queryKey: ['tracks', 'set-rows', setId, trackIds.join(',')],
    enabled: trackIds.length > 0,
    queryFn: async () => {
      const tracks = await Promise.all(trackIds.map((id) => api.tracks.getById(id)));
      return new Map<number, Track>(tracks.map((t) => [t.id, t]));
    },
  });

  const { input } = useSetPlanParts(
    entries,
    trackMap,
    set ? { policy: set.tempo_policy, setTempoBpm: set.set_tempo_bpm } : undefined
  );

  useEffect(() => {
    if (input) replanSetPlayback(setId, input);
  }, [setId, input]);

  return null;
}
