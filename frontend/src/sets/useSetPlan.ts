/**
 * useSetPlan (sets 03): assemble the pure planner's input from the live
 * stores/queries and return the deterministic playback plan.
 *
 * Inputs: the Set's entries (set store), track facts (the caller's track
 * map plus per-track hot cues fetched here — Hot Cue 1 is the hard-cut
 * entry anchor, sets 19), full Transition payloads (pair store), and —
 * for Take pins — the raw capture slices fetched per uuid (vectorized
 * inside the planner at plan time, per the PRD: idealized, never
 * snapshotted). Returns undefined while anything is still loading; a
 * failed Take fetch degrades that pin to a hard cut (dangling-reference
 * rule).
 *
 * Reactivity: the hot-cue queries share the `['hotcues', id]` cache keys
 * the hot-cue mutations invalidate, so moving a cue recomputes the plan
 * (ladder, durations, warnings) with no reload — the plan is a derived
 * projection, deliberately without a refresh button.
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
import type { HotCue, Track } from '../types';

/** Hot Cue 1 in track seconds, null when slot 1 is unset — THE home of
 * the cue-slot convention's "slot 1 = first buildup" lookup (the plan's
 * hard-cut entry anchor and the practice affordance both read it). */
export function hotCue1Sec(cues: HotCue[] | undefined): number | null {
  return cues?.find((c) => c.slot_number === 1)?.time_seconds ?? null;
}
import {
  planSet,
  plannerTrackFacts,
  type PlanInput,
  type SetPlan,
  type TempoPolicyInput,
} from './planner';
import { useSetSettings } from './setSettings';
import type { SetEntryLocal } from './setStore';

export function useSetPlan(
  entries: SetEntryLocal[] | undefined,
  trackMap: Map<number, Track> | undefined,
  /** The Set's Tempo policy (sets 06); absent while the row loads —
   * planned as Riding at the tuned return speed. */
  tempo?: { policy: 'riding' | 'fixed'; setTempoBpm: number | null }
): SetPlan | undefined {
  const { tempoReturnSecPerPercent, graceHeadroomSec, graceFadeSec } = useSetSettings();
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

  // Hot Cue 1 per track — the hard-cut entry anchor (sets 19). Same cache
  // keys as useHotCues/SetDetailPane, so cue edits invalidate the plan.
  const planTrackIds = [...new Set((entries ?? []).map((e) => e.trackId))];
  const hotCueQueries = useQueries({
    queries: planTrackIds.map((id) => ({
      queryKey: ['hotcues', id],
      queryFn: () => api.hotcues.get(id),
      staleTime: 0,
    })),
  });
  const hotCuesLoading = hotCueQueries.some((q) => q.isLoading);
  const hotCue1ByTrack = new Map<number, number>();
  planTrackIds.forEach((id, i) => {
    const sec = hotCue1Sec(hotCueQueries[i]?.data as HotCue[] | undefined);
    if (sec !== null) hotCue1ByTrack.set(id, sec);
  });
  const hotCue1Signature = planTrackIds
    .map((id) => `${id}:${hotCue1ByTrack.get(id) ?? ''}`)
    .join(',');

  return useMemo(() => {
    if (!entries || entries.length === 0) return undefined;
    if (!transitionsReady || takesLoading || hotCuesLoading) return undefined;
    if (!trackMap || entries.some((e) => !trackMap.has(e.trackId))) return undefined;

    const tracks: PlanInput['tracks'] = {};
    for (const e of entries) {
      const t = trackMap.get(e.trackId)!;
      // plannerTrackFacts reads the grid-first effective BPM (ADR 0016) —
      // never t.bpm, which can be a stale projection of the grid.
      tracks[e.trackId] = plannerTrackFacts(t, hotCue1ByTrack.get(e.trackId) ?? null);
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

    return planSet({
      entries,
      tracks,
      transitionsByUuid,
      takesByUuid,
      tempo: tempoInput,
      grace: { headroomSec: graceHeadroomSec, fadeSec: graceFadeSec },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    entries,
    trackMap,
    pairStore,
    transitionsReady,
    takesLoading,
    hotCuesLoading,
    hotCue1Signature,
    takeUuids.join(','),
    tempo?.policy,
    tempo?.setTempoBpm,
    tempoReturnSecPerPercent,
    graceHeadroomSec,
    graceFadeSec,
  ]);
}
