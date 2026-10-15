import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { decodeChordLoops, type ChordLoops } from './chordMatch';

/** The library's chord loops (chord-match #388); undefined while loading
 * or on error — the Chord match term is then neutral everywhere. */
export function useChordLoops(): ChordLoops | undefined {
  const { data } = useQuery({
    queryKey: ['harmony', 'loops'],
    queryFn: async () => decodeChordLoops(await api.harmony.loops()),
    staleTime: 5 * 60_000,
  });
  return data;
}
