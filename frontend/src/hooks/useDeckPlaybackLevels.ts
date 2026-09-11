import { useSyncExternalStore } from 'react';
import { deckMasterGain, isDeckSounding } from '../capture/audibility';
import { DEFAULT_DETECTOR_PARAMS } from '../capture/events';
import { CHANNEL_IDS } from '../playback/mixer';
import type { ChannelId } from '../playback/mixer';
import { masterValueToGain, trimToGain, TRIM_NEUTRAL } from '../playback/mixerMath';
import { useDecks } from './useDeck';
import { useMixer } from './useMixer';

/** Live output, not Session evidence: machine playback also has row indicators. */
export function useDeckPlaybackLevels(): Record<ChannelId, number> {
  const decks = useDecks();
  const mixer = useMixer();
  const levels = useSyncExternalStore(
    (notify) => {
      const unsubs = CHANNEL_IDS.map((ch) => decks[ch].engine.subscribe(notify));
      unsubs.push(mixer.subscribe(notify));
      // Automation writes bypass mixer subscribers. Poll only the four
      // levels; CSS animates the bars without React frame updates.
      const timer = setInterval(notify, 100);
      return () => {
        clearInterval(timer);
        for (const unsub of unsubs) unsub();
      };
    },
    () => CHANNEL_IDS.map((ch) => {
      const engine = decks[ch].engine;
      const state = mixer.getChannelState(ch);
      const auto = mixer.getAutomation(ch);
      const stems = auto?.stems ?? state.stems;
      if (engine.getSnapshot().stemsLoaded && !Object.values(stems).some(Boolean)) return 0;
      const inputs = {
        playing: engine.isAudioRunning(),
        fader: auto?.fader ?? state.fader,
        trim: auto?.trim ?? state.trim,
        eq: auto?.eq ?? state.eq,
        filter: auto?.filter ?? state.filter,
        assignment: mixer.getCrossfaderAssignment(ch),
      };
      const mix = {
        crossfader: mixer.getCrossfader(),
        crossfaderEnabled: mixer.getCrossfaderEnabled() && !mixer.isAutomationEngaged(),
      };
      if (!isDeckSounding(inputs, mix, DEFAULT_DETECTOR_PARAMS)) return 0;
      // Color follows fader travel, not its squared audio taper. Normalize
      // neutral trim to full color; boosts cannot saturate before full travel.
      const gain = deckMasterGain({ ...inputs, fader: 1 }, mix)
        * masterValueToGain(mixer.getMaster()) / trimToGain(TRIM_NEUTRAL);
      return Math.round(100 * Math.max(0, Math.min(1, inputs.fader)) * Math.min(1, gain));
    }).join(',')
  );
  // A primitive snapshot prevents external-store loops and limits updates
  // to whole percentage points. Rows receive only their own Deck levels.
  const values = levels.split(',').map(Number);
  return Object.fromEntries(CHANNEL_IDS.map((ch, i) => [ch, values[i]])) as Record<ChannelId, number>;
}
