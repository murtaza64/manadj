// Fetch + decode Waveform data v2 blobs (ADR 0014).

import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { decodeWaveformBlob } from './blob';
import type { DecodedWaveform } from './blob';

/**
 * Fetches a Track's Waveform data blob and decodes it (header + LOD-packed
 * typed arrays). Retries ride out background generation (the endpoint 404s
 * until the task worker has produced the blob); immutable once present.
 *
 * The DECODED form is what's query-cached (issue 43): decoding in a
 * per-hook useMemo re-paid ~1.5ms × N consumers × every remount — a set
 * switch re-decoded the whole set. Decode once in the queryFn instead.
 */
export function useWaveformBlob(trackId: number | null) {
  const { data, isLoading, error } = useQuery<DecodedWaveform>({
    queryKey: ['waveform-blob', trackId],
    queryFn: async () => decodeWaveformBlob(await api.waveforms.getData(trackId!)),
    enabled: trackId !== null,
    staleTime: Infinity, // Waveform data never changes once generated
    retry: 5,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
  });

  return { data, isLoading, error };
}
