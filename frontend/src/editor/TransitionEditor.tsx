/**
 * Transition editor — the top-bar mode for sketching the Transition between
 * two loaded Tracks: a two-track arranger with drawn automation lanes over
 * the overlap window, deterministic playback via MixPlayer, and the saved-
 * Transition switcher (transition library).
 *
 * Graduated from prototype 2026-07-04 (ADR 0010; iteration history in
 * .scratch/mix-editor/NOTES.md).
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { api } from '../api/client';
import { useBeatgridData } from '../hooks/useBeatgridData';
import { gridFirstBpm } from '../components/deckControls/bpmCommit';
import { useHotCueSlots } from '../hooks/useHotCueActions';
import { useHotCues } from '../hooks/useHotCues';
import { JogController } from '../midi/jog';
import Library from '../components/Library';
import type { LibraryBrowseHandle } from '../components/Library';
import { isGuardedKeyEvent } from '../components/performance/performanceKeys';
import { DeckScope } from '../contexts/DeckContext';
import { useDecks } from '../hooks/useDeck';
import {
  claimAudible,
  isAudible,
  registerSurface,
  releaseAudible,
  subscribeAudible,
  unregisterSurface,
} from '../playback/audibleSurface';
import { useMixer } from '../hooks/useMixer';
import { prefetchTrackBuffer } from '../sets/prefetch';
import { armAudition } from './auditionArm';
import { MixPlayer } from './MixPlayer';
import { DawTimeline } from './DawTimeline';
import { DeckCard } from './DeckCard';
import { TransitionSwitcher } from './TransitionSwitcher';
import { TemplatesDropdown } from './TemplatesDropdown';
import { SaveTemplateModal } from './SaveTemplateModal';
import type { SaveTemplateResult } from './SaveTemplateModal';
import { barBeatLabel, bEntryLabel, lengthBeatsLabel } from './beatReadout';
import { beatsToSeconds, slideBeatsToSeconds } from './gestureMath';
import { EditorStore, useEditorSelector } from './editorStore';
import { LAST_PAIR_KEY, initTransitionStore } from './pairStore';
import { applyTemplate, stripTemplateLanes } from './templateModel';
import { vectorizeTake } from '../capture/vectorize';
import { trackEffectiveBpm } from '../sets/planner';
import { OPEN_TAKE_EVENT, consumeTakeReview } from '../capture/takeReview';
import { OPEN_PAIR_EVENT, consumePairEdit, type PairEditRequest } from './openPair';
import type { TrackSideInfo, TransitionTemplate } from './templateModel';
import {
  deleteTemplate,
  initTemplateStore,
  saveTemplate,
  snapshotTemplates,
  subscribeTemplates,
} from './templateStore';
import { EDITOR_PITCH_RANGE_PERCENT, defaultMix, tempoMatchPitch } from './mixModel';
import type { Transition } from './mixModel';
import { LinkToggle } from '../links/LinkToggle';
import { repointTakePinsLocal } from '../sets/setStore';
import type { Track } from '../types';
import './transitionEditor.css';

/** Gate on the transition and template stores' boot loads (ADR 0011): the
 * inner editor seeds session state from the snapshots in initializers, so
 * it must not mount before init resolves (two localhost fetches —
 * imperceptible). init never rejects; a dead backend degrades to empty
 * stores. */
export default function TransitionEditor() {
  const [storeReady, setStoreReady] = useState(false);
  useEffect(() => {
    let mounted = true;
    void Promise.all([initTransitionStore(), initTemplateStore()]).then(() => {
      if (mounted) setStoreReady(true);
    });
    return () => {
      mounted = false;
    };
  }, []);
  if (!storeReady) return null;
  return <TransitionEditorInner />;
}

