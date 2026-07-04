// Fetch + decode Waveform data v2 blobs (ADR 0014).

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { decodeWaveformBlob } from './blob';
import type { DecodedWaveform } from './blob';

/**
 * Fetches a Track's Waveform data blob and decodes it (header + LOD-packed
 * typed arrays). Retries ride out background generation (the endpoint 404s
 * until the task worker has produced the blob); immutable once present.
 */
export function useWaveformBlob(trackId: number | null) {
  const { data: buffer, isLoading, error } = useQuery<ArrayBuffer>({
    queryKey: ['waveform-blob', trackId],
    queryFn: () => api.waveforms.getData(trackId!),
    enabled: trackId !== null,
    staleTime: Infinity, // Waveform data never changes once generated
    retry: 5,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
  });

  const data: DecodedWaveform | undefined = useMemo(
    () => (buffer ? decodeWaveformBlob(buffer) : undefined),
    [buffer],
  );

  return { data, isLoading, error };
}
