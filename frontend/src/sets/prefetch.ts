/**
 * Buffer prefetch (sets 14; stems #211): warm the decoded-audio cache for
 * an upcoming Set entry — fetch + decodeAudioData + cache — so the
 * Conductor's deck load at the handover is a near-instant cache hit (the
 * grace fade's 5s headroom is then almost always enough). Decodes on the
 * Mixer's AudioContext (AudioBuffers are context-portable; the cache says
 * so), deduplicated per track while in flight.
 *
 * Stems-aware: a track with current stems plays FROM its stems on the
 * deck (replace policy, #209), so prefetching the single file would leave
 * the handover paying 4 fetch+decodes anyway. When the caller doesn't
 * know `hasStems`, the track row is fetched to decide — one tiny API call
 * against ~100 MB of decode work.
 */
import { api } from '../api/client';
import {
  getCachedBuffer,
  getCachedStems,
  putCachedBuffer,
  putCachedStems,
} from '../playback/bufferCache';
import type { Mixer } from '../playback/mixer';
import { STEM_NAMES } from '../playback/mixer';

const inFlight = new Set<number>();

async function fetchDecode(mixer: Mixer, url: string): Promise<AudioBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`audio fetch failed: ${res.status}`);
  const bytes = await res.arrayBuffer();
  return mixer.audioContext().decodeAudioData(bytes);
}

export async function prefetchTrackBuffer(
  mixer: Mixer,
  trackId: number,
  hasStems?: boolean
): Promise<void> {
  if (inFlight.has(trackId)) return;
  inFlight.add(trackId);
  try {
    if (hasStems === undefined) {
      if (getCachedStems(trackId) || getCachedBuffer(trackId)) return;
      hasStems = (await api.tracks.getById(trackId)).has_stems ?? false;
    }
    if (hasStems) {
      if (getCachedStems(trackId)) return;
      const stems = await Promise.all(
        STEM_NAMES.map((stem) => fetchDecode(mixer, api.tracks.stemUrl(trackId, stem)))
      );
      putCachedStems(trackId, stems);
    } else {
      if (getCachedBuffer(trackId)) return;
      putCachedBuffer(trackId, await fetchDecode(mixer, api.tracks.audioUrl(trackId)));
    }
  } finally {
    inFlight.delete(trackId);
  }
}
