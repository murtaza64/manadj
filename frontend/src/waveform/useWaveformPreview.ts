import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { parseWaveformArrays } from './blob';

export interface WaveformPreviewData {
  blob: ArrayBuffer;
  etag: string;
  duration: number;
}

/** Cache only the 2.4KB substrate, not full waveform/LOD buffers. */
export function useWaveformPreview(trackId: number) {
  const client = useQueryClient();
  const queryKey = ['waveform-preview', trackId];
  return useQuery<WaveformPreviewData | null>({
    queryKey,
    queryFn: async () => {
      // Let this tiny request finish across virtual-row remounts and populate the cache.
      const preview = await api.waveforms.getPreview(trackId);
      if (!preview) return null;
      const previous = client.getQueryData<WaveformPreviewData | null>(queryKey);
      if (previous?.etag === preview.etag) return previous;
      const { duration } = parseWaveformArrays(preview.blob).header;
      if (!Number.isFinite(duration) || duration <= 0) throw new Error('Invalid waveform preview duration');
      return { ...preview, duration };
    },
    structuralSharing: false,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: (count, error) => !('status' in error && (error.status === 404 || error.status === 409)) && count < 2,
    // Poll pending generation quickly; revalidate ready previews for regeneration.
    // React Query suspends interval fetching in background tabs.
    refetchInterval: (query) => {
      const error = query.state.error;
      if (error && 'status' in error && error.status === 404) return false;
      if (error && 'status' in error && error.status === 409) return 60_000;
      return query.state.data ? 60_000 : 8000;
    },
  });
}
