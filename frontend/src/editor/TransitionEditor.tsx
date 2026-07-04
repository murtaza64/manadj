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
import { useMixer } from '../hooks/useMixer';
import { MixPlayer } from './MixPlayer';
import { DawTimeline } from './DawTimeline';
import { DeckCard } from './DeckCard';
import { TransitionSwitcher } from './TransitionSwitcher';
import {
  DEFAULT_PAIR,
  LAST_PAIR_KEY,
  freshTransition,
  isPristine,
  loadPairStore,
  savePairStore,
  toStoredEntry,
} from './pairStore';
import type { PairStore, SavedTransition } from './pairStore';
import {
  DEFAULT_LANE_IDS,
  LANE_IDS,
  defaultMix,
  lanePoints,
  slideB,
  slideBToCue,
  tempoMatchPitch,
} from './mixModel';
import type { LaneId, LanePoint, EditorMix } from './mixModel';
import type { Track } from '../types';
import './transitionEditor.css';

export default function TransitionEditor() {
  const [mix, setMix] = useState<EditorMix>(defaultMix);
  const [player] = useState(() => new MixPlayer(defaultMix()));
  useEffect(() => () => player.dispose(), [player]);

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
  const [snap, setSnap] = useState(true);
  /** Locked window (glossary): during a Slide the window rides the slid
   * track; unlocked it stays with the other track. */
  const [lockedWindow, setLockedWindow] = useState(false);

  const { data: beatgridA } = useBeatgridData(trackA?.id ?? null);
  const { data: beatgridB } = useBeatgridData(trackB?.id ?? null);

  // Grid tempo is the BPM source of truth when a grid exists; track BPM is
  // the fallback (performance-data-sync issue 02).
  const bpmA = beatgridA?.data.tempo_changes[0]?.bpm ?? trackA?.bpm ?? null;
  const bpmB = beatgridB?.data.tempo_changes[0]?.bpm ?? trackB?.bpm ?? null;

  // B's playback rate under tempo match (same math as the player's).
  const rateB = mix.transition.tempoMatch ? 1 + tempoMatchPitch(bpmA, bpmB) / 100 : 1;

  // Keep the player's tempo-match inputs on the grid-derived values (it gets
  // track BPM at load time, before the beatgrid query resolves).
  useEffect(() => {
    player.setBpm('A', bpmA);
    player.setBpm('B', bpmB);
  }, [player, bpmA, bpmB]);

  // Saved Transitions per ordered pair. LAZY PERSISTENCE (transition-
  // library 01): the SESSION list below is the working set — it may hold
  // pristine (never-edited) Transitions that exist only in memory; the
  // store only ever receives materialized ones (toStoredEntry filters).
  const [pairStore, setPairStore] = useState<PairStore>(loadPairStore);
  const pairKey = trackA && trackB ? `${trackA.id}:${trackB.id}` : null;
  const [session, setSession] = useState<{ items: SavedTransition[]; active: number }>(() => ({
    items: [freshTransition([])],
    active: 0,
  }));
  /** Session items with the live mix folded into the active one. */
  const liveItems = useCallback(
    (s: { items: SavedTransition[]; active: number }, m: EditorMix) =>
      s.items.map((it, i) => (i === s.active ? { ...it, transition: m.transition } : it)),
    []
  );

  // Keep the player's model current (immediately — audio correctness).
  useEffect(() => {
    player.setMix(mix);
  }, [mix, player]);

  // Persist DEBOUNCED (store writes stringify everything into localStorage;
  // doing that at drag rate was the biggest main-thread cost during drags),
  // flushed before pair switches and on unmount. Pristine items never reach
  // the store; a pair whose session is entirely pristine is deleted.
  const pendingSaveRef = useRef<{
    pairKey: string;
    items: SavedTransition[];
    active: number;
  } | null>(null);
  const flushPersist = useCallback(() => {
    const p = pendingSaveRef.current;
    if (!p) return;
    pendingSaveRef.current = null;
    setPairStore((store) => {
      const stored = toStoredEntry(p.items, p.active);
      const next = { ...store };
      if (stored) next[p.pairKey] = stored;
      else delete next[p.pairKey];
      savePairStore(next);
      return next;
    });
  }, []);
  useEffect(() => {
    if (!pairKey) return;
    pendingSaveRef.current = { pairKey, items: liveItems(session, mix), active: session.active };
    const t = setTimeout(flushPersist, 300);
    return () => clearTimeout(t);
  }, [mix, session, pairKey, flushPersist, liveItems]);
  // Unmount: don't lose the last ≤300ms of edits.
  useEffect(() => () => flushPersist(), [flushPersist]);

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
      setMix((m) => ({ ...m, [deck === 'A' ? 'trackAId' : 'trackBId']: track.id }));
      void player.loadTrack(deck, { id: track.id, bpm: track.bpm ?? null });
      const shared = sharedDecksRef.current[deck];
      if (shared.loadedTrack?.id !== track.id) shared.loadTrack(track);
    },
    [player]
  );

  // Deck B slides (issue 11): hot cue / beat jump gestures realign the
  // pair — exactly one deck re-cues, the playhead's mix position never
  // moves. The lock decides which side the window sticks to (PRD table).
  // Slides are exact: the snap toggle does not quantize them.
  const slideDeckB = useCallback(
    (kind: 'cue' | 'beats', value: number) => {
      const playhead = player.getMixTime();
      const mut =
        kind === 'cue'
          ? slideBToCue(mix.transition, value, playhead, lockedWindow, rateB)
          : slideB(mix.transition, value, lockedWindow, rateB);
      const next = { ...mix, transition: { ...mix.transition, ...mut } };
      setMix(next);
      // Push to the player NOW (not on the next render) so the re-park
      // below sees the new alignment. Playing decks re-cue via soft sync.
      player.setMix(next);
      if (!player.isPlaying()) player.seek(playhead);
    },
    [player, mix, lockedWindow, rateB]
  );

  // Fine alignment nudge (issue 09): move a track ±deltaSec relative to the
  // other. B moves together with the transition frame (bMove-drag
  // semantics: startSec shifts, bInSec stays). A anchors the mix axis and
  // cannot move, so nudging A shifts frame+B the opposite way — the same
  // relative alignment change, seen from A.
  const nudgeTrack = useCallback((deck: 'A' | 'B', deltaSec: number) => {
    const shift = deck === 'B' ? deltaSec : -deltaSec;
    setMix((m) => ({
      ...m,
      transition: { ...m.transition, startSec: Math.max(0, m.transition.startSec + shift) },
    }));
  }, []);

  // When a (new) pair is assembled, seed the session from the store —
  // or with a pristine "Transition 1" that exists only in memory until a
  // real edit materializes it (merely-opened pairs leave no trace).
  const loadedPairKey = useRef<string | null>(null);
  useEffect(() => {
    if (!pairKey || pairKey === loadedPairKey.current) return;
    flushPersist(); // pending edits belong to the previous pair
    loadedPairKey.current = pairKey;
    localStorage.setItem(LAST_PAIR_KEY, pairKey);
    const entry = pairStore[pairKey];
    const items = entry ? structuredClone(entry.items) : [freshTransition([])];
    const active = entry ? Math.min(entry.active, items.length - 1) : 0;
    setSession({ items, active });
    setMix((m) => ({ ...m, transition: structuredClone(items[active].transition) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairKey]);

  /** Navigate the session (◀/▶). Leaving a pristine Transition discards it
   * silently; ▶ past the last creates a fresh pristine one. */
  const navigateTransition = (dir: -1 | 1) => {
    const items = liveItems(session, mix);
    const cur = items[session.active];
    let target = session.active + dir;
    if (target >= items.length) {
      // Past the end = new take (no-op when the current one IS fresh).
      if (isPristine(cur)) return;
      const fresh = freshTransition(items);
      setSession({ items: [...items, fresh], active: items.length });
      setMix((m) => ({ ...m, transition: structuredClone(fresh.transition) }));
      return;
    }
    if (target < 0) return;
    let nextItems = items;
    if (isPristine(cur) && items.length > 1) {
      // Evaporate the untouched take on the way out.
      nextItems = items.filter((_, i) => i !== session.active);
      if (session.active < target) target -= 1;
      target = Math.max(0, Math.min(target, nextItems.length - 1));
    }
    setSession({ items: nextItems, active: target });
    setMix((m) => ({ ...m, transition: structuredClone(nextItems[target].transition) }));
  };

  const renameTransition = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSession((s) => ({
      ...s,
      items: s.items.map((it, i) => (i === s.active ? { ...it, name: trimmed } : it)),
    }));
  };

  const toggleFavorite = () => {
    setSession((s) => ({
      ...s,
      items: s.items.map((it, i) => (i === s.active ? { ...it, favorite: !it.favorite } : it)),
    }));
  };

  /** Delete the active Transition (the switcher does the two-step confirm).
   * Last one → re-init blank (the old reset's feel); else land on next. */
  const deleteTransition = () => {
    const items = liveItems(session, mix).filter((_, i) => i !== session.active);
    const nextItems = items.length > 0 ? items : [freshTransition([])];
    const active = Math.min(session.active, nextItems.length - 1);
    setSession({ items: nextItems, active });
    setMix((m) => ({ ...m, transition: structuredClone(nextItems[active].transition) }));
  };

  // One audible surface AND one running audio clock at a time (issue 08):
  // a second live AudioContext makes both contexts' clocks stutter, which
  // the drift corrector converts into audible re-seeks. Suspend the shared
  // Mixer's context while the editor is mounted; deck play resumes it on
  // demand after we leave.
  const sharedMixer = useMixer();
  useEffect(() => {
    sharedMixer.suspend();
    return () => sharedMixer.resume();
  }, [sharedMixer]);

  // Adopt tracks on entry, per slot: the shared deck's loaded track wins
  // (mode switches carry the pair), else the saved last pair (refresh
  // straight into the editor — provider restore may still be in flight),
  // else the prototyping default pair. Pause both shared decks — one
  // audible surface at a time.
  useEffect(() => {
    sharedDecks.A.engine.pause();
    sharedDecks.B.engine.pause();
    const last = localStorage.getItem(LAST_PAIR_KEY);
    const lastIds = last ? last.split(':').map(Number) : null;
    const anySource =
      sharedDecks.A.loadedTrack || sharedDecks.B.loadedTrack || lastIds !== null;
    for (const [deck, i] of [['A', 0], ['B', 1]] as const) {
      const shared = sharedDecks[deck].loadedTrack;
      const fallbackId = anySource ? lastIds?.[i] : DEFAULT_PAIR[deck === 'A' ? 'a' : 'b'];
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

  const setLane = useCallback((id: LaneId, points: LanePoint[] | null) => {
    setMix((m) => {
      const lanes = { ...m.transition.lanes };
      if (points === null) delete lanes[id];
      else lanes[id] = points;
      return { ...m, transition: { ...m.transition, lanes } };
    });
  }, []);

  /** Remove a lane from the editor: the envelope stays in `lanes` (re-add
   * restores it) but reads as default during playback (model semantics). */
  const hideLane = useCallback((id: LaneId) => {
    setMix((m) => ({
      ...m,
      transition: {
        ...m.transition,
        hiddenLanes: [...new Set([...(m.transition.hiddenLanes ?? []), id])],
      },
    }));
  }, []);

  /** (Re-)add a lane: unhide, and materialize its points so it's drawn-on
   * (existing envelope wins over the default shape). */
  const addLane = useCallback((id: LaneId) => {
    setMix((m) => ({
      ...m,
      transition: {
        ...m.transition,
        hiddenLanes: (m.transition.hiddenLanes ?? []).filter((h) => h !== id),
        lanes: {
          ...m.transition.lanes,
          [id]: lanePoints(m.transition.lanes, id, m.transition.durationSec),
        },
      },
    }));
  }, []);

  const visibleLanes = useMemo(() => {
    const drawn = Object.keys(mix.transition.lanes) as LaneId[];
    const hidden = new Set(mix.transition.hiddenLanes ?? []);
    return [...new Set([...DEFAULT_LANE_IDS, ...drawn])].filter((id) => !hidden.has(id));
  }, [mix.transition.lanes, mix.transition.hiddenLanes]);

  const addableLanes = LANE_IDS.filter((id) => !visibleLanes.includes(id));

  const snapA = player.engineA.getSnapshot();
  const snapB = player.engineB.getSnapshot();
  const tr = mix.transition;

  return (
    <div className="editor-root">
      {/* Top panel: the transition editor (sibling of Library / Performance) */}
      <div className="editor-top">
        <div className="editor-arranger">
          <DawTimeline
            mix={mix}
            player={player}
            trackAId={trackA?.id ?? null}
            trackBId={trackB?.id ?? null}
            clockA={clockA}
            clockB={clockB}
            beatgridA={beatgridA?.data ?? null}
            beatgridB={beatgridB?.data ?? null}
            rateB={rateB}
            snap={snap}
            lockedWindow={lockedWindow}
            visibleLanes={visibleLanes}
            onLaneChange={setLane}
            onLaneHide={hideLane}
            onChange={setMix}
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
              onNudgeTrack={(d) => nudgeTrack('A', d)}
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
                  items={liveItems(session, mix)}
                  active={session.active}
                  onNavigate={navigateTransition}
                  onRename={renameTransition}
                  onToggleFavorite={toggleFavorite}
                  onDelete={deleteTransition}
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
                    onChange={(e) =>
                      setMix((m) => ({
                        ...m,
                        transition: { ...m.transition, startSec: Number(e.target.value) },
                      }))
                    }
                  />
                </label>
                <label>
                  length
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    value={tr.durationSec.toFixed(1)}
                    onChange={(e) =>
                      setMix((m) => ({
                        ...m,
                        transition: { ...m.transition, durationSec: Number(e.target.value) },
                      }))
                    }
                  />
                </label>
                <label>
                  B entry
                  <input
                    type="number"
                    step={0.5}
                    value={tr.bInSec.toFixed(1)}
                    onChange={(e) =>
                      setMix((m) => ({
                        ...m,
                        transition: { ...m.transition, bInSec: Number(e.target.value) },
                      }))
                    }
                  />
                </label>
              </div>
              <div className="editor-center-row">
                <label>
                  <input
                    type="checkbox"
                    checked={tr.tempoMatch}
                    onChange={(e) =>
                      setMix((m) => ({
                        ...m,
                        transition: { ...m.transition, tempoMatch: e.target.checked },
                      }))
                    }
                  />
                  tempo match
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={snap}
                    onChange={(e) => setSnap(e.target.checked)}
                  />
                  snap
                </label>
                {addableLanes.length > 0 && (
                  <select
                    value=""
                    onChange={(e) => {
                      const id = e.target.value as LaneId;
                      if (id) addLane(id);
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

            <DeckCard
              deck="B"
              track={trackB}
              player={player}
              loadState={snapB.loadState}
              effectiveBpm={bpmB !== null ? bpmB * rateB : null}
              pitchPercent={(rateB - 1) * 100}
              onBpmSaved={(bpm) => setTrackB((t) => (t ? { ...t, bpm } : t))}
              onNudgeTrack={(d) => nudgeTrack('B', d)}
              gestures={{
                kind: 'slide',
                toCue: (cueSec) => slideDeckB('cue', cueSec),
                // n of B's OWN beats → B-track seconds via base BPM.
                beats: (n) => bpmB && slideDeckB('beats', (n * 60) / bpmB),
                enabled: bpmB !== null && bpmB > 0,
              }}
              lock={{ on: lockedWindow, toggle: () => setLockedWindow((v) => !v) }}
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
