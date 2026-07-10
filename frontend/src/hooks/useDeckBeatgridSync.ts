import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { beatgridQueryOptions } from './useBeatgridData';
import type { DeckEngine } from '../playback/DeckEngine';
import type { BeatgridResponse, GridAnalysisDiagnostics } from '../types';

/** Arrival-poll cadence (ADR 0029 §3/§4): deck-scoped, so at most two
 * Tracks ever poll, and only while their grid/waveform is unsettled. */
export const ARRIVAL_POLL_MS = 8000;

/**
 * A grid is "settled" once a saved-origin row exists; a computed
 * placeholder (origin "generated", ADR 0027 §3) or a missing grid means
 * background analysis may still land one. Exported for tests.
 */
export function gridArrivalPollMs(
  data: BeatgridResponse | undefined,
  analysisBailed: boolean
): number | false {
  if (data !== undefined && data.origin !== 'generated') return false;
  if (analysisBailed) return false;
  return ARRIVAL_POLL_MS;
}

/**
 * Keep a Deck's Quantize grid live (cue-quantize-bpm 01, ADR 0029 §3).
 *
 * The engine snapshots beat times at Load; every grid mutation (BPM
 * re-tempo, nudge, downbeat mark — ADR 0016) invalidates the
 * `['beatgrid', id]` query, so an active observer per loaded Deck both
 * forces the refetch (whatever surface made the edit) and pushes the
 * re-spaced beats into the engine. Fetch failures push nothing — the
 * engine keeps its load-time grid rather than going gridless on a blip.
 *
 * Background analysis completion writes only the DB — no push, no
 * invalidation — so this observer also POLLS while the loaded Track's grid
 * is missing or a placeholder (ADR 0029 §3): the analyzed grid lands
 * within one poll interval, flows through setBeatTimes, and (on a still
 * untouched deck) re-parks the Main cue at the first beat. Polling stops
 * when a saved-origin grid arrives or grid diagnostics report the analysis
 * bailed (the Needs-attention worklist owns those).
 */
export function useDeckBeatgridSync(engine: DeckEngine, trackId: number | null): void {
  // refetchInterval closes over the previous render's bailed verdict via a
  // ref — the diagnostics query below can't be declared first because its
  // `enabled` needs the grid data. One render of lag is harmless at an 8s
  // cadence.
  const bailedRef = useRef(false);
  const { data } = useQuery({
    ...beatgridQueryOptions(trackId),
    refetchInterval: (query) =>
      gridArrivalPollMs(query.state.data, bailedRef.current),
  });

  // Grid diagnostics: the poll's termination signal for Tracks whose
  // analysis gave up (bailed → placeholder forever; without this the poll
  // would run for as long as the Track stays loaded). Only consulted while
  // the grid is unsettled — Tracks with saved grids never fetch it. 404
  // (never analyzed) reads as not-bailed: analysis is still coming.
  const unsettled =
    trackId !== null && (data === undefined || data.origin === 'generated');
  const { data: diagnostics } = useQuery<GridAnalysisDiagnostics>({
    queryKey: ['grid-analysis', trackId],
    queryFn: () => api.analyze.getGrid(trackId!),
    enabled: unsettled,
    retry: false,
    // Re-check on the same cadence as the grid poll: a bail verdict can
    // land while we poll (fresh import → analysis runs → bails).
    refetchInterval: unsettled && !bailedRef.current ? ARRIVAL_POLL_MS : false,
  });
  bailedRef.current = diagnostics?.bailed === true;

  useEffect(() => {
    if (trackId === null || data === undefined) return;
    engine.setBeatTimes(trackId, data.data.beat_times);
  }, [engine, trackId, data]);
}
