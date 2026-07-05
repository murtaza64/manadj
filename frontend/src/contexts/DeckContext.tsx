import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { DeckEngine } from '../playback/DeckEngine';
import { Mixer } from '../playback/mixer';
import { CaptureRecorder } from '../capture/recorder';
import { persistTake } from '../capture/takeSink';
import type { ChannelId } from '../playback/mixer';
import { isAudible, registerSurface, unregisterSurface } from '../playback/audibleSurface';
import { deckControlsFor } from '../midi/controlRegistry';
import { BEATJUMP_DEFAULT, clampBeatjump } from '../playback/beatjump';
import { DeckContext, DeckRegistryContext } from '../hooks/useDeck';
import type { DeckContextValue } from '../hooks/useDeck';
import { MixerContext } from '../hooks/useMixer';
import { api } from '../api/client';
import { initFollowPlaybackBridge } from '../follow/followPlaybackBridge';
import { initWakeLockBridge } from '../playback/wakeLock';
import { getKeyLockFlags } from '../playback/keyLockStore';
import type { BeatgridResponse, Track } from '../types';

const DECK_IDS = ['A', 'B'] as const;

/** Loaded-pair persistence: `{"A": trackId|null, "B": trackId|null}`. */
const LOADED_TRACKS_KEY = 'manadj-loaded-tracks';

