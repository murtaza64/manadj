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
  if (detail.group_history?.length) throw new Error('Group Session evidence is not playable');
  const generation = detail.replay_generation;
  const loaded: Partial<Record<CaptureDeck, string>> = {};
  const validateSource = async () => {
    try {
      const current = await api.sessions.get(uuid);
      return !current.group_history?.length && current.replay_generation === generation && Object.entries(loaded).every(([deck, key]) =>
        engines[deck as CaptureDeck].getSnapshot().audioSourceKey === key);
    }
    catch { return false; }
  };
  const loadTrack = generation ? async (deck: CaptureDeck, trackId: number) => {
    if (!await validateSource!()) return false;
    try {
      const track = await api.tracks.getById(trackId);
      const audioSourceKey = `${uuid}:${generation}:${trackId}`;
      delete loaded[deck]; // This deck's own asynchronous replacement is not the old source.
      await engines[deck].load({
        trackId, bpm: track.bpm,
        audioUrl: `${API_BASE}/sessions/${uuid}/audio/${trackId}?generation=${encodeURIComponent(generation)}`,
        bypassCache: true,
        audioSourceKey,
      });
      loaded[deck] = audioSourceKey;
      return engines[deck].getSnapshot().loadState === 'ready' && await validateSource!();
    } catch { return false; }
  } : async (deck: CaptureDeck, trackId: number) => await validateSource() && loadLocal(deck, trackId);
  return { detail, loadTrack, validateSource };
}
