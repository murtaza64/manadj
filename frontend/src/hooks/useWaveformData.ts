import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { WaveformResponse, WaveformData } from '../types';
import type { WaveformDataWebGL } from '../utils/WebGLWaveformRenderer';

/**
 * Hook for fetching and transforming waveform data.
 *
 * Fetches waveform data from the API and transforms it into
 * the format expected by WebGLWaveformRenderer (Float32Arrays).
 *
 * @param trackId - The ID of the track to fetch waveform data for
 * @returns Object containing:
 *   - data: WaveformDataWebGL (with Float32Arrays) or undefined
 *   - rawData: WaveformData (original API response) or undefined
 *   - isLoading: boolean
 *   - error: Error or null
 */
export function useWaveformData(trackId: number | null) {
  const { data: waveformResponse, isLoading, error } = useQuery<WaveformResponse>({
    queryKey: ['waveform', trackId],
    queryFn: () => api.waveforms.get(trackId!),
    enabled: trackId !== null,
    staleTime: Infinity,  // Waveforms don't change
    retry: 5,  // Retry up to 5 times for background generation
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),  // Exponential backoff: 1s, 2s, 4s, 8s, 10s
  });

  // Transform waveform data from number[] to Float32Array for WebGL
  // Memoize to prevent creating new objects on every render
  const data: WaveformDataWebGL | undefined = useMemo(() => {
    if (!waveformResponse) return undefined;

    return {
      low: new Float32Array(waveformResponse.data.bands.low),
      mid: new Float32Array(waveformResponse.data.bands.mid),
      high: new Float32Array(waveformResponse.data.bands.high),
      duration: waveformResponse.data.duration,
    };
  }, [waveformResponse]);

  return {
    data,
    rawData: waveformResponse?.data,
    isLoading,
    error,
  };
}
