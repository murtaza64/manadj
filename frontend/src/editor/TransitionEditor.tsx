/**
 * Transition editor — the top-bar mode for sketching the Transition between
 * two loaded Tracks: a two-track arranger with drawn automation lanes over
 * the overlap window, deterministic playback via MixPlayer, and the saved-
 * Transition switcher (transition library).
 *
 * Graduated from prototype 2026-07-04 (ADR 0010; iteration history in
 * .scratch/mix-editor/NOTES.md).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import { useBeatgridData } from '../hooks/useBeatgridData';
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
import { EditorStore, useEditorSelector } from './editorStore';
import { LAST_PAIR_KEY, initTransitionStore } from './pairStore';
import { LANE_IDS, defaultMix, tempoMatchPitch, visibleLaneIds } from './mixModel';
import type { LaneId, Transition } from './mixModel';
import type { Track } from '../types';
import './transitionEditor.css';

/** Gate on the transition store's boot load (ADR 0011): the inner editor
 * seeds session state from the snapshot in initializers, so it must not
 * mount before init resolves (one localhost fetch — imperceptible). init
 * never rejects; a dead backend degrades to an empty store. */
export default function TransitionEditor() {
  const [storeReady, setStoreReady] = useState(false);
  useEffect(() => {
    let mounted = true;
    void initTransitionStore().then(() => {
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

  // One audible surface AND one running audio clock at a time (issue 08):
  // claim audibility while mounted (ADR 0013). The arbiter silences the
  // shared surface (pauses both decks, suspends its context) and restores
  // it on release; hardware transport routes to the MixPlayer meanwhile
  // (both PLAYs = the one mix transport, keyboard-parity with Space; CUE
  // has no editor meaning and drops, like F).
  useEffect(() => {
    registerSurface('editor', {
      transport: { togglePlay: () => player.togglePlay() },
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
  }, [player]);

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
              onNudgeTrack={(d) => store.nudgeTrack('A', d)}
              gestures={{
                // A ≡ mix axis (sketch origin): its controls are plain
                // transport, not slides (re-decided 2026-07-03 — mirror-A
                // slides duplicated B's under the lock toggle).
                kind: 'jump',
                toCue: (cueSec) => player.seek(cueSec),
                beats: (n) => bpmA && player.seek(player.getMixTime() + (n * 60) / bpmA),
                enabled: bpmA !== null && bpmA > 0,
              }}
            />

            <EditorCenterPanel store={store} player={player} />

            <DeckCard
              deck="B"
              track={trackB}
              player={player}
              loadState={snapB.loadState}
              effectiveBpm={bpmB !== null ? bpmB * rateB : null}
              pitchPercent={(rateB - 1) * 100}
              onBpmSaved={(bpm) => setTrackB((t) => (t ? { ...t, bpm } : t))}
              onNudgeTrack={(d) => store.nudgeTrack('B', d)}
              gestures={{
                kind: 'slide',
                toCue: (cueSec) => slideDeckB('cue', cueSec),
                // n of B's OWN beats → B-track seconds via base BPM.
                beats: (n) => bpmB && slideDeckB('beats', (n * 60) / bpmB),
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

/**
 * Transition controls + switcher: the drag-rate subscriber (reads `mix`),
 * isolated so a lane drag re-renders this small panel and DawTimeline —
 * never the shell (mix-editor 27).
 */
function EditorCenterPanel({ store, player }: { store: EditorStore; player: MixPlayer }) {
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
        <TransitionSwitcher
          items={store.liveItems()}
          active={session.active}
          onNavigate={(dir) => store.navigateTransition(dir)}
          onRename={(name) => store.renameActive(name)}
          onToggleFavorite={() => store.toggleFavorite()}
          onDelete={() => store.deleteActive()}
        />
      </div>
      <div className="editor-center-row">
        <label>
          start
          <input
            type="number"
            min={0}
            step={0.5}
            value={tr.startSec.toFixed(1)}
            onChange={(e) => setTransitionField({ startSec: Number(e.target.value) })}
          />
        </label>
        <label>
          length
          <input
            type="number"
            min={0}
            step={0.5}
            value={tr.durationSec.toFixed(1)}
            onChange={(e) => setTransitionField({ durationSec: Number(e.target.value) })}
          />
        </label>
        <label>
          B entry
          <input
            type="number"
            step={0.5}
            value={tr.bInSec.toFixed(1)}
            onChange={(e) => setTransitionField({ bInSec: Number(e.target.value) })}
          />
        </label>
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
    </div>
  );
}
