import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { HotCue } from '../types';

export function useHotCues(trackId: number | null) {
  return useQuery<HotCue[]>({
    queryKey: ['hotcues', trackId],
    queryFn: () => api.hotcues.get(trackId!),
    enabled: trackId !== null,
    placeholderData: [],
    staleTime: 0, // Always consider stale for immediate updates
    refetchOnMount: 'always',
  });
}

export function useSetHotCue() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      trackId,
      slotNumber,
      data,
    }: {
      trackId: number;
      slotNumber: number;
      data: {
        time_seconds: number;
        label?: string;
        color?: string;
      };
    }) => api.hotcues.set(trackId, slotNumber, data),
    onMutate: async (variables) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['hotcues', variables.trackId] });

      // Snapshot previous value
      const previousHotCues = queryClient.getQueryData<HotCue[]>(['hotcues', variables.trackId]);

      // Optimistically update
      queryClient.setQueryData<HotCue[]>(['hotcues', variables.trackId], (old) => {
        const currentData = old || [];

        // Check if hot cue already exists
        const existingIndex = currentData.findIndex(hc => hc.slot_number === variables.slotNumber);

        if (existingIndex >= 0) {
          // Update existing hot cue
          const newArray = [...currentData];
          newArray[existingIndex] = {
            ...newArray[existingIndex],
            time_seconds: variables.data.time_seconds,
            label: variables.data.label,
            color: variables.data.color,
          };
          return newArray;
        } else {
          // Add new hot cue (with temporary ID)
          return [
            ...currentData,
            {
              id: -variables.slotNumber, // Temporary negative ID
              track_id: variables.trackId,
              slot_number: variables.slotNumber,
              time_seconds: variables.data.time_seconds,
              label: variables.data.label,
              color: variables.data.color,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ];
        }
      });

      return { previousHotCues };
    },
    onError: (_err, variables, context) => {
      // Rollback on error
      if (context?.previousHotCues) {
        queryClient.setQueryData(['hotcues', variables.trackId], context.previousHotCues);
      }
    },
    onSettled: (_, __, variables) => {
      // Refetch to get server state
      queryClient.invalidateQueries({ queryKey: ['hotcues', variables.trackId] });
    },
  });
}

export function useDeleteHotCue() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      trackId,
      slotNumber,
    }: {
      trackId: number;
      slotNumber: number;
    }) => api.hotcues.delete(trackId, slotNumber),
    onMutate: async (variables) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['hotcues', variables.trackId] });

      // Snapshot previous value
      const previousHotCues = queryClient.getQueryData<HotCue[]>(['hotcues', variables.trackId]);

      // Optimistically update by removing the hot cue
      queryClient.setQueryData<HotCue[]>(['hotcues', variables.trackId], (old) => {
        if (!old) return old;
        return old.filter(hc => hc.slot_number !== variables.slotNumber);
      });

      return { previousHotCues };
    },
    onError: (_err, variables, context) => {
      // Rollback on error
      if (context?.previousHotCues) {
        queryClient.setQueryData(['hotcues', variables.trackId], context.previousHotCues);
      }
    },
    onSettled: (_, __, variables) => {
      // Refetch to get server state
      queryClient.invalidateQueries({ queryKey: ['hotcues', variables.trackId] });
    },
  });
}
