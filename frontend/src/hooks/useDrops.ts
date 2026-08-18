import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

export interface DropHypothesis {
  time: number; // seconds, on a downbeat
  strength: number; // detector score, min-max normalized to [0, 1]
}

interface DropsResponse {
  track_id: number;
  drops: DropHypothesis[];
}

/**
 * Possible-drop hypotheses for a track (structure-analysis 02).
 *
 * An analysis opinion derived from the waveform blob + beatgrid. The caller
 * gates with `ready` (blob + grid both present) so the fetch fires once the
 * inputs exist — no arrival polling of our own; the backend answers empty
 * drops (200) rather than erroring if an input vanishes meanwhile. Grid
 * mutations invalidate ['drops', id] explicitly (useBeatgridData), so edits
 * move the lines.
 */
export function useDrops(trackId: number | null, ready: boolean) {
  const { data } = useQuery<DropsResponse>({
    queryKey: ['drops', trackId],
    queryFn: () => api.drops.get(trackId!) as Promise<DropsResponse>,
    enabled: trackId !== null && ready,
    staleTime: Infinity,
  });
  return { drops: data?.drops ?? [] };
}