function TransitionEditorInner() {
  // Session state lives in the EditorStore (mix-editor 27); this shell is
  // layout + glue: tracks/decks/player wiring and view choreography. It
  // deliberately does NOT subscribe to `mix` — drag-rate changes re-render
  // only the narrow subscribers (DawTimeline, the center panel).
  const [store] = useState(() => new EditorStore());
  useEffect(() => () => store.dispose(), [store]);
  // The conductor drives the SHARED Decks and Mixer (ADR 0022) — no
  // private machinery, so routing (master AND cue/PFL), Key Lock, and
  // every future mixer feature cover the editor by construction. The
  // borrow lifecycle (claim/engage/checkpoint) rides the FIRST AUDITION
  // GESTURE (sets 21), not the mount — see ensureEditorAudible below; the
  // `audible` gate keeps a silent editor's model edits off the shared
  // engines/mixer.
  const mixer = useMixer();
  const sharedDecks = useDecks();
  const [player] = useState(
    () =>
      new MixPlayer(defaultMix(), {
        mixer,
        engineA: sharedDecks.A.engine,
        engineB: sharedDecks.B.engine,
        audible: () => isAudible('editor'),
      })
  );
  useEffect(() => () => player.dispose(), [player]);

  // The player follows the store SYNCHRONOUSLY (notifications are sync) —
  // audio sees a mutation before the mutating caller's next line, which
  // retires the old "push to player NOW" special case in the slide path.
  useEffect(() => {
    player.setMix(store.getSnapshot().mix);
    return store.subscribe(() => player.setMix(store.getSnapshot().mix));
  }, [store, player]);

  // Re-render on player/engine state changes.
  const [, bump] = useState(0);
  useEffect(() => {
    const rerender = () => bump((n) => n + 1);
    const subs = [
      player.subscribe(rerender),
      player.engineA.subscribe(rerender),
      player.engineB.subscribe(rerender),
    ];
    return () => subs.forEach((u) => u());
  }, [player]);

  const [trackA, setTrackA] = useState<Track | null>(null);
  const [trackB, setTrackB] = useState<Track | null>(null);
  /** Locked window (glossary): rare changes — a cheap shell subscription. */
  const lockedWindow = useEditorSelector(store, (s) => s.lockedWindow);

  const { data: beatgridA } = useBeatgridData(trackA?.id ?? null);
  const { data: beatgridB } = useBeatgridData(trackB?.id ?? null);
  const { data: hotCuesA = [] } = useHotCues(trackA?.id ?? null);
  const { data: hotCuesB = [] } = useHotCues(trackB?.id ?? null);

  // What template anchor resolution knows about each side (issue 03).
  const sideA: TrackSideInfo = useMemo(
    () => ({
      beatgrid: beatgridA?.data ?? null,
      hotCues: hotCuesA.map((c) => ({ slot: c.slot_number, timeSec: c.time_seconds })),
    }),
    [beatgridA, hotCuesA]
  );
  const sideB: TrackSideInfo = useMemo(
    () => ({
      beatgrid: beatgridB?.data ?? null,
      hotCues: hotCuesB.map((c) => ({ slot: c.slot_number, timeSec: c.time_seconds })),
    }),
    [beatgridB, hotCuesB]
  );

  // Grid tempo is the BPM source of truth when a grid exists; track BPM is
  // the fallback (performance-data-sync issue 02). Variable grids count as
  // their DOMINANT tempo (ADR 0027 §4 doctrine, shared helper) — not the
  // first segment.
  const bpmA = gridFirstBpm(beatgridA?.data, trackA?.bpm, trackA?.duration_secs);
  const bpmB = gridFirstBpm(beatgridB?.data, trackB?.bpm, trackB?.duration_secs);

  // B's playback rate under tempo match (same math as the player's).
  const tempoMatch = useEditorSelector(store, (s) => s.mix.transition.tempoMatch);
  const rateB = tempoMatch ? 1 + tempoMatchPitch(bpmA, bpmB) / 100 : 1;

  // Keep the player's tempo-match inputs on the grid-derived values (it gets
  // track BPM at load time, before the beatgrid query resolves).
  useEffect(() => {
    player.setBpm('A', bpmA);
    player.setBpm('B', bpmB);
  }, [player, bpmA, bpmB]);

  const pairKey = trackA && trackB ? `${trackA.id}:${trackB.id}` : null;

  /** Bumped whenever a Transition loads/switches: the timeline re-frames
   * around the window and the playhead parks at the window start. The park
   * is deferred until the player is ready — seek() clamps to the mix
   * duration, which is ~0 while tracks are still loading. */
  const [frameSignal, setFrameSignal] = useState(0);
  const pendingParkRef = useRef<number | null>(null);
  const onTransitionLoaded = useCallback(
    (transition: Transition) => {
      if (player.ready()) player.seek(transition.startSec);
      else pendingParkRef.current = transition.startSec;
      setFrameSignal((n) => n + 1);
    },
    [player]
  );
  useEffect(() => {
    if (pendingParkRef.current !== null && player.ready()) {
      player.seek(pendingParkRef.current);
      pendingParkRef.current = null;
    }
  });

  // Transition loads/switches are store events; the shell decides what they
  // mean visually (re-frame + park). Persistence — debounce, flush-before-
  // repoint, unmount flush — lives in the EditorStore, armed inside
  // mutations only (the 2026-07-04 incident's race is unrepresentable
  // there; see issue 26 comments and editorStore tests).
  useEffect(() => {
    store.setTransitionLoadedHandler(onTransitionLoaded);
    return () => store.setTransitionLoadedHandler(null);
  }, [store, onTransitionLoaded]);

  // The shared decks are the loaded pair (ADR 0022 — mirroring is gone:
  // editor loads ARE Deck loads through the provider's one path); read
  // through a ref so assignTrack stays identity-stable for the keyboard
  // effect.
  const sharedDecksRef = useRef(sharedDecks);
  useEffect(() => {
    sharedDecksRef.current = sharedDecks;
  });

  // The session pair, readable from identity-stable callbacks (the
  // audition arm below reads the CURRENT pair, not a closed-over one).
  const trackRef = useRef<{ A: Track | null; B: Track | null }>({ A: null, B: null });
  useEffect(() => {
    trackRef.current = { A: trackA, B: trackB };
  });

  /** Pending audition arm (sets 37): play pressed, deck loads in flight.
   * The stored function is the cancel — any other transport gesture,
   * displacement, or pair supersession calls it; fulfilment nulls it. */
  const pendingAuditionRef = useRef<(() => void) | null>(null);
  const [auditionPending, setAuditionPending] = useState(false);
  const cancelPendingAudition = useCallback(() => {
    if (!pendingAuditionRef.current) return;
    pendingAuditionRef.current();
    pendingAuditionRef.current = null;
    setAuditionPending(false);
  }, []);

  /** SESSION-ONLY track assignment (sets 37): editor state, store, and
   * the player's track target — never the shared decks. Deck loads are
   * deferred to the audition arm (or ride assignTrack's explicit load
   * below). Changing a side supersedes any audition in flight: the
   * sounding decks no longer match the session pair, so the audition and
   * any pending arm stop (pausing our OWN audition never silences
   * another surface). */
  const assignSession = useCallback(
    (deck: 'A' | 'B', track: Track) => {
      cancelPendingAudition();
      if (player.isPlaying()) player.pause();
      if (deck === 'A') setTrackA(track);
      else setTrackB(track);
      store.setTrackId(deck, track.id);
      player.setTrack(deck, { id: track.id, durationSec: track.duration_secs ?? null });
    },
    [store, player, cancelPendingAudition]
  );

  const assignTrack = useCallback(
    (deck: 'A' | 'B', track: Track) => {
      assignSession(deck, track);
      // The one load path (ADR 0022): assigning to the editor pair IS
      // Loading the shared Deck (Main-cue defaults, persistence and all).
      // Same track already loaded → nothing to do, buffer's already hot.
      // This immediate load stays on the EXPLICIT deck-load affordances
      // (embedded library buttons, arrow keys) — a load onto a conducted
      // deck is a takeover (sets 28). Artifact opens defer instead
      // (sets 37 — see openPair/openTake).
      const shared = sharedDecksRef.current[deck];
      if (shared.loadedTrack?.id !== track.id) shared.loadTrack(track);
    },
    [assignSession]
  );

  /** Warm the decode cache for a deferred-open pair (sets 37) so the
   * audition arm's loads are usually near-instant. Tracks a shared deck
   * already holds are skipped — their buffers are hot and the arm's load
   * will be a no-op (the free case: editing the sounding adjacency). */
  const warmPair = useCallback(
    (...tracks: Track[]) => {
      const decks = sharedDecksRef.current;
      for (const t of tracks) {
        if (decks.A.loadedTrack?.id === t.id || decks.B.loadedTrack?.id === t.id) continue;
        prefetchTrackBuffer(mixer, t.id).catch((err) =>
          console.warn('editor open: decode-cache warm failed', t.id, err)
        );
      }
    },
    [mixer]
  );

  // Swap the loaded pair (issue 29): A's track to deck B and vice versa —
  // one gesture instead of two re-loads when the pair is backwards. The
  // pair key reverses, so the session re-seeds from the REVERSED pair's
  // saved Transitions via the normal loadPair rules (old direction flushes
  // first; nothing is mirrored — direction is meaning). Session-only since
  // sets 37: the double deck re-load defers to the next audition press.
  const swapDecks = useCallback(() => {
    const a = trackA;
    const b = trackB;
    if (!a || !b) return;
    assignSession('A', b);
    assignSession('B', a);
  }, [trackA, trackB, assignSession]);

  // Deck B slides (issue 11): hot cue / beat jump gestures realign the
  // pair. The store mutates (player follows synchronously); the audio-side
  // re-park stays here — playhead's mix position never moves.
  const slideDeckB = useCallback(
    (kind: 'cue' | 'beats', value: number) => {
      const playhead = player.getMixTime();
      store.slideDeckB(kind, value, playhead, rateB);
      if (!player.isPlaying()) player.seek(playhead);
    },
    [store, player, rateB]
  );

  // When a (new) pair is assembled, seed the session from the store —
  // or with a pristine "Transition 1" that exists only in memory until a
  // real edit materializes it (merely-opened pairs leave no trace).
  // loadPair flushes the previous pair's pending edits internally.
  useEffect(() => {
    if (!pairKey) return;
    localStorage.setItem(LAST_PAIR_KEY, pairKey);
    store.loadPair(pairKey);
  }, [pairKey, store]);

  // Hardware pad gestures (editor-midi 01, ADR 0019): the same hot-cue
  // slot behavior as the on-screen pads in DeckCard — set on empty at the
  // deck's track playhead, trigger = the deck's gesture (A jumps the mix,
  // B Slides the cue under the playhead), SHIFT+pad clears. Registered
  // into the surface handle below; handlers read the latest hook values
  // through a ref so loads/rate changes never re-register.
  const midiCuesA = useHotCueSlots(trackA?.id ?? null, {
    enabled: trackA !== null,
    getPlayhead: () => player.getTrackTime('A'),
    trigger: (_slot, t) => player.seek(t),
  });
  const midiCuesB = useHotCueSlots(trackB?.id ?? null, {
    enabled: trackB !== null,
    getPlayhead: () => player.getTrackTime('B'),
    trigger: (_slot, t) => slideDeckB('cue', t),
  });
  const midiCues = useRef({ A: midiCuesA, B: midiCuesB });
  useEffect(() => {
    midiCues.current = { A: midiCuesA, B: midiCuesB };
  });

  // Hardware jump gestures (editor-midi 02): mirror the on-screen ◀/▶
  // cluster — A jumps the mix by the shared size in A's beats; B Slides by
  // its own beats. Size and BPM read through refs (registration runs once).
  const midiGestures = useRef({ bpmA, bpmB, slideDeckB });
  useEffect(() => {
    midiGestures.current = { bpmA, bpmB, slideDeckB };
  });

  // Hardware jog (editor-midi 04): the performance jog controller reused
  // over editor ports, keeping the three-tier feel (rim = gentle, touch =
  // fine, SHIFT+rim = velocity-accelerated fast) with settled constants.
  // `isPlaying: false` makes every rim tick a seek — the mix transport has
  // no bend, so ticks scrub whether the mix plays or not (MixPlayer
  // hard-syncs the decks on seek).
  const midiJogA = useMemo(
    () =>
      new JogController({
        isPlaying: () => false,
        getPlayhead: () => player.getMixTime(),
        seek: (s) => player.seek(s),
        setBend: () => undefined, // unreachable while isPlaying is false
      }),
    [player]
  );
  // Deck B Slides instead of seeking: a delta port (playhead pinned to 0)
  // turns the controller's absolute seeks into signed slide-by-seconds —
  // the continuous generalization of the Alignment nudge. Goes through
  // slideDeckB, so the paused re-park and autosave match the on-screen
  // Slide gestures.
  const midiJogB = useMemo(
    () =>
      new JogController({
        isPlaying: () => false,
        getPlayhead: () => 0,
        seek: (deltaSec) => midiGestures.current.slideDeckB('beats', deltaSec),
        setBend: () => undefined,
      }),
    []
  );
  useEffect(
    () => () => {
      midiJogA.dispose();
      midiJogB.dispose();
    },
    [midiJogA, midiJogB]
  );

  // The BORROW BOUNDARY (ADR 0022), entered LAZILY (sets 21): the editor
  // claims audibility on its first audition gesture, never on mount —
  // entering the editor must not interrupt ongoing playback (a running
  // set Conductor in particular keeps playing under a mounted, silent,
  // fully-editable editor). At claim time the arbiter is unchanged: the
  // displaced holder is silenced (the Conductor stands down). While the
  // editor holds audibility, drawn automation owns the shared Mixer's
  // lane params (engage/disengage — the Mixer reapplies base state
  // itself), and deck pitches are checkpointed at the claim and restored
  // when the editor releases (the editor's tempo-match pitch must not
  // leak into the ±8% Performance fader; transport positions deliberately
  // DO persist — transition editing is not a mid-set activity).
  const pitchCheckpointRef = useRef<{ A: number; B: number } | null>(null);
  /** This session's overlay owner token (sets 25): disengage is
   * owner-only, so a displaced prior session's teardown cannot yank the
   * overlay from under a live audition. */
  const automationTokenRef = useRef<symbol | null>(null);
  const ensureEditorAudible = useCallback(() => {
    if (isAudible('editor')) return;
    claimAudible('editor'); // pauses the displaced holder's playback
    if (!isAudible('editor')) return; // refused (registration raced)
    pitchCheckpointRef.current = {
      A: player.engineA.getSnapshot().pitchPercent,
      B: player.engineB.getSnapshot().pitchPercent,
    };
    automationTokenRef.current = mixer.engageAutomation();
  }, [player, mixer]);

  // The audition gesture (sets 21, extended by sets 37's one-press arm):
  // starting the mix transport claims first; pausing it never needs to.
  // Under a deferred open the decks may not hold the session pair yet —
  // play CLAIMS (the holder stands down), issues the missing deck loads,
  // and starts the moment both decks are ready (armAudition). CLAIM
  // BEFORE LOAD, always: by the time the arm's loads fire, the holder is
  // the editor — they are never foreign loads during conduction (they
  // compose with sets 28's takeover rule instead of tripping it). A press
  // on an empty session claims nothing and silences nothing.
  const auditionTogglePlay = useCallback(() => {
    // A pending arm is the play that hasn't sounded yet: the same press
    // toggles it off (pendingCues' re-press rule).
    if (pendingAuditionRef.current) {
      cancelPendingAudition();
      return;
    }
    if (player.isPlaying()) {
      player.pause();
      return;
    }
    const { A: a, B: b } = trackRef.current;
    if (!a || !b) return;
    ensureEditorAudible();
    if (!isAudible('editor')) return; // claim refused — arm nothing
    const cancel = armAudition({
      engines: { A: player.engineA, B: player.engineB },
      targets: { A: a.id, B: b.id },
      // Deck loads through the provider's one load path (ADR 0022) —
      // issued only for decks that don't already hold their target.
      load: (deck) => sharedDecksRef.current[deck].loadTrack(deck === 'A' ? a : b),
      onReady: () => {
        // Clear the arm BEFORE the park's seek below — the seek tap
        // cancels pending arms (subscribeSeek), not this fulfilment.
        pendingAuditionRef.current = null;
        setAuditionPending(false);
        // A transition selected while the pair wasn't ready parked
        // nothing (onTransitionLoaded deferred it) — honor it now so the
        // audition starts at the window, not at 0.
        if (pendingParkRef.current !== null) {
          player.seek(pendingParkRef.current);
          pendingParkRef.current = null;
        }
        player.play();
      },
    });
    if (cancel) {
      pendingAuditionRef.current = cancel;
      setAuditionPending(true);
    }
  }, [player, ensureEditorAudible, cancelPendingAudition]);

  // Any other transport gesture cancels a pending arm (sets 37): every
  // editor seek path — timeline scrub, minimap, jog, cue/beat jumps,
  // slides' paused re-park — funnels through player.seek, which taps
  // here. Displacement is covered beside the surface registration below;
  // pair supersession in assignSession.
  useEffect(() => player.subscribeSeek(cancelPendingAudition), [player, cancelPendingAudition]);

  // One audible surface at a time (ADR 0013, shrunk by ADR 0022):
  // REGISTER while mounted — registering is not claiming; the claim rides
  // the first audition gesture above. While some other surface is
  // audible, hardware gestures route there, not here (ADR 0019); once the
  // editor holds, both PLAYs = the one mix transport (keyboard-parity
  // with Space; CUE has no editor meaning and drops, like F). Pads carry
  // the editor's gesture semantics (ADR 0019); release is absent — editor
  // gestures are taps, so the up edge drops.
  useEffect(() => {
    registerSurface('editor', {
      transport: { togglePlay: auditionTogglePlay },
      pads: {
        hotCueDown: (deck, pad) => midiCues.current[deck].down(pad),
        hotCueClear: (deck, pad) => midiCues.current[deck].remove(pad),
      },
        jumps: {
        beatjump: (deck, direction) => {
          const { bpmA: a, bpmB: b, slideDeckB: slide } = midiGestures.current;
          const bpm = deck === 'A' ? a : b;
          if (!bpm || bpm <= 0) return; // same gate as the on-screen cluster
          const beats = sharedDecksRef.current[deck].beatjumpBeats;
          const n = direction === 'back' ? -beats : beats;
          if (deck === 'A') player.seek(player.getMixTime() + beatsToSeconds(n, bpm));
          // Apparent-motion polarity (mix-editor 32): ▶ slides B's drawn
          // block right — same flip as the on-screen cluster.
          else slide('beats', slideBeatsToSeconds(n, bpm));
        },
      },
      jog: {
        rimTicks: (deck, ticks) => (deck === 'A' ? midiJogA : midiJogB).onTicks(ticks),
        touchTicks: (deck, ticks) => (deck === 'A' ? midiJogA : midiJogB).onTouchTicks(ticks),
        shiftRimTicks: (deck, ticks) => (deck === 'A' ? midiJogA : midiJogB).onSeekTicks(ticks),
      },
      // LED Feedback mirrors the audible surface (editor-midi 05): one mix
      // transport, reported for both decks — both PLAY LEDs follow it.
      transportState: {
        playing: () => player.isPlaying(),
        subscribe: (fn) => player.subscribe(fn),
      },
      silence: () => player.pause(),
    });
    // Displacement stand-down (sets 25), mirror of the Conductor's own
    // subscribeAudible hook: when another surface takes the holder, this
    // audition stops conducting. silence() above only covers claims that
    // silence the displaced holder — a claim with silencePrevious: false
    // (pickup adopts the live state) skips it, and a still-running
    // MixPlayer would fight the new holder for the shared decks (issue
    // 25's audible B-wobble). pause() is a no-op when not playing.
    const unsubDisplaced = subscribeAudible((holder) => {
      if (holder !== 'editor') {
        cancelPendingAudition(); // a displaced arm must never fire (sets 37)
        player.pause();
      }
    });
    return () => {
      unsubDisplaced();
      cancelPendingAudition();
      // Unwind the borrow only if the editor still holds it (sets 21): a
      // never-auditioned editor took nothing; a DISPLACED editor's decks/
      // overlay already belong to the new holder (mirror of the
      // Conductor's stand-down — it neither releases nor disengages).
      const held = isAudible('editor');
      if (held) releaseAudible('editor'); // pauses the audition (editor.silence)
      unregisterSurface('editor');
      if (held) {
        const token = automationTokenRef.current;
        if (token) mixer.disengageAutomation(token); // Mixer reapplies base state
        const pitches = pitchCheckpointRef.current;
        if (pitches) {
          player.engineA.setPitch(pitches.A);
          player.engineB.setPitch(pitches.B);
        }
      }
      automationTokenRef.current = null;
      pitchCheckpointRef.current = null;
    };
  }, [player, mixer, midiJogA, midiJogB, auditionTogglePlay, cancelPendingAudition]);

  // Adopt tracks on entry, per slot: the shared deck's loaded track wins
  // (mode switches carry the pair), else the saved last pair (refresh
  // straight into the editor — provider restore may still be in flight);
  // otherwise the deck stays empty. Nothing is silenced here (sets 21):
  // whatever plays keeps playing under the mounted editor until an
  // audition claims. SESSION-ONLY since sets 37 — even the last-pair
  // fallback issues no deck loads (pre-37 it loaded empty decks, which
  // under sets 28 would be a takeover if a set were conducting); the
  // first audition press loads whatever's missing.
  useEffect(() => {
    const last = localStorage.getItem(LAST_PAIR_KEY);
    const lastIds = last ? last.split(':').map(Number) : null;
    for (const [deck, i] of [['A', 0], ['B', 1]] as const) {
      const shared = sharedDecks[deck].loadedTrack;
      const fallbackId = lastIds?.[i];
      if (shared) {
        assignSession(deck, shared);
      } else if (fallbackId !== undefined && fallbackId !== null && !Number.isNaN(fallbackId)) {
        api.tracks.getById(fallbackId).then((t: Track) => assignSession(deck, t)).catch(() => undefined);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Take review (transition-takes 03): a Transition-history row opens its
  // Take here. Tracks are assigned by ROLE — outgoing → editor A, whatever
  // physical deck it played on. An unpromoted Take vectorizes into an
  // unsaved draft (store.stampTakeDraft); an already-promoted one just
  // selects its Transition.
  const openTake = useCallback(
    async (uuid: string) => {
      // SESSION-ONLY open (sets 37, same contract as openPair below): no
      // claim, no shared-deck loads — whatever sounds keeps sounding.
      try {
        const detail = await api.takes.get(uuid);
        const [a, b] = await Promise.all([
          api.tracks.getById(detail.a_track_id),
          api.tracks.getById(detail.b_track_id),
        ]);
        assignSession('A', a);
        assignSession('B', b);
        warmPair(a, b);
        const pk = `${a.id}:${b.id}`;
        localStorage.setItem(LAST_PAIR_KEY, pk);
        store.loadPair(pk);
        if (detail.promoted_transition_uuid) {
          store.selectTransition(detail.promoted_transition_uuid);
          return;
        }
        const draft = vectorizeTake(
          {
            events: detail.events,
            windowStartS: detail.window_start_s,
            windowEndS: detail.window_end_s,
          },
          // Grid-first (ADR 0016): same authority the plan-time
          // vectorization uses — the bpm column can be a stale projection.
          { bpmA: trackEffectiveBpm(a), bpmB: trackEffectiveBpm(b) }
        );
        if (draft) store.stampTakeDraft(uuid, draft.transition);
        else console.error('take review: slice has no init head — cannot vectorize', uuid);
      } catch (err) {
        console.error('take review: open failed', err);
      }
    },
    [assignSession, warmPair, store]
  );
  useEffect(() => {
    const consume = () => {
      const uuid = consumeTakeReview();
      if (uuid) void openTake(uuid);
    };
    consume(); // a request may be pending from before the view switch
    window.addEventListener(OPEN_TAKE_EVENT, consume);
    return () => window.removeEventListener(OPEN_TAKE_EVENT, consume);
  }, [openTake]);

  // Adjacency click-through (sets 09): a Set-view adjacency opens its
  // ordered pair here — outgoing → editor A, incoming → editor B (the
  // editor always presents outgoing-as-A; Conductor parity is irrelevant).
  // A Transition pin arrives with its uuid and gets selected; unresolved
  // arrives with null and lands on a blank sketch.
  const openPair = useCallback(
    async (req: PairEditRequest) => {
      // SESSION-ONLY open (sets 37, superseding 21's eager claim here):
      // opening an adjacency mid-set must not silence the conducting set.
      // Only the session opens — pair, selection, model; the strips render
      // the opened pair from track data. The deck CLAIM and LOADS defer to
      // the first audition press (auditionTogglePlay's arm: claim → load
      // both decks → play when ready); warmPair pre-decodes so that gap is
      // usually near-zero. Editing the SOUNDING adjacency is the free
      // case: the decks already hold the pair, so the arm is a no-op
      // adopt and play is immediate.
      try {
        const [a, b] = await Promise.all([
          api.tracks.getById(req.aTrackId),
          api.tracks.getById(req.bTrackId),
        ]);
        assignSession('A', a);
        assignSession('B', b);
        warmPair(a, b);
        const pk = `${a.id}:${b.id}`;
        localStorage.setItem(LAST_PAIR_KEY, pk);
        store.loadPair(pk);
        if (req.transitionUuid) store.selectTransition(req.transitionUuid);
        else store.startBlankSketch();
      } catch (err) {
        console.error('adjacency edit: open failed', err);
      }
    },
    [assignSession, warmPair, store]
  );
  useEffect(() => {
    const consume = () => {
      const req = consumePairEdit();
      if (req) void openPair(req);
    };
    consume(); // a request may be pending from before the view switch
    window.addEventListener(OPEN_PAIR_EVENT, consume);
    return () => window.removeEventListener(OPEN_PAIR_EVENT, consume);
  }, [openPair]);

  // Selection/navigation handle into the embedded library panel.
  const libraryRef = useRef<LibraryBrowseHandle>(null);

  // Memoized element: the editor re-renders on every player/engine emit
  // (transport, loads) — a stable element identity lets React skip the
  // embedded library table on those renders (issue 10: re-diffing the
  // table right as a deck started was visible as playback-start jitter).
  const browsePanel = useMemo(
    () => (
      <DeckScope deck="A">
        <Library browseOnly onLoadToDeck={assignTrack} browseRef={libraryRef} />
      </DeckScope>
    ),
    [assignTrack]
  );

  // Per-deck clocks for the row canvases (stable identities).
  const clockA = useMemo(() => ({ getPlayhead: () => player.getTrackTime('A') }), [player]);
  const clockB = useMemo(() => ({ getPlayhead: () => player.getTrackTime('B') }), [player]);

  // Keyboard: space = editor play/pause (capture + stopPropagation so no
  // other surface sees it); table keys match the Performance view — ↑/↓
  // browse, ← / → load selection to A / B, Enter loads A.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isGuardedKeyEvent(e)) return;
      // The editor's selects (saved-Transition dropdown) keep their
      // native arrow/space behavior.
      if ((e.target as HTMLElement | null)?.tagName === 'SELECT') return;
      switch (e.key) {
        case ' ':
          e.preventDefault();
          e.stopPropagation();
          auditionTogglePlay(); // claims audibility on the first play (sets 21)
          break;
        case 'ArrowDown':
        case 'ArrowUp':
          e.preventDefault();
          libraryRef.current?.navigate(e.key === 'ArrowDown' ? 1 : -1);
          break;
        case 'ArrowLeft':
        case 'ArrowRight': {
          e.preventDefault();
          const sel = libraryRef.current?.getSelectedTrack();
          if (sel) assignTrack(e.key === 'ArrowLeft' ? 'A' : 'B', sel);
          break;
        }
        case 'Enter': {
          if ((e.target as HTMLElement | null)?.tagName === 'BUTTON') break;
          const sel = libraryRef.current?.getSelectedTrack();
          if (sel) assignTrack('A', sel);
          break;
        }
      }
    };
    document.addEventListener('keydown', onKey, { capture: true });
    return () => document.removeEventListener('keydown', onKey, { capture: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player, auditionTogglePlay]);

  const snapA = player.engineA.getSnapshot();
  const snapB = player.engineB.getSnapshot();
  // Deck-card load state, track-aware (sets 37): under a deferred open the
  // engines may hold ANOTHER surface's tracks — show the session side as
  // 'deferred' (play loads it) instead of the foreign track's state.
  const cardLoadState = (snap: typeof snapA, track: Track | null) =>
    track && snap.trackId !== track.id ? 'deferred' : snap.loadState;

  return (
    <div className="editor-root">
      {/* Top panel: the transition editor (sibling of Library / Performance) */}
      <div className="editor-top">
        <div className="editor-arranger">
          <DawTimeline
            store={store}
            player={player}
            trackAId={trackA?.id ?? null}
            trackBId={trackB?.id ?? null}
            clockA={clockA}
            clockB={clockB}
            beatgridA={beatgridA?.data ?? null}
            beatgridB={beatgridB?.data ?? null}
            rateB={rateB}
            frameSignal={frameSignal}
          />

          {/* Info bar: deck A (left) · transition (center) · deck B (right) */}
          <div className="editor-infobar">
            <DeckCard
              deck="A"
              track={trackA}
              player={player}
              loadState={cardLoadState(snapA, trackA)}
              effectiveBpm={bpmA}
              pitchPercent={0}
              onBpmSaved={(bpm) => setTrackA((t) => (t ? { ...t, bpm } : t))}
              onAlignmentNudge={(d) => store.alignmentNudge(d)}
              gestures={{
                // A ≡ mix axis (sketch origin): its controls are plain
                // transport, not slides (re-decided 2026-07-03 — mirror-A
                // slides duplicated B's under the lock toggle).
                kind: 'jump',
                toCue: (cueSec) => player.seek(cueSec),
                beats: (n) => bpmA && player.seek(player.getMixTime() + beatsToSeconds(n, bpmA)),
                enabled: bpmA !== null && bpmA > 0,
              }}
            />

            <EditorCenterPanel
              store={store}
              player={player}
              onTogglePlay={auditionTogglePlay}
              auditionPending={auditionPending}
              sideA={sideA}
              sideB={sideB}
              bpmA={bpmA}
              bpmB={bpmB}
              rateB={rateB}
              trackATitle={trackA?.title ?? 'A'}
              trackBTitle={trackB?.title ?? 'B'}
              trackAId={trackA?.id ?? null}
              trackBId={trackB?.id ?? null}
              pairLoaded={pairKey !== null}
              onSwapDecks={swapDecks}
              canSwapDecks={trackA !== null && trackB !== null}
            />

            <DeckCard
              deck="B"
              track={trackB}
              player={player}
              loadState={cardLoadState(snapB, trackB)}
              effectiveBpm={bpmB !== null ? bpmB * rateB : null}
              pitchPercent={(rateB - 1) * 100}
              onBpmSaved={(bpm) => setTrackB((t) => (t ? { ...t, bpm } : t))}
              onAlignmentNudge={(d) => store.alignmentNudge(d)}
              gestures={{
                kind: 'slide',
                toCue: (cueSec) => slideDeckB('cue', cueSec),
                // n of B's OWN beats → B-track seconds via base BPM;
                // apparent-motion polarity (32): +n = block right.
                beats: (n) => bpmB && slideDeckB('beats', slideBeatsToSeconds(n, bpmB)),
                enabled: bpmB !== null && bpmB > 0,
              }}
              lock={{ on: lockedWindow, toggle: () => store.toggleLockedWindow() }}
            />
          </div>
        </div>
      </div>

      {/* Bottom panel: the shared library browse surface (scoped to deck
          A). Load affordances match the Performance view: hover row
          buttons, double-click → A, arrow keys. */}
      <div className="editor-library">{browsePanel}</div>
    </div>
  );
}

/** Beat-domain readout (issue 18): beat label when the grid supports it,
 * dimmed seconds fallback otherwise; exact seconds always in the tooltip. */
function Readout({
  label,
  beatValue,
  seconds,
}: {
  label: string;
  beatValue: string | null;
  seconds: number;
}) {
  const secondsText = `${seconds.toFixed(2)}s`;
  return (
    <span
      className={`editor-readout ${beatValue === null ? 'editor-readout-time' : ''}`}
      title={beatValue === null ? `${secondsText} — no beatgrid` : secondsText}
    >
      <span className="editor-readout-label">{label}</span>
      <span className="editor-readout-value">{beatValue ?? secondsText}</span>
    </span>
  );
}

/**
 * Transition controls + switcher: the drag-rate subscriber (reads `mix`),
 * isolated so a lane drag re-renders this small panel and DawTimeline —
 * never the shell (mix-editor 27). Also hosts the templates feature
 * (mix-editor 03): the dropdown, apply notices, and the save modal.
 */
function EditorCenterPanel({
  store,
  player,
  onTogglePlay,
  auditionPending,
  sideA,
  sideB,
  bpmA,
  bpmB,
  rateB,
  trackATitle,
  trackBTitle,
  trackAId,
  trackBId,
  pairLoaded,
  onSwapDecks,
  canSwapDecks,
}: {
  store: EditorStore;
  player: MixPlayer;
  /** The audition gesture (sets 21): claims audibility before starting;
   * on a deferred-open pair it ARMS — claim, load, play when ready
   * (sets 37). */
  onTogglePlay: () => void;
  /** An arm is in flight (sets 37) — the ⏯ shows it; a press cancels. */
  auditionPending: boolean;
  sideA: TrackSideInfo;
  sideB: TrackSideInfo;
  bpmA: number | null;
  bpmB: number | null;
  rateB: number;
  trackATitle: string;
  trackBTitle: string;
  trackAId: number | null;
  trackBId: number | null;
  pairLoaded: boolean;
  /** Swap the loaded pair A ⇄ B (issue 29 — shell owns track assignment). */
  onSwapDecks: () => void;
  canSwapDecks: boolean;
}) {
  // Play-button state rides player/engine emits (transport, loads).
  const [, bump] = useState(0);
  useEffect(() => {
    const rerender = () => bump((n) => n + 1);
    const subs = [
      player.subscribe(rerender),
      player.engineA.subscribe(rerender),
      player.engineB.subscribe(rerender),
    ];
    return () => subs.forEach((u) => u());
  }, [player]);

  const mix = useEditorSelector(store, (s) => s.mix);
  const session = useEditorSelector(store, (s) => s.session);
  const snap = useEditorSelector(store, (s) => s.snap);

  // Take review (transition-takes 03): the banner lives in the center
  // panel's spare bottom row — the top of the editor is timeline space.
  const takeDraft = useEditorSelector(store, (s) => s.takeDraft);
  const promoteTake = useCallback(() => {
    const ref = store.promoteTakeDraft();
    if (!ref) return;
    void api.takes
      .setPromoted(ref.takeUuid, ref.transitionUuid)
      // The endpoint re-pointed Set pins server-side (sets 08); mirror it
      // in loaded Sets so client-authoritative entries stay in sync.
      .then(() => repointTakePinsLocal(ref.takeUuid, ref.transitionUuid))
      .catch((err) => console.error('take review: promoted-reference write failed', err));
  }, [store]);
  const tr = mix.transition;

  const setTransitionField = (patch: Partial<Transition>) =>
    store.updateMix((m) => ({ ...m, transition: { ...m.transition, ...patch } }));

  // ── Transition templates (issue 03) ──────────────────────────────────

  const templates = useSyncExternalStore(subscribeTemplates, snapshotTemplates);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  /** One-line notices from template application (fallbacks, clamps,
   * extreme tempo match). Click dismisses; new applies replace. */
  const [notices, setNotices] = useState<string[]>([]);
  useEffect(() => {
    if (notices.length === 0) return;
    const t = setTimeout(() => setNotices([]), 10000);
    return () => clearTimeout(t);
  }, [notices]);

  /** Apply a template to the loaded pair: resolve the recipe (pure), stamp
   * it into the session (store — pristine-in-place vs new take is
   * stampIntoSession's contract), surface the notices. */
  const applyTemplateToPair = useCallback(
    (tpl: TransitionTemplate, lengthBeats: number) => {
      const { patch, notices: applyNotices } = applyTemplate(
        tpl,
        { a: sideA, b: sideB },
        lengthBeats
      );
      const gapPct = bpmA && bpmB ? Math.abs((bpmA / bpmB - 1) * 100) : 0;
      if (gapPct > EDITOR_PITCH_RANGE_PERCENT) {
        applyNotices.push(
          `BPM gap exceeds the editor's tempo-match range (±${EDITOR_PITCH_RANGE_PERCENT}%) — beats will drift`
        );
      } else if (gapPct > 8) {
        applyNotices.push('extreme tempo match (>8%) — expect artifacts');
      }
      store.stampTemplate(tpl.name, patch);
      setNotices(applyNotices);
    },
    [store, sideA, sideB, bpmA, bpmB]
  );

  /** Save-from-Transition authoring (the modal asked one question per
   * side); uuid is fresh — re-saving an edited template is a new row,
   * management is rename/delete in the dropdown. */
  const saveCurrentAsTemplate = useCallback(
    (result: SaveTemplateResult) => {
      saveTemplate({
        uuid: crypto.randomUUID(),
        name: result.name,
        alignABase: result.alignABase,
        deltaBeats: result.deltaBeats,
        alignBBase: result.alignBBase,
        beforeBeats: result.beforeBeats,
        afterBeats: result.afterBeats,
        scalable: result.scalable,
        lanes: structuredClone(stripTemplateLanes(tr)),
      });
      setSaveModalOpen(false);
    },
    [tr, setSaveModalOpen]
  );

  // Preconditions: applying needs a loaded pair; authoring additionally
  // needs beatgrids on both sides (beat-domain recipes are meaningless
  // without them — hot cues are optional, the modal offers the grid
  // origin instead).
  const canSaveTemplate = pairLoaded && sideA.beatgrid !== null && sideB.beatgrid !== null;
  const saveDisabledReason = !pairLoaded ? 'Load two tracks first' : 'Both tracks need beatgrids';
  const activeItemName = session.items[session.active]?.name;

  return (
    <div className="editor-center">
      {/* Row 1: transport + the two mode toggles. TEMPO/SNAP engaged =
          inverted green fill (app-wide active-state color; top-bar quantize
          toggle is the model). Blur after click so neither steals keyboard
          focus (keyboard-focus 01). Semantics unchanged: tempoMatch =
          persisted model state, snap = view state (mix-editor 32). */}
      <div className="editor-center-row">
        <button
          className={`player-button ${
            player.isPlaying()
              ? 'player-button-playing'
              : auditionPending
                ? 'player-button-arming'
                : 'player-button-paused'
          }`}
          // Enabled whenever a pair is open (sets 37): the press ARMS if
          // the decks don't hold the pair yet — one press, not "wait for
          // ready then press".
          disabled={trackAId === null || trackBId === null}
          title={
            auditionPending ? 'Arming — decks loading; press again to cancel' : undefined
          }
          onClick={onTogglePlay}
        >
          ⏯
        </button>
        <button
          className="player-button"
          title="Swap decks (A ⇄ B) — the reversed pair's own Transitions load"
          disabled={!canSwapDecks}
          onClick={onSwapDecks}
        >
          ⇄
        </button>
        <button
          className={`editor-toggle${tr.tempoMatch ? ' on' : ''}`}
          aria-pressed={tr.tempoMatch}
          title="Tempo match: BPM-match the incoming track to the outgoing for the whole mix"
          onClick={(e) => {
            setTransitionField({ tempoMatch: !tr.tempoMatch });
            e.currentTarget.blur();
          }}
        >
          TEMPO
        </button>
        <button
          className={`editor-toggle${snap ? ' on' : ''}`}
          aria-pressed={snap}
          title="Snap: gestures land on beat guides (shift suspends)"
          onClick={(e) => {
            store.setSnap(!snap);
            e.currentTarget.blur();
          }}
        >
          SNAP
        </button>
      </div>
      {/* Row 2: Transition selection + templates + pair-link. */}
      <div className="editor-center-row">
        <TransitionSwitcher
          items={store.liveItems()}
          active={session.active}
          onNavigate={(dir) => store.navigateTransition(dir)}
          onRename={(name) => store.renameActive(name)}
          onToggleFavorite={() => store.toggleFavorite()}
          onDelete={() => store.deleteActive()}
        />
        <TemplatesDropdown
          templates={templates}
          canSave={canSaveTemplate}
          saveDisabledReason={saveDisabledReason}
          canApply={pairLoaded}
          onApply={applyTemplateToPair}
          onSaveCurrent={() => setSaveModalOpen(true)}
          onRename={(tpl, name) => saveTemplate({ ...tpl, name })}
          onDelete={deleteTemplate}
        />
        {/* Linked (linked-pairs 01): symmetric pair fact, independent of
            the ★ on the active Transition. */}
        <LinkToggle aTrackId={trackAId} bTrackId={trackBId} />
      </div>
      {notices.length > 0 && (
        <div className="editor-notices" title="Dismiss" onClick={() => setNotices([])}>
          {notices.map((n, i) => (
            <div key={i}>{n}</div>
          ))}
        </div>
      )}
      {/* Row 3: beat-domain readouts (issue 18) — display-only; the timeline
          gestures are the manipulation surface. Seconds live in the tooltip;
          a gridless track's fields fall back to time (dimmed). */}
      <div className="editor-center-row editor-readouts">
        <Readout
          label="start"
          beatValue={sideA.beatgrid ? barBeatLabel(sideA.beatgrid, tr.startSec) : null}
          seconds={tr.startSec}
        />
        <Readout
          label="length"
          beatValue={
            sideA.beatgrid ? lengthBeatsLabel(sideA.beatgrid, tr.startSec, tr.durationSec) : null
          }
          seconds={tr.durationSec}
        />
        <Readout
          label="B entry"
          beatValue={sideB.beatgrid ? bEntryLabel(sideB.beatgrid, tr.bInSec) : null}
          seconds={tr.bInSec}
        />
      </div>
      {takeDraft && (
        <div className="editor-center-row editor-take-banner">
          <span>Reviewing a Take — unsaved until promoted</span>
          <button className="editor-take-promote" onClick={promoteTake}>
            Promote to library
          </button>
          <button className="editor-take-discard" onClick={() => store.discardTakeDraft()}>
            Discard
          </button>
        </div>
      )}

      {saveModalOpen && canSaveTemplate && (
        <SaveTemplateModal
          defaultName={activeItemName && !/^Transition \d+$/.test(activeItemName) ? activeItemName : ''}
          sideA={sideA}
          sideB={sideB}
          trackATitle={trackATitle}
          trackBTitle={trackBTitle}
          transition={tr}
          rateB={rateB}
          onSave={saveCurrentAsTemplate}
          onCancel={() => setSaveModalOpen(false)}
        />
      )}
    </div>
  );
}
