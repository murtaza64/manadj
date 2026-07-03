import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { DeckEngine } from '../playback/DeckEngine';
import { Mixer } from '../playback/mixer';
import type { ChannelId } from '../playback/mixer';
import { PERFORMANCE_BEATJUMP_DEFAULT, clampBeatjump } from '../playback/beatjump';
import { DeckContext, DeckRegistryContext } from '../hooks/useDeck';
import type { DeckContextValue } from '../hooks/useDeck';
import { MixerContext } from '../hooks/useMixer';
import { api } from '../api/client';
import type { BeatgridResponse, Track, WaveformResponse } from '../types';

const DECK_IDS = ['A', 'B'] as const;

/**
 * Both Decks and the Mixer (ADRs 0008/0009). Sits above the view switch, so
 * they outlive any view: a mix keeps playing while you flip to the library.
 * The Mixer owns the one AudioContext; each deck is one of its channel
 * inputs (graph nodes only — no audio memory until Load).
 *
 * Components address a deck through <DeckScope deck="A|B"> — the provider
 * itself only publishes the registry (both decks) and the Mixer.
 *
 * Loading is explicit (glossary: Load) — views call loadTrack deliberately
 * (Enter / double-click); selection never loads. Loading also resolves the
 * Main cue (saved → first beat → engine-computed non-silence → 0) and wires
 * cue persistence: a cue the user sets is written back (CDJ memory-cue
 * behavior); defaults are not.
 *
 * Deck *state* is not part of any context value — consumers subscribe via
 * useDeckSnapshot so transport events only re-render components that care.
 */
export function DeckProvider({ children }: { children: ReactNode }) {
  const [{ mixer, engines }] = useState(() => {
    const m = new Mixer();
    return {
      mixer: m,
      engines: {
        A: new DeckEngine(m.portFor('A')),
        B: new DeckEngine(m.portFor('B')),
      } as Record<ChannelId, DeckEngine>,
    };
  });
  useEffect(
    () => () => {
      // Decks stop against the still-open context, then the Mixer closes it.
      engines.A.dispose();
      engines.B.dispose();
      mixer.dispose();
    },
    [engines, mixer]
  );

  const queryClient = useQueryClient();
  const [loadedTracks, setLoadedTracks] = useState<Record<ChannelId, Track | null>>({
    A: null,
    B: null,
  });
  const [beatjumps, setBeatjumps] = useState<Record<ChannelId, number>>({
    A: PERFORMANCE_BEATJUMP_DEFAULT,
    B: PERFORMANCE_BEATJUMP_DEFAULT,
  });

  const loadTrackOnto = useCallback(
    (deck: ChannelId, track: Track) => {
      setLoadedTracks((prev) => ({ ...prev, [deck]: track }));

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

      void engines[deck].load({
        trackId: track.id,
        audioUrl: api.tracks.audioUrl(track.id),
        bpm: track.bpm ?? null,
        cueDefaults,
      });
    },
    [engines, queryClient]
  );

  // Persist user-set cues (an engine fires this only for deliberate cue
  // sets, never for load defaults, and reports its own loaded trackId) and
  // keep the cached waveform's cue in sync without refetching band data.
  useEffect(() => {
    for (const deck of DECK_IDS) {
      engines[deck].setCueSetHandler((trackId, timeSeconds) => {
        void api.waveforms.updateCuePoint(trackId, timeSeconds).then(() => {
          queryClient.setQueryData<WaveformResponse>(['waveform', trackId], (old) =>
            old ? { ...old, data: { ...old.data, cue_point_time: timeSeconds } } : old
          );
        });
      });
    }
    return () => {
      for (const deck of DECK_IDS) engines[deck].setCueSetHandler(null);
    };
  }, [engines, queryClient]);

  // Per-deck loadTrack functions stay identity-stable across state changes
  // (memoized rows key their re-renders on them).
  const loadTrackA = useCallback((t: Track) => loadTrackOnto('A', t), [loadTrackOnto]);
  const loadTrackB = useCallback((t: Track) => loadTrackOnto('B', t), [loadTrackOnto]);

  // Each scope value is memoized on its own deck's slice, so a Load or
  // beatjump change on A never re-renders B's subtree (and vice versa).
  const makeScope = useCallback(
    (
      deck: ChannelId,
      loadedTrack: Track | null,
      beatjumpBeats: number
    ): DeckContextValue => ({
      deck,
      engine: engines[deck],
      loadedTrack,
      loadTrack: deck === 'A' ? loadTrackA : loadTrackB,
      beatjumpBeats,
      setBeatjumpBeats: (beats) =>
        setBeatjumps((prev) => ({ ...prev, [deck]: clampBeatjump(beats) })),
    }),
    [engines, loadTrackA, loadTrackB]
  );
  const scopeA = useMemo(
    () => makeScope('A', loadedTracks.A, beatjumps.A),
    [makeScope, loadedTracks.A, beatjumps.A]
  );
  const scopeB = useMemo(
    () => makeScope('B', loadedTracks.B, beatjumps.B),
    [makeScope, loadedTracks.B, beatjumps.B]
  );
  const registry = useMemo<Record<ChannelId, DeckContextValue>>(
    () => ({ A: scopeA, B: scopeB }),
    [scopeA, scopeB]
  );

  // Throwaway dev handle (performance-mode issue 02): deck B has no UI until
  // issue 03, so it is verified from the console, e.g.
  //   __manadj.loadTrackById('B', 42).then(() => __manadj.engines.B.play())
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const handle = {
      mixer,
      engines,
      loadTrackById: async (deck: ChannelId, id: number) => {
        loadTrackOnto(deck, await api.tracks.getById(id));
      },
    };
    const devGlobals = window as unknown as Record<string, unknown>;
    devGlobals.__manadj = handle;
    return () => {
      delete devGlobals.__manadj;
    };
  }, [mixer, engines, loadTrackOnto]);

  return (
    <MixerContext.Provider value={mixer}>
      <DeckRegistryContext.Provider value={registry}>
        {children}
      </DeckRegistryContext.Provider>
    </MixerContext.Provider>
  );
}

/**
 * Address a Deck: everything below reads this deck through the deck-blind
 * hooks (useDeck, useDeckSnapshot, useDeckReady, useHotCueActions). The
 * library view wraps its whole tree in scope A; the Performance view mounts
 * one scope per panel.
 */
export function DeckScope({ deck, children }: { deck: ChannelId; children: ReactNode }) {
  const registry = useContext(DeckRegistryContext);
  if (!registry) throw new Error('DeckScope must be used within DeckProvider');
  return <DeckContext.Provider value={registry[deck]}>{children}</DeckContext.Provider>;
}
