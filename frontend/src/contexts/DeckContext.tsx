import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { DeckEngine } from '../playback/DeckEngine';
import { DeckContext } from '../hooks/useDeck';
import { api } from '../api/client';
import type { BeatgridResponse, Track, WaveformResponse } from '../types';

/**
 * The one shared Deck (ADR 0008). Sits above the view switch, so the Deck
 * outlives any view: Library and Practice render the same engine, playback
 * survives view changes, and only one thing can ever play.
 *
 * Loading is explicit (glossary: Load) — views call loadTrack deliberately
 * (Enter / double-click); selection never loads. Loading also resolves the
 * Main cue (saved → first beat → engine-computed non-silence → 0) and wires
 * cue persistence: a cue the user sets is written back (CDJ memory-cue
 * behavior); defaults are not.
 *
 * Deck *state* is not part of the context value — consumers subscribe via
 * useDeckSnapshot so transport events only re-render components that care.
 */
export function DeckProvider({ children }: { children: ReactNode }) {
  const [engine] = useState(() => new DeckEngine());
  useEffect(() => () => engine.dispose(), [engine]);

  const queryClient = useQueryClient();
  const [loadedTrack, setLoadedTrack] = useState<Track | null>(null);

  const loadTrack = useCallback(
    (track: Track) => {
      setLoadedTrack(track);

      // Saved cue + first beat, fetched concurrently with the audio through
      // the same query cache the waveform/beatgrid components use (usually
      // already warm). The engine awaits this after decode; failures fall
      // through the cue-default precedence. Superseded loads are handled by
      // the engine's own abort.
      const cueDefaults = (async () => {
        const [wf, bg] = await Promise.allSettled([
          queryClient.fetchQuery<WaveformResponse>({
            queryKey: ['waveform', track.id],
            queryFn: () => api.waveforms.get(track.id),
            staleTime: Infinity,
            retry: false,
          }),
          queryClient.fetchQuery<BeatgridResponse>({
            queryKey: ['beatgrid', track.id],
            queryFn: () => api.beatgrids.get(track.id),
            staleTime: Infinity,
            retry: false,
          }),
        ]);
        return {
          savedCuePoint:
            wf.status === 'fulfilled' ? (wf.value.data.cue_point_time ?? null) : null,
          firstBeatTime:
            bg.status === 'fulfilled' ? (bg.value.data.beat_times[0] ?? null) : null,
        };
      })();

      void engine.load({
        trackId: track.id,
        audioUrl: api.tracks.audioUrl(track.id),
        bpm: track.bpm ?? null,
        cueDefaults,
      });
    },
    [engine, queryClient]
  );

  // Persist user-set cues (engine fires this only for deliberate cue sets,
  // never for load defaults, and reports its own loaded trackId) and keep
  // the cached waveform's cue in sync without refetching band data.
  useEffect(() => {
    engine.setCueSetHandler((trackId, timeSeconds) => {
      void api.waveforms.updateCuePoint(trackId, timeSeconds).then(() => {
        queryClient.setQueryData<WaveformResponse>(['waveform', trackId], (old) =>
          old ? { ...old, data: { ...old.data, cue_point_time: timeSeconds } } : old
        );
      });
    });
    return () => {
      engine.setCueSetHandler(null);
    };
  }, [engine, queryClient]);

  const value = useMemo(
    () => ({ engine, loadedTrack, loadTrack }),
    [engine, loadedTrack, loadTrack]
  );

  return <DeckContext.Provider value={value}>{children}</DeckContext.Provider>;
}
