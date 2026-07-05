/**
 * Buffer prefetch (sets 14): warm the decoded-audio cache for an
 * upcoming Set entry — fetch + decodeAudioData + putCachedBuffer — so
 * the Conductor's deck load at the handover is a near-instant cache hit
 * (the grace fade's 5s headroom is then almost always enough). Decodes
 * on the Mixer's AudioContext (AudioBuffers are context-portable; the
 * cache says so), deduplicated per track while in flight.
 */
import { api } from '../api/client';
import { getCachedBuffer, putCachedBuffer } from '../playback/bufferCache';
import type { Mixer } from '../playback/mixer';

const inFlight = new Set<number>();

export async function prefetchTrackBuffer(mixer: Mixer, trackId: number): Promise<void> {
  if (getCachedBuffer(trackId) || inFlight.has(trackId)) return;
  inFlight.add(trackId);
  try {
    const res = await fetch(api.tracks.audioUrl(trackId));
    if (!res.ok) throw new Error(`audio fetch failed: ${res.status}`);
    const bytes = await res.arrayBuffer();
    const buffer = await mixer.audioContext().decodeAudioData(bytes);
    putCachedBuffer(trackId, buffer);
  } finally {
    inFlight.delete(trackId);
  }
}
