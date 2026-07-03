import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { DeckEngine } from '../playback/DeckEngine';
import { DeckContext } from '../hooks/useDeck';
import { api } from '../api/client';
import type { Track } from '../types';

/**
 * The one shared Deck (ADR 0008). Sits above the view switch, so the Deck
 * outlives any view: Library and Practice render the same engine, playback
 * survives view changes, and only one thing can ever play.
 *
 * Loading is explicit (glossary: Load) — views call loadTrack deliberately
 * (Enter / double-click); selection never loads.
 *
 * Deck *state* is not part of the context value — consumers subscribe via
 * useDeckSnapshot so transport events only re-render components that care.
 */
export function DeckProvider({ children }: { children: ReactNode }) {
  const [engine] = useState(() => new DeckEngine());
  useEffect(() => () => engine.dispose(), [engine]);

  const [loadedTrack, setLoadedTrack] = useState<Track | null>(null);

  const loadTrack = useCallback(
    (track: Track) => {
      setLoadedTrack(track);
      void engine.load({
        trackId: track.id,
        audioUrl: api.tracks.audioUrl(track.id),
        bpm: track.bpm ?? null,
      });
    },
    [engine]
  );

  const value = useMemo(
    () => ({ engine, loadedTrack, loadTrack }),
    [engine, loadedTrack, loadTrack]
  );

  return <DeckContext.Provider value={value}>{children}</DeckContext.Provider>;
}
