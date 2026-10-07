import { browseSession } from '../components/browseStore';
import { getSelectedSetId, getSetSelection } from '../sets/setStore';
import { getConductorState } from '../sets/conductorStore';
import { getSelectedSessionUuid } from '../sessions/openSession';
import { replayState, replayNowT } from '../sessions/replayStore';
import { audibleHolder } from '../playback/audibleSurface';
import type { Readers } from './diagnostics';
import type { DeckContextValue } from '../hooks/useDeck';
import type { ChannelId, Mixer } from '../playback/mixer';
import type { FilterState } from '../contexts/FilterContext';

export function appReaders(view: string, decks: Record<ChannelId, DeckContextValue>, mixer: Mixer, filters: FilterState): Readers {
  return {
    view: () => view,
    browse: () => {
      const b = browseSession();
      return { view: b.view, playlist_id: b.playlistId, focused_area: b.focusedArea,
        split_view: b.splitViewOpen, selected_ids: b.mainSelection.ids.slice(0, 32), anchor_id: b.mainSelection.anchorId };
    },
    filters: () => ({
      // Search contents are free text, not needed to diagnose filter state.
      search_length: filters.search.length, tag_ids: filters.selectedTagIds.slice(0, 32),
      energy_min: filters.energyMin, energy_max: filters.energyMax, tag_match_mode: filters.tagMatchMode,
      bpm_center: filters.bpmCenter, bpm_threshold_percent: filters.bpmThresholdPercent,
      keys: filters.selectedKeyCamelotIds.slice(0, 32), sort_column: filters.sortColumn, sort_direction: filters.sortDirection,
    }),
    decks: () => (['A', 'B', 'C', 'D'] as const).map((id) => {
      const { engine } = decks[id];
      const s = engine.getSnapshot();
      return { id, track_id: s.trackId, load_state: s.loadState, load_error: s.loadError,
        playing: s.playing, pending_play: s.pendingPlay, previewing: s.previewing,
        playhead: engine.getPlayhead(), duration: s.duration, bpm: s.bpm,
        pitch_percent: s.pitchPercent, key_lock: s.keyLock, slip: s.slipMode,
        loop: s.loop ? { start: s.loop.start, end: s.loop.end } : null };
    }),
    mixer: () => ({ master: mixer.getMaster(), crossfader: mixer.getCrossfader(),
      crossfader_enabled: mixer.getCrossfaderEnabled(), cue_level: mixer.getCueLevel(), cue_mix: mixer.getCueMix(),
      channels: (['A', 'B', 'C', 'D'] as const).map((id) => {
        const s = mixer.getChannelState(id);
        const a = mixer.getAutomation(id);
        return { id, fader: s.fader, trim: s.trim, filter: s.filter, pfl: s.pfl,
          eq: { low: s.eq.low, mid: s.eq.mid, high: s.eq.high },
          crossfader_assignment: mixer.getCrossfaderAssignment(id),
          automation: a ? { fader: a.fader, filter: a.filter, trim: a.trim ?? null,
            eq: { low: a.eq.low, mid: a.eq.mid, high: a.eq.high } } : null };
      }),
    }),
    set: () => {
      const id = getSelectedSetId();
      const selection = id === null ? null : getSetSelection(id);
      const c = getConductorState();
      return { selected_id: id, selected_track_ids: selection?.ids.slice(0, 32) ?? [], anchor_id: selection?.anchorId ?? null,
        conducting_id: c.setId, status: c.status, active_entry_index: c.activeEntryIndex, follow: c.follow };
    },
    session: () => {
      const r = replayState();
      return { selected_uuid: getSelectedSessionUuid(), replay_uuid: r.sessionUuid, replay_status: r.status,
        replay_start: r.startT, replay_time: replayNowT() };
    },
    audible_surface: audibleHolder,
  };
}
