import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from 'react';
import type { AutomationChannelValues, ChannelId, Mixer } from '../playback/mixer';

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

function sameAutomation(
  a: AutomationChannelValues | null,
  b: AutomationChannelValues | null
): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.fader === b.fader &&
    a.filter === b.filter &&
    a.eq.low === b.eq.low &&
    a.eq.mid === b.eq.mid &&
    a.eq.high === b.eq.high
  );
}

/**
 * The channel's live automation values for ghost indicators (sets 15), or
 * null while no overlay is engaged / nothing is written. rAF-polled like
 * the waveform playheads — the Mixer's automation write path never
 * notifies subscribers (ADR 0022), so this is the ONE sanctioned way for
 * the view to see automation. Value-gated: re-renders only while the
 * automation is actually moving. Read-only — gestures keep going through
 * the base-state setters.
 */
export function useAutomationGhost(channel: ChannelId): AutomationChannelValues | null {
  const mixer = useMixer();
  const [ghost, setGhost] = useState<AutomationChannelValues | null>(null);
  useEffect(() => {
    let raf = 0;
    let last: AutomationChannelValues | null = null;
    const tick = () => {
      const next = mixer.getAutomation(channel);
      if (!sameAutomation(last, next)) {
        // Snapshot: the conductor replaces the stored object per tick, but
        // a copy keeps us honest if a writer ever mutates in place.
        last = next && { fader: next.fader, filter: next.filter, eq: { ...next.eq } };
        setGhost(last);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [mixer, channel]);
  return ghost;
}
