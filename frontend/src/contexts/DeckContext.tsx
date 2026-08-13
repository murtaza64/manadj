import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { DeckEngine } from '../playback/DeckEngine';
import { CHANNEL_IDS, Mixer } from '../playback/mixer';
import { CaptureRecorder } from '../capture/recorder';
import { persistTake } from '../capture/takeSink';
import { SessionSink } from '../capture/sessionSink';
import type { ChannelId } from '../playback/mixer';
import { registerSurface, unregisterSurface } from '../playback/audibleSurface';
import { deckControlsFor } from '../midi/controlRegistry';
import { BEATJUMP_DEFAULT, clampBeatjump } from '../playback/beatjump';
import { DeckContext, DeckRegistryContext } from '../hooks/useDeck';
import type { DeckContextValue } from '../hooks/useDeck';
import { useDeckBeatgridSync } from '../hooks/useDeckBeatgridSync';
import { useDeckBpmSync } from '../hooks/useDeckBpmSync';
import { RemountStableResource } from '../utils/remountStableResource';
import { MixerContext } from '../hooks/useMixer';
import { api } from '../api/client';
import { initFollowPlaybackBridge } from '../follow/followPlaybackBridge';
import { initWakeLockBridge } from '../playback/wakeLock';
import { getKeyLockFlags } from '../playback/keyLockStore';
import type { BeatgridResponse, Track } from '../types';

/** Loaded-Deck persistence: one Track id (or null) per fixed Deck. */
const LOADED_TRACKS_KEY = 'manadj-loaded-tracks';

function readStoredLoadedIds(): Record<ChannelId, number | null> {
  try {
    const raw = localStorage.getItem(LOADED_TRACKS_KEY);
    if (!raw) return { A: null, B: null, C: null, D: null };
    const parsed = JSON.parse(raw) as Partial<Record<ChannelId, unknown>>;
    return {
      A: typeof parsed.A === 'number' ? parsed.A : null,
      B: typeof parsed.B === 'number' ? parsed.B : null,
      C: typeof parsed.C === 'number' ? parsed.C : null,
      D: typeof parsed.D === 'number' ? parsed.D : null,
    };
  } catch {
    return { A: null, B: null, C: null, D: null };
  }
}

