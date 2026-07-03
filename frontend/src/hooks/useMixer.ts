import { createContext, useContext } from 'react';
import type { Mixer } from '../playback/mixer';

/**
 * The one Mixer (ADR 0009), provided app-wide by DeckProvider. The instance
 * itself is the interface: channel strip controls (setTrim/setEq/setFilter/
 * setFader per channel), crossfader, and master, with control state readable
 * via its getters. Mixer state is not React state — knobs/faders mutate
 * through setters and read initial positions from the getters (there is no
 * external source of mixer changes to subscribe to).
 */
export const MixerContext = createContext<Mixer | undefined>(undefined);

export function useMixer(): Mixer {
  const mixer = useContext(MixerContext);
  if (!mixer) throw new Error('useMixer must be used within DeckProvider');
  return mixer;
}
