/**
 * Per-deck stem waveforms (stems #213).
 *
 * Fetches the 4 per-stem MWF1 blobs (lazily generated server-side beside
 * the stems), pads each to the mix blob's exact counts (the renderer's
 * per-stem texture sets share one LOD structure with the mix), and packs
 * them once per Load. Compositing happens GPU-side against a per-column
 * mask texture — stem toggles never touch this data, so they cost nothing
 * here (the smoothness contract).
 *
 * Null until everything (mix blob + 4 stems) is decoded — the components
 * render the plain mix until then.
 */
import { useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api } from '../api/client';
import { STEM_NAMES } from '../playback/mixer';
import type { StemName } from '../playback/mixer';
import { packWaveformArrays, padParsedWaveform, parseWaveformArrays } from './blob';
import type { DecodedWaveform, ParsedWaveformArrays } from './blob';
import { useWaveformBlob } from './useWaveformBlob';

async function fetchStemWaveform(trackId: number, stem: StemName): Promise<ParsedWaveformArrays> {
  const res = await fetch(`${api.tracks.stemUrl(trackId, stem)}/waveform`);
  if (!res.ok) throw new Error(`stem waveform fetch failed: ${res.status}`);
  return parseWaveformArrays(await res.arrayBuffer());
}

export function useStemWaveforms(
  trackId: number | null,
  enabled: boolean
): DecodedWaveform[] | null {
  const wanted = enabled && trackId !== null;
  const results = useQueries({
    queries: STEM_NAMES.map((stem) => ({
      queryKey: ['waveform-blob-stem', trackId, stem],
      queryFn: () => fetchStemWaveform(trackId!, stem),
      enabled: wanted,
      staleTime: Infinity,
      retry: 1,
    })),
  });
  const allLoaded = results.every((r) => r.data !== undefined);
  const { data: mixBlob } = useWaveformBlob(wanted ? trackId : null);
  return useMemo(() => {
    if (!wanted || !allLoaded || !mixBlob) return null;
    const target = {
      peakCount: mixBlob.header.peakCount,
      bandCount: mixBlob.header.bandCount,
    };
    return results.map((r) => packWaveformArrays(padParsedWaveform(r.data!, target)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, allLoaded, mixBlob, trackId]);
}