function readStoredLoadedIds(): Record<ChannelId, number | null> {
  try {
    const raw = localStorage.getItem(LOADED_TRACKS_KEY);
    if (!raw) return { A: null, B: null };
    const parsed = JSON.parse(raw) as Partial<Record<ChannelId, unknown>>;
    return {
      A: typeof parsed.A === 'number' ? parsed.A : null,
      B: typeof parsed.B === 'number' ? parsed.B : null,
    };
  } catch {
    return { A: null, B: null };
  }
}

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
    // The shared surface's ports answer the arbiter tripwire (ADR 0013):
    // start gestures are refused while another surface (the editor) holds
    // audibility, so nothing can resume the suspended shared clock.
    const m = new Mixer(() => isAudible('shared'));
    const engineA = new DeckEngine(m.portFor('A'));
    const engineB = new DeckEngine(m.portFor('B'));
    // Key Lock boot restore (key-lock 03): sticky per Deck, default ON.
    // Only the shared Decks — the editor's private engines stay varispeed.
    const keyLock = getKeyLockFlags();
    engineA.setKeyLock(keyLock.A);
    engineB.setKeyLock(keyLock.B);
    return {
      mixer: m,
      engines: { A: engineA, B: engineB } as Record<ChannelId, DeckEngine>,
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

  // Follow rides playback (follow-mode 02): deck play/pause transitions
  // feed the Follow state machine (spread/drop/sticky rules live in the
  // reducer, not here).
  useEffect(() => initFollowPlaybackBridge(engines), [engines]);

  // Screen wake lock (screen-wake 01): the display must not dim while a
  // Deck plays.
  useEffect(() => initWakeLockBridge(engines), [engines]);
  // Always-on capture (transition-takes 02, ADR 0020): the recorder taps
  // this surface's Mixer + decks, the pure detector finds Handovers, and
  // settled Takes persist to the Transition history. Lives here because
  // the provider owns the shared surface and outlives every view switch.
  useEffect(() => {
    const recorder = new CaptureRecorder(mixer, engines, persistTake);
    recorder.start();
    return () => recorder.dispose();
  }, [engines, mixer]);
  // Dev-only audio routing tracer (headphone-cue 01): console helpers for
  // sink switching + the cue bridge. Lazy import keeps it out of prod.
  useEffect(() => {
    if (import.meta.env.DEV) {
      void import('../dev/audioRoutingTracer').then((m) =>
        m.installAudioRoutingTracer(mixer)
      );
    }
  }, [mixer]);

  const queryClient = useQueryClient();
  const [loadedTracks, setLoadedTracks] = useState<Record<ChannelId, Track | null>>({
    A: null,
    B: null,
  });
  const [beatjumps, setBeatjumps] = useState<Record<ChannelId, number>>({
    A: BEATJUMP_DEFAULT,
    B: BEATJUMP_DEFAULT,
  });

  const loadTrackOnto = useCallback(
    (deck: ChannelId, track: Track) => {
      setLoadedTracks((prev) => ({ ...prev, [deck]: track }));

      // Saved cue comes with the Track row itself (the Main cue lives on the
      // Track); the first beat is fetched through the same query cache the
      // beatgrid components use (usually already warm). The engine awaits
      // this after decode; failures fall through the cue-default precedence.
      const cueDefaults = (async () => {
        const bg = await Promise.allSettled([
          queryClient.fetchQuery<BeatgridResponse>({
            queryKey: ['beatgrid', track.id],
            queryFn: () => api.beatgrids.get(track.id),
            staleTime: Infinity,
            retry: false,
          }),
        ]).then(([r]) => r);
        return {
          savedCuePoint: track.cue_point_time ?? null,
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

  // ── Loaded-pair persistence ────────────────────────────────────────────
  // The shared decks are the canonical "what's loaded on A/B" across every
  // mode (the Transition editor mirrors its loads onto them). Persist track
  // ids on every Load; restore once on boot (a Load allocates audio memory
  // but nothing plays until the user does).
  const loadedTracksRef = useRef(loadedTracks);
  useEffect(() => {
    loadedTracksRef.current = loadedTracks;
  });

  const restoreStarted = useRef(false);
  useEffect(() => {
    if (restoreStarted.current) return; // StrictMode re-run guard
    restoreStarted.current = true;
    const stored = readStoredLoadedIds();
    for (const deck of DECK_IDS) {
      const id = stored[deck];
      if (id === null) continue;
      api.tracks
        .getById(id)
        .then((track: Track) => {
          // A user/editor Load may have landed while we fetched — it wins.
          if (loadedTracksRef.current[deck] === null) loadTrackOnto(deck, track);
        })
        .catch(() => undefined); // stale id (deleted track) — drop silently
    }
  }, [loadTrackOnto]);

  // Never write the initial all-null state: on boot it would clobber the
  // stored pair before the async restore lands. There is no unload gesture,
  // so an all-null write is only ever that boot state.
  useEffect(() => {
    if (loadedTracks.A === null && loadedTracks.B === null) return;
    localStorage.setItem(
      LOADED_TRACKS_KEY,
      JSON.stringify({ A: loadedTracks.A?.id ?? null, B: loadedTracks.B?.id ?? null })
    );
  }, [loadedTracks]);

  // Persist user-set cues (an engine fires this only for deliberate cue
  // sets, never for load defaults, and reports its own loaded trackId) and
  // keep the loaded Track objects' cue in sync.
  useEffect(() => {
    for (const deck of DECK_IDS) {
      engines[deck].setCueSetHandler((trackId, timeSeconds) => {
        void api.waveforms.updateCuePoint(trackId, timeSeconds);
        setLoadedTracks((prev) => {
          const next = { ...prev };
          for (const d of DECK_IDS) {
            const t = next[d];
            if (t && t.id === trackId) next[d] = { ...t, cue_point_time: timeSeconds };
          }
          return next;
        });
      });
    }
    return () => {
      for (const deck of DECK_IDS) engines[deck].setCueSetHandler(null);
    };
  }, [engines]);

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

  // Register the 'shared' audible surface (ADR 0013) — the permanent
  // default the arbiter falls back to. Transport carries the same readiness
  // guards MIDI dispatch used to apply inline (loading decks may latch
  // play, like Space; cue needs decoded audio of the loaded Track, like F).
  // The registry's identity changes on every Load, so transport reads it
  // through a ref and registration runs once.
  //
  // Gesture-class sections (ADR 0019) delegate to the exact deck behavior
  // hardware has today — the React-owned handlers MidiControlRegistrar
  // registers into the control registry (hot-cue curation is React Query,
  // so it cannot live here directly).
  const registryRef = useRef(registry);
  useEffect(() => {
    registryRef.current = registry;
  });
  useEffect(() => {
    registerSurface('shared', {
      transport: {
        togglePlay: (deck) => {
          const d = registryRef.current[deck];
          const { loadState } = d.engine.getSnapshot();
          if (loadState !== 'ready' && loadState !== 'fetching' && loadState !== 'decoding') return;
          d.engine.togglePlay();
        },
        cueDown: (deck) => {
          const d = registryRef.current[deck];
          if (deckReadyNow(d)) d.engine.cueDown();
        },
        cueUp: (deck) => {
          const d = registryRef.current[deck];
          if (deckReadyNow(d)) d.engine.cueUp();
        },
      },
      pads: {
        hotCueDown: (deck, pad) => deckControlsFor(deck)?.hotCueDown(pad),
        hotCueUp: (deck, pad) => deckControlsFor(deck)?.hotCueUp(pad),
        hotCueClear: (deck, pad) => deckControlsFor(deck)?.hotCueClear(pad),
      },
      jumps: {
        beatjump: (deck, direction) => deckControlsFor(deck)?.beatjump(direction),
      },
      jog: {
        rimTicks: (deck, ticks) => deckControlsFor(deck)?.jogTicks(ticks),
        touchTicks: (deck, ticks) => deckControlsFor(deck)?.jogTouchTicks(ticks),
        shiftRimTicks: (deck, ticks) => deckControlsFor(deck)?.jogSeekTicks(ticks),
      },
      silence: () => {
        engines.A.pause();
        engines.B.pause();
        mixer.suspend();
      },
      wake: () => mixer.resume(),
    });
    return () => unregisterSurface('shared');
  }, [engines, mixer]);

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

/** Same predicate as useDeckSnapshot's useDeckReady, sans subscription. */
function deckReadyNow(deck: DeckContextValue): boolean {
  const id = deck.loadedTrack?.id ?? null;
  const snapshot = deck.engine.getSnapshot();
  return id !== null && snapshot.loadState === 'ready' && snapshot.trackId === id;
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
