/**
 * Live deck occupancy (sets 35, shared): which track each Deck holds and
 * whether it plays, as engine-slice subscriptions. Extracted from
 * SetDetailPane so any track list can derive the loaded identity wash
 * (rowMarks.loadedDecks/loadedWash) from the same source of truth.
 *
 * Primitive selectors per useSyncExternalStore rules (a fresh object
 * every read would loop); the map itself is memoized on the slices, so
 * consumers re-render only on load / play / pause — not per tick.
 */
import { useMemo, useSyncExternalStore } from 'react';
import type { DeckContextValue } from './useDeck';
import type { DeckEngine, DeckSnapshot } from '../playback/DeckEngine';
import type { DeckOccupancyMap } from '../sets/rowMarks';
import type { ChannelId } from '../playback/mixer';

function useEngineSlice<T>(engine: DeckEngine, selector: (s: DeckSnapshot) => T): T {
  return useSyncExternalStore(
    (cb) => engine.subscribe(cb),
    () => selector(engine.getSnapshot())
  );
}

export function useDeckOccupancy(decks: Record<ChannelId, DeckContextValue>): DeckOccupancyMap {
  const aTrackId = useEngineSlice(decks.A.engine, (s) => s.trackId);
  const aPlaying = useEngineSlice(decks.A.engine, (s) => s.playing);
  const bTrackId = useEngineSlice(decks.B.engine, (s) => s.trackId);
  const bPlaying = useEngineSlice(decks.B.engine, (s) => s.playing);
  const cTrackId = useEngineSlice(decks.C.engine, (s) => s.trackId);
  const cPlaying = useEngineSlice(decks.C.engine, (s) => s.playing);
  const dTrackId = useEngineSlice(decks.D.engine, (s) => s.trackId);
  const dPlaying = useEngineSlice(decks.D.engine, (s) => s.playing);
  return useMemo(
    () => ({
      A: { trackId: aTrackId, playing: aPlaying },
      B: { trackId: bTrackId, playing: bPlaying },
      C: { trackId: cTrackId, playing: cPlaying },
      D: { trackId: dTrackId, playing: dPlaying },
    }),
    [aTrackId, aPlaying, bTrackId, bPlaying, cTrackId, cPlaying, dTrackId, dPlaying]
  );
}
