/**
 * PROTOTYPE (mix-editor) — throwaway. Delete or absorb after the verdict.
 * Open with ?proto=mix. Two-track arranger: pick tracks, drag the transition
 * region on the ruler, draw lanes, press play.
 *
 * Assumption (stated per prototype skill): single variant, not multiple UI
 * variations — the research questions are lane-drawing feel and playback
 * conviction, not layout exploration.
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
import { MixProtoPlayer } from './MixProtoPlayer';
import { DawTimeline } from './DawTimeline';
import { DeckCard } from './DeckCard';
import { DEFAULT_PAIR, LAST_PAIR_KEY, loadPairStore, savePairStore } from './pairStore';
import type { PairStore, SavedTransition } from './pairStore';
import {
  DEFAULT_LANE_IDS,
  LANE_IDS,
  defaultMix,
  lanePoints,
  slideB,
  slideBToCue,
  tempoMatchPitch,
} from './mixProtoModel';
import type { LaneId, LanePoint, ProtoMix } from './mixProtoModel';
import type { Track } from '../types';
import './mixEditorProto.css';

export default function MixEditorProto() {
  const [mix, setMix] = useState<ProtoMix>(defaultMix);
  const [player] = useState(() => new MixProtoPlayer(defaultMix()));
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

  // Saved Transitions per ordered pair (zero-ceremony: "Transition 1" always
  // exists; edits autosave to the active one).
  const [pairStore, setPairStore] = useState<PairStore>(loadPairStore);
  const pairKey = trackA && trackB ? `${trackA.id}:${trackB.id}` : null;
  const pairEntry = pairKey ? pairStore[pairKey] : undefined;

  // Keep the player's model current (immediately — audio correctness).
  useEffect(() => {
    player.setMix(mix);
  }, [mix, player]);

  // Autosave to the active saved Transition, DEBOUNCED: the store write
  // stringifies the whole pair store into localStorage, and doing that at
  // drag rate (~60Hz) was the biggest main-thread cost during any drag.
  // The pending edit is flushed before anything reads or repoints the
  // store (transition switch/create, unmount).
  const pendingSaveRef = useRef<{ pairKey: string; mix: ProtoMix } | null>(null);
  const flushAutosave = useCallback(() => {
    const p = pendingSaveRef.current;
    if (!p) return;
    pendingSaveRef.current = null;
    setPairStore((store) => {
      const entry = store[p.pairKey] ?? {
        items: [{ name: 'Transition 1', transition: p.mix.transition }],
        active: 0,
      };
      const items = [...entry.items];
      items[entry.active] = {
        ...items[entry.active],
        transition: p.mix.transition,
      };
      const next = { ...store, [p.pairKey]: { ...entry, items } };
      savePairStore(next);
      return next;
    });
  }, []);
  useEffect(() => {
    if (!pairKey) return;
    pendingSaveRef.current = { pairKey, mix };
    const t = setTimeout(flushAutosave, 300);
    return () => clearTimeout(t);
  }, [mix, pairKey, flushAutosave]);
  // Unmount: don't lose the last ≤300ms of edits.
  useEffect(() => () => flushAutosave(), [flushAutosave]);

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

  // When a (new) pair is assembled, load its active saved Transition —
  // creating "Transition 1" from the defaults if the pair is fresh.
  const loadedPairKey = useRef<string | null>(null);
  useEffect(() => {
    if (!pairKey || pairKey === loadedPairKey.current) return;
    flushAutosave(); // pending edits belong to the previous pair
    loadedPairKey.current = pairKey;
    localStorage.setItem(LAST_PAIR_KEY, pairKey);
    const entry = pairStore[pairKey];
    if (entry) {
      const item = entry.items[entry.active];
      setMix((m) => ({ ...m, transition: structuredClone(item.transition) }));
    } else {
      setMix((m) => ({ ...m, transition: defaultMix().transition }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairKey]);

  const switchTransition = (index: number) => {
    if (!pairKey || !pairEntry) return;
    const item = pairEntry.items[index];
    if (!item) return;
    flushAutosave(); // a pending edit targets the OLD active slot
    setPairStore((store) => {
      const next = { ...store, [pairKey]: { ...store[pairKey], active: index } };
      savePairStore(next);
      return next;
    });
    setMix((m) => ({ ...m, transition: structuredClone(item.transition) }));
  };

  const createTransition = () => {
    if (!pairKey || !pairEntry) return;
    flushAutosave(); // a pending edit targets the OLD active slot
    const item: SavedTransition = {
      name: `Transition ${pairEntry.items.length + 1}`,
      transition: defaultMix().transition,
    };
    setPairStore((store) => {
      const entry = store[pairKey];
      const next = {
        ...store,
        [pairKey]: { items: [...entry.items, item], active: entry.items.length },
      };
      savePairStore(next);
      return next;
    });
    setMix((m) => ({ ...m, transition: structuredClone(item.transition) }));
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
    <div className="mixproto">
      {/* Top panel: the transition editor (sibling of Library / Performance) */}
      <div className="mixproto-top">
        <div className="mixproto-arranger">
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
          <div className="mixproto-infobar">
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

            <div className="mixproto-center">
              <div className="mixproto-center-row">
                <button
                  className={`player-button ${
                    player.isPlaying() ? 'player-button-playing' : 'player-button-paused'
                  }`}
                  disabled={!player.ready()}
                  onClick={() => player.togglePlay()}
                >
                  ⏯
                </button>
                {pairEntry && (
                  <select
                    className="mixproto-transition-select"
                    value={pairEntry.active}
                    onChange={(e) => {
                      if (e.target.value === 'new') createTransition();
                      else switchTransition(Number(e.target.value));
                    }}
                  >
                    {pairEntry.items.map((item, i) => (
                      <option key={i} value={i}>
                        {item.name}
                      </option>
                    ))}
                    <option value="new">+ create new</option>
                  </select>
                )}
              </div>
              <div className="mixproto-center-row">
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
              <div className="mixproto-center-row">
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
                <button
                  className="mixproto-resetbtn"
                  title="Reset this Transition to the defaults (envelopes, window, entry)"
                  onClick={() => setMix((m) => ({ ...m, transition: defaultMix().transition }))}
                >
                  reset
                </button>

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
      <div className="mixproto-library">{browsePanel}</div>
    </div>
  );
}
