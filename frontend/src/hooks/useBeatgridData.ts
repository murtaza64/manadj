import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { BeatgridResponse } from '../types';

/**
 * Grid-nudge step in milliseconds — the ONE home for the ±10ms every grid
 * nudge surface uses (buttons via GridEditControls, library Shift+H/L).
 */
export const GRID_NUDGE_MS = 10;

/**
 * Bounded-retry policy for ['beatgrid', id] observers, mirroring the
 * waveform blob (useWaveformBlob.ts): a freshly-downloaded track's beatgrid
 * 400/404s until the background analysis task writes the grid, so retry
 * with exponential backoff to ride that out. Bounded at 5 so tracks that
 * legitimately have no grid (analysis bailed) settle into error instead of
 * retrying forever (deck-asset-refresh 01). NOT used by the deck load path:
 * readiness gates on ONE round trip (ADR 0029) — grids that land after it
 * reach the deck via the sync observer's arrival polling
 * (useDeckBeatgridSync).
 */
export const BEATGRID_RETRY = 5;
export const beatgridRetryDelay = (attemptIndex: number) =>
  Math.min(1000 * 2 ** attemptIndex, 10000);

/**
 * The one home for ['beatgrid', id] observer options — useBeatgridData and
 * the deck sync observer (useDeckBeatgridSync) spread this, so every
 * observer shares one cache entry and one fetch policy.
 */
export function beatgridQueryOptions(trackId: number | null) {
  return {
    queryKey: ['beatgrid', trackId] as const,
    queryFn: () => api.beatgrids.get(trackId!) as Promise<BeatgridResponse>,
    enabled: trackId !== null,
    staleTime: Infinity, // Beatgrids rarely change; edits invalidate explicitly
    retry: BEATGRID_RETRY, // Ride out background analysis; bounded (see BEATGRID_RETRY)
    retryDelay: beatgridRetryDelay,
  };
}

/**
 * Hook for fetching beatgrid data.
 *
 * Fetches beatgrid from API and caches indefinitely.
 * Auto-generates on backend if track has BPM but no beatgrid.
 */
export function useBeatgridData(trackId: number | null) {
  const { data, isLoading, error } = useQuery<BeatgridResponse>(
    beatgridQueryOptions(trackId)
  );

  return {
    data,
    isLoading,
    error,
  };
}

/**
 * Hook for setting beatgrid downbeat.
 */
export function useSetBeatgridDownbeat() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ trackId, downbeatTime }: { trackId: number; downbeatTime: number }) =>
      api.beatgrids.setDownbeat(trackId, downbeatTime),
    onSuccess: (_data, variables) => {
      // Invalidate beatgrid query to trigger refetch
      queryClient.invalidateQueries({ queryKey: ['beatgrid', variables.trackId] });
    },
  });
}

/**
 * Hook for nudging beatgrid.
 */
export function useNudgeBeatgrid() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ trackId, offsetMs }: { trackId: number; offsetMs: number }) =>
      api.beatgrids.nudge(trackId, offsetMs),
    onSuccess: (_data, variables) => {
      // Invalidate beatgrid query to trigger refetch
      queryClient.invalidateQueries({ queryKey: ['beatgrid', variables.trackId] });
    },
  });
}