/**
 * All Decks and the Mixer (ADRs 0008/0009). Sits above the view switch, so
 * they outlive any view: a mix keeps playing while you flip to the library.
 * The Mixer owns the one AudioContext; each deck is one of its channel
 * inputs (graph nodes only — no audio memory until Load).
 *
 * Components address a deck through <DeckScope deck="A|B|C|D"> — the
 * provider itself only publishes the registry and the Mixer.
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
    // THE Mixer and THE Decks (ADRs 0008/0009/0022): every surface —
    // Performance, library, and the Transition editor's conductor — plays
    // through these. There is no other Mixer instance in the app.
    const m = new Mixer();
    const created = Object.fromEntries(
      CHANNEL_IDS.map((deck) => [deck, new DeckEngine(m.portFor(deck))])
    ) as Record<ChannelId, DeckEngine>;
    // Key Lock boot restore (key-lock 03): sticky per Deck, default ON.
    // The editor plays through it too (ADR 0022 — carve-out retired).
    const keyLock = getKeyLockFlags();
    for (const deck of CHANNEL_IDS) created[deck].setKeyLock(keyLock[deck]);
    return {
      mixer: m,
      engines: created,
    };
  });
  useEffect(
    () => () => {
      // Decks stop against the still-open context, then the Mixer closes it.
      for (const deck of CHANNEL_IDS) engines[deck].dispose();
      mixer.dispose();
    },
    [engines, mixer]
  );

  // Cross-deck quantized launch (cue-quantize-bpm 04): each deck's paused
  // launch (Play, Cue-hold, Hot-cue-hold) references another live Deck's
  // phase. Stable Deck order is the interim choice until multi-Deck MATCH
  // and reference selection land in issue 04.
  useEffect(() => {
    for (const deck of CHANNEL_IDS) {
      engines[deck].setLaunchReferenceProvider(() => {
        for (const candidate of CHANNEL_IDS) {
          if (candidate === deck) continue;
          const reference = engines[candidate].asLaunchReference();
          if (reference) return reference;
        }
        return null;
      });
    }
    return () => {
      for (const deck of CHANNEL_IDS) engines[deck].setLaunchReferenceProvider(null);
    };
  }, [engines]);

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
  //
  // A recorder lifetime is one Session (Sessions PRD, ADR 0033): the sink
  // streams the whole event log to the backend as ~5s chunks and stamps
  // every detected Take with the Session's uuid. page-hide flushes the tail
  // so a kill costs seconds, not the Session.
  const [capture] = useState(
    () =>
      new RemountStableResource(
        () => {
          const sink = new SessionSink();
          sink.start();
          const recorder = new CaptureRecorder(
            mixer,
            engines,
            (take) => persistTake(take, sink.currentSessionUuid),
            (event, activatesSession) => sink.record(event, activatesSession)
          );
          recorder.start();
          const onHide = () => {
            if (document.visibilityState === 'hidden') sink.flush();
          };
          document.addEventListener('visibilitychange', onHide);
          return () => {
            document.removeEventListener('visibilitychange', onHide);
            recorder.dispose();
            sink.stop();
          };
        },
        (stop) => stop()
      )
  );
  useEffect(() => {
    capture.mount();
    return () => capture.unmount();
  }, [capture]);
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
    C: null,
    D: null,
  });
  const [beatjumps, setBeatjumps] = useState<Record<ChannelId, number>>({
    A: BEATJUMP_DEFAULT,
    B: BEATJUMP_DEFAULT,
    C: BEATJUMP_DEFAULT,
    D: BEATJUMP_DEFAULT,
  });

  const loadTrackOnto = useCallback(
    (deck: ChannelId, track: Track) => {
      setLoadedTracks((prev) => ({ ...prev, [deck]: track }));

      // Beat times come through the same query cache the beatgrid
      // components use (usually already warm). ONE round trip, no retries
      // (ADR 0029): the engine awaits this single settlement after decode,
      // so readiness never gates on background analysis — a fresh import's
      // 400 settles fast and the deck plays gridless. The deck's sync
      // observer (useDeckBeatgridSync) owns riding out analysis — retry,
      // arrival polling — and pushes late grids via setBeatTimes; failures
      // here fall through the cue-default precedence.
      const beatTimes = queryClient
        .fetchQuery<BeatgridResponse>({
          queryKey: ['beatgrid', track.id],
          queryFn: () => api.beatgrids.get(track.id),
          staleTime: Infinity,
          retry: false,
        })
        .then(
          (bg) => (bg.data.beat_times.length > 0 ? bg.data.beat_times : null),
          () => null
        );

      void engines[deck].load({
        trackId: track.id,
        audioUrl: api.tracks.audioUrl(track.id),
        bpm: track.bpm ?? null,
        savedCuePoint: track.cue_point_time ?? null,
        beatTimes,
      });
    },
    [engines, queryClient]
  );

  // Keep each Deck's Quantize grid live (cue-quantize-bpm 01): the engine
  // snapshots beat times at Load, but a BPM re-tempo / nudge / downbeat
  // mark re-spaces the grid server-side (ADR 0016) — these observers
  // refetch on invalidation and push the fresh beats into the engines.
  useDeckBeatgridSync(engines.A, loadedTracks.A?.id ?? null);
  useDeckBeatgridSync(engines.B, loadedTracks.B?.id ?? null);
  useDeckBeatgridSync(engines.C, loadedTracks.C?.id ?? null);
  useDeckBeatgridSync(engines.D, loadedTracks.D?.id ?? null);
  // Same pattern for the tempo scalar feeding beat-jump math
  // (cue-quantize-bpm 02): the per-surface setTrackBpm calls give edits
  // immediate effect; these observers make every other path (analysis,
  // sync imports, edits from the other deck's surfaces) converge too.
  useDeckBpmSync(engines.A, loadedTracks.A?.id ?? null);
  useDeckBpmSync(engines.B, loadedTracks.B?.id ?? null);
  useDeckBpmSync(engines.C, loadedTracks.C?.id ?? null);
  useDeckBpmSync(engines.D, loadedTracks.D?.id ?? null);

  // ── Loaded-Deck persistence ────────────────────────────────────────────
  // The shared Decks ARE "what's loaded on A–D" across every mode — the
  // Transition editor's loads come through this same path (ADR 0022).
  // Persist track ids on every Load; restore once on boot (a Load
  // allocates audio memory but nothing plays until the user does).
  const loadedTracksRef = useRef(loadedTracks);
  useEffect(() => {
    loadedTracksRef.current = loadedTracks;
  });

  const restoreStarted = useRef(false);
  useEffect(() => {
    if (restoreStarted.current) return; // StrictMode re-run guard
    restoreStarted.current = true;
    const stored = readStoredLoadedIds();
    for (const deck of CHANNEL_IDS) {
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
    if (CHANNEL_IDS.every((deck) => loadedTracks[deck] === null)) return;
    localStorage.setItem(
      LOADED_TRACKS_KEY,
      JSON.stringify(
        Object.fromEntries(CHANNEL_IDS.map((deck) => [deck, loadedTracks[deck]?.id ?? null]))
      )
    );
  }, [loadedTracks]);

  // Persist user-set cues (an engine fires this only for deliberate cue
  // sets, never for load defaults, and reports its own loaded trackId) and
  // keep the loaded Track objects' cue in sync. The persist invalidates
  // the ['tracks'] prefix so every query serving Track rows (library
  // views, the Set view's track facts) refetches without a reload
  // (sets 19; the plan itself no longer reads the Main cue).
  useEffect(() => {
    for (const deck of CHANNEL_IDS) {
      engines[deck].setCueSetHandler((trackId, timeSeconds) => {
        void api.waveforms
          .updateCuePoint(trackId, timeSeconds)
          .then(() => queryClient.invalidateQueries({ queryKey: ['tracks'] }));
        setLoadedTracks((prev) => {
          const next = { ...prev };
          for (const d of CHANNEL_IDS) {
            const t = next[d];
            if (t && t.id === trackId) next[d] = { ...t, cue_point_time: timeSeconds };
          }
          return next;
        });
      });
    }
    return () => {
      for (const deck of CHANNEL_IDS) engines[deck].setCueSetHandler(null);
    };
  }, [engines, queryClient]);

  // Per-deck loadTrack functions stay identity-stable across state changes
  // (memoized rows key their re-renders on them).
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
      loadTrack: (track) => loadTrackOnto(deck, track),
      beatjumpBeats,
      setBeatjumpBeats: (beats) =>
        setBeatjumps((prev) => ({ ...prev, [deck]: clampBeatjump(beats) })),
    }),
    [engines, loadTrackOnto]
  );
  const scopeA = useMemo(
    () => makeScope('A', loadedTracks.A, beatjumps.A),
    [makeScope, loadedTracks.A, beatjumps.A]
  );
  const scopeB = useMemo(
    () => makeScope('B', loadedTracks.B, beatjumps.B),
    [makeScope, loadedTracks.B, beatjumps.B]
  );
  const scopeC = useMemo(
    () => makeScope('C', loadedTracks.C, beatjumps.C),
    [makeScope, loadedTracks.C, beatjumps.C]
  );
  const scopeD = useMemo(
    () => makeScope('D', loadedTracks.D, beatjumps.D),
    [makeScope, loadedTracks.D, beatjumps.D]
  );
  const registry = useMemo<Record<ChannelId, DeckContextValue>>(
    () => ({ A: scopeA, B: scopeB, C: scopeC, D: scopeD }),
    [scopeA, scopeB, scopeC, scopeD]
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
        cueWalk: (deck, direction) => deckControlsFor(deck)?.cueWalk(direction),
      },
      jumps: {
        beatjump: (deck, direction) => deckControlsFor(deck)?.beatjump(direction),
        beatjumpWindow: (deck, direction, divisor) =>
          deckControlsFor(deck)?.beatjumpWindow(direction, divisor),
      },
      loops: {
        toggleLoop: (deck) => {
          const d = registryRef.current[deck];
          if (deckReadyNow(d)) d.engine.toggleLoop();
        },
        loopPreset: (deck, beats) => {
          const d = registryRef.current[deck];
          if (deckReadyNow(d)) d.engine.loopPreset(beats);
        },
        resizeActiveLoop: (deck, change) => {
          const d = registryRef.current[deck];
          if (!deckReadyNow(d)) return false;
          return d.engine.resizeActiveLoop(change);
        },
      },
      jog: {
        rimTicks: (deck, ticks, profile) => deckControlsFor(deck)?.jogTicks(ticks, profile),
        touchTicks: (deck, ticks, profile) => deckControlsFor(deck)?.jogTouchTicks(ticks, profile),
        shiftRimTicks: (deck, ticks, profile) => deckControlsFor(deck)?.jogSeekTicks(ticks, profile),
      },
      // Pause only (ADR 0022): the one context keeps running — the
      // claimant (the editor) plays through it.
      silence: () => {
        for (const deck of CHANNEL_IDS) engines[deck].pause();
      },
    });
    return () => unregisterSurface('shared');
  }, [engines]);

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
