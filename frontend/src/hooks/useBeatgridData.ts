import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { BeatgridResponse } from '../types';

/**
 * Grid-nudge step in milliseconds — the ONE home for the ±10ms every grid
 * nudge surface uses (buttons via GridEditControls, library Shift+H/L).
 */
export const GRID_NUDGE_MS = 10;

/**
 * Bounded-retry policy shared by every ['beatgrid', id] fetch site (this
 * hook and DeckContext's load-time fetchQuery), mirroring the waveform blob
 * (useWaveformBlob.ts): a freshly-downloaded track's beatgrid 400/404s until
 * the background analysis task writes the grid, so retry with exponential
 * backoff to ride that out. Bounded at 5 so tracks that legitimately have no
 * grid (analysis bailed) settle into error instead of retrying forever
 * (deck-asset-refresh 01).
 */
export const BEATGRID_RETRY = 5;
export const beatgridRetryDelay = (attemptIndex: number) =>
  Math.min(1000 * 2 ** attemptIndex, 10000);

/**
 * Hook for fetching beatgrid data.
 *
 * Fetches beatgrid from API and caches indefinitely.
 * Auto-generates on backend if track has BPM but no beatgrid.
 */
export function useBeatgridData(trackId: number | null) {
  const { data, isLoading, error } = useQuery<BeatgridResponse>({
    queryKey: ['beatgrid', trackId],
    queryFn: () => api.beatgrids.get(trackId!),
    enabled: trackId !== null,
    staleTime: Infinity,  // Beatgrids rarely change
    retry: BEATGRID_RETRY,  // Ride out background analysis; bounded (see BEATGRID_RETRY)
    retryDelay: beatgridRetryDelay,
  });

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
