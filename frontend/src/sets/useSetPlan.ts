/**
 * useSetPlan (sets 03): assemble the pure planner's input from the live
 * stores/queries and return the deterministic playback plan.
 *
 * Inputs: the Set's entries (set store), track facts (the caller's track
 * map), full Transition payloads (pair store), and — for Take pins — the
 * raw capture slices fetched per uuid (vectorized inside the planner at
 * plan time, per the PRD: idealized, never snapshotted). Returns
 * undefined while anything is still loading; a failed Take fetch degrades
 * that pin to a hard cut (dangling-reference rule).
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useQueries } from '@tanstack/react-query';
import { api } from '../api/client';
import type { VectorizeInput } from '../capture/vectorize';
import type { Transition } from '../editor/mixModel';
import {
  initTransitionStore,
  snapshotPairStore,
  subscribePairStore,
} from '../editor/pairStore';
import type { Track } from '../types';
import { planSet, type PlanInput, type SetPlan, type TempoPolicyInput } from './planner';
import { useSetSettings } from './setSettings';
import type { SetEntryLocal } from './setStore';

export function useSetPlan(
  entries: SetEntryLocal[] | undefined,
  trackMap: Map<number, Track> | undefined,
  /** The Set's Tempo policy (sets 06); absent while the row loads —
   * planned as Riding at the tuned return speed. */
  tempo?: { policy: 'riding' | 'fixed'; setTempoBpm: number | null }
): SetPlan | undefined {
  const { tempoReturnSecPerPercent } = useSetSettings();
  const pairStore = useSyncExternalStore(subscribePairStore, snapshotPairStore);

  // Never plan against an unloaded pair store: pinned Transitions would
  // transiently degrade to hard cuts — and a "Play set" pressed in that
  // window would snapshot the wrong plan into the Conductor.
  const [transitionsReady, setTransitionsReady] = useState(false);
  useEffect(() => {
    let alive = true;
    void initTransitionStore().then(() => {
      if (alive) setTransitionsReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const takeUuids = (entries ?? [])
    .filter((e) => e.pin?.kind === 'take')
    .map((e) => e.pin!.uuid);
  const takeQueries = useQueries({
    queries: takeUuids.map((uuid) => ({
      queryKey: ['take', uuid],
      queryFn: () => api.takes.get(uuid),
      staleTime: Infinity,
      retry: false,
    })),
  });
  const takesLoading = takeQueries.some((q) => q.isLoading);

  return useMemo(() => {
    if (!entries || entries.length === 0) return undefined;
    if (!transitionsReady || takesLoading) return undefined;
    if (!trackMap || entries.some((e) => !trackMap.has(e.trackId))) return undefined;

    const tracks: PlanInput['tracks'] = {};
    for (const e of entries) {
      const t = trackMap.get(e.trackId)!;
      tracks[e.trackId] = {
        durationSec: t.duration_secs ?? 0,
        bpm: t.bpm ?? null,
        mainCueSec: t.cue_point_time ?? 0,
      };
    }

    // Full Transition payloads for each adjacency's ordered pair, keyed by
    // uuid (dangling pin uuids simply stay absent → hard cut).
    const transitionsByUuid: Record<string, Transition> = {};
    for (let i = 0; i < entries.length - 1; i++) {
      const pair = pairStore[`${entries[i].trackId}:${entries[i + 1].trackId}`];
      for (const item of pair?.items ?? []) {
        transitionsByUuid[item.uuid] = item.transition;
      }
    }

    const takesByUuid: Record<string, VectorizeInput> = {};
    takeUuids.forEach((uuid, i) => {
      const detail = takeQueries[i]?.data;
      if (!detail) return; // fetch failed → dangling → hard cut
      takesByUuid[uuid] = {
        events: detail.events,
        windowStartS: detail.window_start_s,
        windowEndS: detail.window_end_s,
      };
    });

    const tempoInput: TempoPolicyInput =
      tempo?.policy === 'fixed'
        ? { policy: 'fixed', setTempoBpm: tempo.setTempoBpm }
        : { policy: 'riding', returnSecPerPercent: tempoReturnSecPerPercent };

    return planSet({ entries, tracks, transitionsByUuid, takesByUuid, tempo: tempoInput });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    entries,
    trackMap,
    pairStore,
    transitionsReady,
    takesLoading,
    takeUuids.join(','),
    tempo?.policy,
    tempo?.setTempoBpm,
    tempoReturnSecPerPercent,
  ]);
}
