import { api, API_BASE } from '../api/client';
import type { DeckEngine } from '../playback/DeckEngine';
import type { CaptureDeck } from '../capture/events';

/** Fresh normal-history source; peer audio never passes through bare-ID caches. */
export async function sessionReplaySource(
  uuid: string,
  engines: Record<CaptureDeck, DeckEngine>,
  loadLocal: (deck: CaptureDeck, trackId: number) => Promise<boolean>,
) {
  const detail = await api.sessions.get(uuid);
  const generation = detail.replay_generation;
  const validateSource = generation ? async () => {
    try { return (await api.sessions.get(uuid)).replay_generation === generation; }
    catch { return false; }
  } : undefined;
  const loadTrack = generation ? async (deck: CaptureDeck, trackId: number) => {
    if (!await validateSource!()) return false;
    try {
      const track = await api.tracks.getById(trackId);
      await engines[deck].load({
        trackId, bpm: track.bpm,
        audioUrl: `${API_BASE}/sessions/${uuid}/audio/${trackId}?generation=${encodeURIComponent(generation)}`,
        bypassCache: true,
      });
      return engines[deck].getSnapshot().loadState === 'ready' && await validateSource!();
    } catch { return false; }
  } : loadLocal;
  return { detail, loadTrack, validateSource };
}
