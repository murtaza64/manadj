import { createContext, useCallback, useContext, useSyncExternalStore } from 'react';
import type { Mixer } from '../playback/mixer';

/**
 * The one Mixer (ADR 0009), provided app-wide by DeckProvider. The instance
 * itself is the interface: channel strip controls (setTrim/setEq/setFilter/
 * setFader per channel), crossfader, and master, with control state readable
 * via its getters. Mixer state is not React state — controls mutate through
 * setters and subscribe to repaints via useMixerValue (hardware moves are an
 * external source of mixer changes: midi-controller 09).
 */
export const MixerContext = createContext<Mixer | undefined>(undefined);

export function useMixer(): Mixer {
  const mixer = useContext(MixerContext);
  if (!mixer) throw new Error('useMixer must be used within DeckProvider');
  return mixer;
}

/**
 * Subscribe to a slice of mixer control state. Select primitives (or the
 * per-channel state object, which is replaced immutably) so Object.is
 * equality insulates the component from unrelated mixer changes.
 */
export function useMixerValue<T>(selector: (mixer: Mixer) => T): T {
  const mixer = useMixer();
  return useSyncExternalStore(
    useCallback((cb) => mixer.subscribe(cb), [mixer]),
    () => selector(mixer)
  );
}
