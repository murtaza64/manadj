import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { MetricLadderResponse } from '../types';

/**
 * ['metric-ladder', id] observer options — the Metric-ladder sibling of
 * beatgridQueryOptions. The endpoint always answers (default when no row),
 * so no analysis-riding retry policy is needed.
 */
export function metricLadderQueryOptions(trackId: number | null) {
  return {
    queryKey: ['metric-ladder', trackId] as const,
    queryFn: () => api.metricLadders.get(trackId!) as Promise<MetricLadderResponse>,
    enabled: trackId !== null,
    staleTime: Infinity, // edits invalidate explicitly
  };
}

/** The track's effective Metric ladder (ADR 0029) — the computed default
 * (persisted=false) until an authoring gesture deviates. */
export function useMetricLadderData(trackId: number | null) {
  const { data, isLoading, error } = useQuery<MetricLadderResponse>(
    metricLadderQueryOptions(trackId)
  );
  return { data, isLoading, error };
}

/**
 * Full-state Reset-mark upsert: each authoring gesture sends the complete
 * mark list (add = list + new mark, delete = list − nearest). One gesture,
 * one PUT — the inverse gesture is its undo.
 */
export function usePutMetricLadder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ trackId, resetMarks }: { trackId: number; resetMarks: number[] }) =>
      api.metricLadders.put(trackId, resetMarks),
    onSuccess: (data, variables) => {
      queryClient.setQueryData(['metric-ladder', variables.trackId], data);
    },
  });
}
