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
  registerSurface,
  releaseAudible,
  unregisterSurface,
} from '../playback/audibleSurface';
import { MixPlayer } from './MixPlayer';
import { DawTimeline } from './DawTimeline';
import { DeckCard } from './DeckCard';
import { TransitionSwitcher } from './TransitionSwitcher';
import { TemplatesDropdown } from './TemplatesDropdown';
import { SaveTemplateModal } from './SaveTemplateModal';
import type { SaveTemplateResult } from './SaveTemplateModal';
import { barBeatLabel, bEntryLabel, lengthBeatsLabel } from './beatReadout';
import { beatsToSeconds } from './gestureMath';
import { EditorStore, useEditorSelector } from './editorStore';
import { LAST_PAIR_KEY, initTransitionStore } from './pairStore';
import { applyTemplate, stripTemplateLanes } from './templateModel';
import type { TrackSideInfo, TransitionTemplate } from './templateModel';
import {
  deleteTemplate,
  initTemplateStore,
  saveTemplate,
  snapshotTemplates,
  subscribeTemplates,
} from './templateStore';
import {
  EDITOR_PITCH_RANGE_PERCENT,
  LANE_IDS,
  defaultMix,
  tempoMatchPitch,
  visibleLaneIds,
} from './mixModel';
import type { LaneId, Transition } from './mixModel';
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
  const [player] = useState(() => new MixPlayer(defaultMix()));
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
  // the fallback (performance-data-sync issue 02).
  const bpmA = beatgridA?.data.tempo_changes[0]?.bpm ?? trackA?.bpm ?? null;
  const bpmB = beatgridB?.data.tempo_changes[0]?.bpm ?? trackB?.bpm ?? null;

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

  // Shared decks: the canonical loaded pair across modes. Editor loads
  // mirror onto them (issue 07) so Performance/Library show the same tracks;
  // read through a ref so assignTrack stays identity-stable for the
  // keyboard effect.
  const sharedDecks = useDecks();
  const sharedDecksRef = useRef(sharedDecks);
  useEffect(() => {
    sharedDecksRef.current = sharedDecks;
  });

  const assignTrack = useCallback(
    (deck: 'A' | 'B', track: Track) => {
      if (deck === 'A') setTrackA(track);
      else setTrackB(track);
      store.setTrackId(deck, track.id);
      void player.loadTrack(deck, { id: track.id, bpm: track.bpm ?? null });
      const shared = sharedDecksRef.current[deck];
      if (shared.loadedTrack?.id !== track.id) shared.loadTrack(track);
    },
    [store, player]
  );

  // Swap the loaded pair (issue 29): A's track to deck B and vice versa —
  // one gesture instead of two re-loads when the pair is backwards. The
  // pair key reverses, so the session re-seeds from the REVERSED pair's
  // saved Transitions via the normal loadPair rules (old direction flushes
  // first; nothing is mirrored — direction is meaning).
  const swapDecks = useCallback(() => {
    const a = trackA;
    const b = trackB;
    if (!a || !b) return;
    assignTrack('A', b);
    assignTrack('B', a);
  }, [trackA, trackB, assignTrack]);

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

  // One audible surface AND one running audio clock at a time (issue 08):
  // claim audibility while mounted (ADR 0013). The arbiter silences the
  // shared surface (pauses both decks, suspends its context) and restores
  // it on release; hardware gestures route to the MixPlayer meanwhile
  // (both PLAYs = the one mix transport, keyboard-parity with Space; CUE
  // has no editor meaning and drops, like F). Pads carry the editor's
  // gesture semantics (ADR 0019); release is absent — editor gestures are
  // taps, so the up edge drops.
  useEffect(() => {
    registerSurface('editor', {
      transport: { togglePlay: () => player.togglePlay() },
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
          else slide('beats', beatsToSeconds(n, bpm));
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
      silence: () => {
        player.pause();
        player.mixer.suspend();
      },
      wake: () => player.mixer.resume(),
    });
    claimAudible('editor');
    return () => {
      releaseAudible('editor');
      unregisterSurface('editor');
    };
  }, [player, midiJogA, midiJogB]);

  // Adopt tracks on entry, per slot: the shared deck's loaded track wins
  // (mode switches carry the pair), else the saved last pair (refresh
  // straight into the editor — provider restore may still be in flight);
  // otherwise the deck stays empty. (Silencing the shared surface is the
  // arbiter's job now — the claim above pauses both shared decks.)
  useEffect(() => {
    const last = localStorage.getItem(LAST_PAIR_KEY);
    const lastIds = last ? last.split(':').map(Number) : null;
    for (const [deck, i] of [['A', 0], ['B', 1]] as const) {
      const shared = sharedDecks[deck].loadedTrack;
      const fallbackId = lastIds?.[i];
      if (shared) {
        assignTrack(deck, shared);
      } else if (fallbackId !== undefined && fallbackId !== null && !Number.isNaN(fallbackId)) {
        api.tracks.getById(fallbackId).then((t: Track) => assignTrack(deck, t)).catch(() => undefined);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      // The editor's selects (saved-Transition dropdown, add-lane) keep
      // their native arrow/space behavior.
      if ((e.target as HTMLElement | null)?.tagName === 'SELECT') return;
      switch (e.key) {
        case ' ':
          e.preventDefault();
          e.stopPropagation();
          player.togglePlay();
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
  }, [player]);

  const snapA = player.engineA.getSnapshot();
  const snapB = player.engineB.getSnapshot();

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
              loadState={snapA.loadState}
              effectiveBpm={bpmA}
              pitchPercent={0}
              onBpmSaved={(bpm) => setTrackA((t) => (t ? { ...t, bpm } : t))}
              onAlignmentNudge={(d) => store.alignmentNudge('A', d)}
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
              sideA={sideA}
              sideB={sideB}
              bpmA={bpmA}
              bpmB={bpmB}
              rateB={rateB}
              trackATitle={trackA?.title ?? 'A'}
              trackBTitle={trackB?.title ?? 'B'}
              pairLoaded={pairKey !== null}
              onSwapDecks={swapDecks}
              canSwapDecks={trackA !== null && trackB !== null}
            />

            <DeckCard
              deck="B"
              track={trackB}
              player={player}
              loadState={snapB.loadState}
              effectiveBpm={bpmB !== null ? bpmB * rateB : null}
              pitchPercent={(rateB - 1) * 100}
              onBpmSaved={(bpm) => setTrackB((t) => (t ? { ...t, bpm } : t))}
              onAlignmentNudge={(d) => store.alignmentNudge('B', d)}
              gestures={{
                kind: 'slide',
                toCue: (cueSec) => slideDeckB('cue', cueSec),
                // n of B's OWN beats → B-track seconds via base BPM.
                beats: (n) => bpmB && slideDeckB('beats', beatsToSeconds(n, bpmB)),
                enabled: bpmB !== null && bpmB > 0,
              }}
              lock={{ on: lockedWindow, toggle: () => store.toggleLockedWindow() }}
            />
          </div>
        </div>
      </div>

      {/* Bottom panel: the shared library browse surface (scoped to shared
          deck A — the editor's own audio runs on its private Mixer). Load
          affordances match the Performance view: hover row buttons,
          double-click → A, arrow keys. */}
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
  sideA,
  sideB,
  bpmA,
  bpmB,
  rateB,
  trackATitle,
  trackBTitle,
  pairLoaded,
  onSwapDecks,
  canSwapDecks,
}: {
  store: EditorStore;
  player: MixPlayer;
  sideA: TrackSideInfo;
  sideB: TrackSideInfo;
  bpmA: number | null;
  bpmB: number | null;
  rateB: number;
  trackATitle: string;
  trackBTitle: string;
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
  const tr = mix.transition;
  const visibleLanes = useMemo(() => visibleLaneIds(tr), [tr]);
  const addableLanes = LANE_IDS.filter((id) => !visibleLanes.includes(id));

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
      <div className="editor-center-row">
        <button
          className={`player-button ${
            player.isPlaying() ? 'player-button-playing' : 'player-button-paused'
          }`}
          disabled={!player.ready()}
          onClick={() => player.togglePlay()}
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
      </div>
      {notices.length > 0 && (
        <div className="editor-notices" title="Dismiss" onClick={() => setNotices([])}>
          {notices.map((n, i) => (
            <div key={i}>{n}</div>
          ))}
        </div>
      )}
      {/* Beat-domain readouts (issue 18): display-only — the timeline
          gestures are the manipulation surface. Seconds live in the
          tooltip; a gridless track's fields fall back to time (dimmed). */}
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
      <div className="editor-center-row">
        <label>
          <input
            type="checkbox"
            checked={tr.tempoMatch}
            onChange={(e) => setTransitionField({ tempoMatch: e.target.checked })}
          />
          tempo match
        </label>
        <label>
          <input
            type="checkbox"
            checked={snap}
            onChange={(e) => store.setSnap(e.target.checked)}
          />
          snap
        </label>
        {addableLanes.length > 0 && (
          <select
            value=""
            onChange={(e) => {
              const id = e.target.value as LaneId;
              if (id) store.addLane(id);
            }}
          >
            <option value="">add lane…</option>
            {addableLanes.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        )}
      </div>

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
