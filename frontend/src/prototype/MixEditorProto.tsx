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
import { flushSync } from 'react-dom';
import { api } from '../api/client';
import {
  useBeatgridData,
  useNudgeBeatgrid,
  useSetBeatgridDownbeat,
} from '../hooks/useBeatgridData';
import { useWaveformData } from '../hooks/useWaveformData';
import { useWaveformRenderer } from '../hooks/useWaveformRenderer';
import { useHotCues } from '../hooks/useHotCues';
import { useQueryClient } from '@tanstack/react-query';
import Library from '../components/Library';
import { DeckScope } from '../contexts/DeckContext';
import { useDecks } from '../hooks/useDeck';
import { formatKeyDisplay } from '../utils/keyUtils';
import { MixProtoPlayer } from './MixProtoPlayer';
import {
  DEFAULT_LANE_IDS,
  LANE_IDS,
  cropRemapLanes,
  cropRemapLanesLeft,
  defaultMix,
  lanePoints,
  laneValuesAt,
  nearestTime,
  tempoMatchPitch,
} from './mixProtoModel';
import type { LaneId, LanePoint, Lanes, ProtoMix } from './mixProtoModel';
import type { PlaybackClock } from '../playback/clock';
import type { WaveformDataWebGL } from '../utils/WebGLWaveformRenderer';
import type { BeatgridData, Track } from '../types';
import './mixEditorProto.css';

const PAIR_STORE_KEY = 'PROTOTYPE-transition-editor-pairs';
const LAST_PAIR_KEY = 'PROTOTYPE-transition-editor-last';
/** Storage key of the pre-rework single-mix draft (migrated on load). */
const LEGACY_MIX_KEY = 'PROTOTYPE-mix-editor-mix';
/** Default working pair while prototyping: Weeble Wobble VIP → Last Time. */
const DEFAULT_PAIR = { a: 549, b: 171 };

/** A saved Transition (first-class, per ordered track pair). */
interface SavedTransition {
  name: string;
  bInSec: number;
  transition: ProtoMix['transition'];
}

interface PairEntry {
  items: SavedTransition[];
  active: number;
}

type PairStore = Record<string, PairEntry>;

function loadPairStore(): PairStore {
  let store: PairStore;
  try {
    store = JSON.parse(localStorage.getItem(PAIR_STORE_KEY) ?? '{}');
  } catch {
    store = {};
  }
  // Migrate the pre-rework single-mix draft into the pair store, so work
  // saved before the transition-per-pair model isn't lost.
  try {
    const raw = localStorage.getItem(LEGACY_MIX_KEY);
    if (raw) {
      const legacy = JSON.parse(raw) as ProtoMix;
      if (legacy.trackAId !== null && legacy.trackBId !== null && legacy.transition) {
        const key = `${legacy.trackAId}:${legacy.trackBId}`;
        if (!store[key]) {
          store[key] = {
            items: [
              { name: 'Transition 1', bInSec: legacy.bInSec ?? 0, transition: legacy.transition },
            ],
            active: 0,
          };
          savePairStore(store);
        }
        if (!localStorage.getItem(LAST_PAIR_KEY)) {
          localStorage.setItem(LAST_PAIR_KEY, key);
        }
      }
      localStorage.removeItem(LEGACY_MIX_KEY);
    }
  } catch {
    /* legacy blob unreadable — nothing to migrate */
  }
  return store;
}

function savePairStore(store: PairStore): void {
  localStorage.setItem(PAIR_STORE_KEY, JSON.stringify(store));
}

const LANE_COLORS: Record<LaneId, string> = {
  faderA: '#00e5ff',
  faderB: '#ff2d95',
  eqLowA: '#ffe600',
  eqLowB: '#ff6b00',
  eqMidA: '#39ff14',
  eqMidB: '#14ff9e',
  eqHighA: '#b14bff',
  eqHighB: '#ff4b6e',
  filterA: '#4b9fff',
  filterB: '#ffb14b',
};

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

  // Keep the player's model current + autosave to the active saved Transition.
  useEffect(() => {
    player.setMix(mix);
    if (!pairKey) return;
    setPairStore((store) => {
      const entry = store[pairKey] ?? {
        items: [{ name: 'Transition 1', bInSec: mix.bInSec, transition: mix.transition }],
        active: 0,
      };
      const items = [...entry.items];
      items[entry.active] = {
        ...items[entry.active],
        bInSec: mix.bInSec,
        transition: mix.transition,
      };
      const next = { ...store, [pairKey]: { ...entry, items } };
      savePairStore(next);
      return next;
    });
  }, [mix, player, pairKey]);

  const assignTrack = useCallback(
    (deck: 'A' | 'B', track: Track) => {
      if (deck === 'A') setTrackA(track);
      else setTrackB(track);
      setMix((m) => ({ ...m, [deck === 'A' ? 'trackAId' : 'trackBId']: track.id }));
      void player.loadTrack(deck, { id: track.id, bpm: track.bpm ?? null });
    },
    [player]
  );

  // When a (new) pair is assembled, load its active saved Transition —
  // creating "Transition 1" from the defaults if the pair is fresh.
  const loadedPairKey = useRef<string | null>(null);
  useEffect(() => {
    if (!pairKey || pairKey === loadedPairKey.current) return;
    loadedPairKey.current = pairKey;
    localStorage.setItem(LAST_PAIR_KEY, pairKey);
    const entry = pairStore[pairKey];
    if (entry) {
      const item = entry.items[entry.active];
      setMix((m) => ({ ...m, bInSec: item.bInSec, transition: structuredClone(item.transition) }));
    } else {
      const fresh = defaultMix();
      setMix((m) => ({ ...m, bInSec: fresh.bInSec, transition: fresh.transition }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairKey]);

  const switchTransition = (index: number) => {
    if (!pairKey || !pairEntry) return;
    const item = pairEntry.items[index];
    if (!item) return;
    setPairStore((store) => {
      const next = { ...store, [pairKey]: { ...store[pairKey], active: index } };
      savePairStore(next);
      return next;
    });
    setMix((m) => ({ ...m, bInSec: item.bInSec, transition: structuredClone(item.transition) }));
  };

  const createTransition = () => {
    if (!pairKey || !pairEntry) return;
    const fresh = defaultMix();
    const item: SavedTransition = {
      name: `Transition ${pairEntry.items.length + 1}`,
      bInSec: fresh.bInSec,
      transition: fresh.transition,
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
    setMix((m) => ({ ...m, bInSec: item.bInSec, transition: structuredClone(item.transition) }));
  };

  // Restore the last pair on mount; adopt the shared decks' tracks for empty
  // slots (entering the editor from another mode: shared A → slot A, shared
  // B → slot B); pause both shared decks — one audible surface at a time.
  const sharedDecks = useDecks();
  useEffect(() => {
    sharedDecks.A.engine.pause();
    sharedDecks.B.engine.pause();
    const last = localStorage.getItem(LAST_PAIR_KEY);
    if (last) {
      const [aId, bId] = last.split(':').map(Number);
      api.tracks.getById(aId).then((t: Track) => assignTrack('A', t)).catch(() => undefined);
      api.tracks.getById(bId).then((t: Track) => assignTrack('B', t)).catch(() => undefined);
    } else if (sharedDecks.A.loadedTrack || sharedDecks.B.loadedTrack) {
      if (sharedDecks.A.loadedTrack) assignTrack('A', sharedDecks.A.loadedTrack);
      if (sharedDecks.B.loadedTrack) assignTrack('B', sharedDecks.B.loadedTrack);
    } else {
      // Prototyping default pair.
      api.tracks.getById(DEFAULT_PAIR.a).then((t: Track) => assignTrack('A', t)).catch(() => undefined);
      api.tracks.getById(DEFAULT_PAIR.b).then((t: Track) => assignTrack('B', t)).catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Selection in the embedded library panel (load-to-deck source).
  const [browseSel, setBrowseSel] = useState<Track | null>(null);

  // Per-deck clocks for the row canvases (stable identities).
  const clockA = useMemo(() => ({ getPlayhead: () => player.getTrackTime('A') }), [player]);
  const clockB = useMemo(() => ({ getPlayhead: () => player.getTrackTime('B') }), [player]);

  // Space = play/pause. Capture phase + stopPropagation: the embedded
  // library's keyboard hub would otherwise toggle the (invisible) shared
  // deck on the same keypress.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT')) return;
      if (e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        player.togglePlay();
      }
    };
    document.addEventListener('keydown', onKey, { capture: true });
    return () => document.removeEventListener('keydown', onKey, { capture: true });
  }, [player]);

  const setLane = useCallback((id: LaneId, points: LanePoint[] | null) => {
    setMix((m) => {
      const lanes = { ...m.transition.lanes };
      if (points === null) delete lanes[id];
      else lanes[id] = points;
      return { ...m, transition: { ...m.transition, lanes } };
    });
  }, []);

  const visibleLanes = useMemo(() => {
    const drawn = Object.keys(mix.transition.lanes) as LaneId[];
    return [...new Set([...DEFAULT_LANE_IDS, ...drawn])];
  }, [mix.transition.lanes]);

  const addableLanes = LANE_IDS.filter((id) => !visibleLanes.includes(id));

  const snapA = player.engineA.getSnapshot();
  const snapB = player.engineB.getSnapshot();
  const tr = mix.transition;

  return (
    <div className="mixproto">
      {/* Top panel: the transition editor (sibling of Library / Performance) */}
      <div className="mixproto-top">
        <div className="mixproto-header">
          <h1>TRANSITION EDITOR</h1>
          <span className="mixproto-hint">
            space = play · drag B block = move · trim edges = resize (alt = crop lanes, default
            stretches) · wheel = zoom · lanes: click add / drag / dblclick remove
          </span>
          <div className="mixproto-loadbtns">
            <span className="mixproto-selname">
              {browseSel ? browseSel.title || browseSel.filename : 'select a track below'}
            </span>
            <button disabled={!browseSel} onClick={() => browseSel && assignTrack('A', browseSel)}>
              load → A
            </button>
            <button disabled={!browseSel} onClick={() => browseSel && assignTrack('B', browseSel)}>
              load → B
            </button>
          </div>
        </div>

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
            visibleLanes={visibleLanes}
            onLaneChange={setLane}
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
                    min={0}
                    step={0.5}
                    value={mix.bInSec.toFixed(1)}
                    onChange={(e) => setMix((m) => ({ ...m, bInSec: Number(e.target.value) }))}
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
                {addableLanes.length > 0 && (
                  <select
                    value=""
                    onChange={(e) => {
                      const id = e.target.value as LaneId;
                      if (id) setLane(id, lanePoints(mix.transition.lanes, id));
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
            />
          </div>
        </div>
      </div>

      {/* Bottom panel: the shared library browse surface (scoped to shared
          deck A — the editor's own audio runs on its private Mixer). */}
      <div className="mixproto-library">
        <DeckScope deck="A">
          <Library
            browseOnly
            onBrowseSelect={setBrowseSel}
            onOpenPlaylistSync={() => undefined}
          />
        </DeckScope>
      </div>
    </div>
  );
}
/**
 * DAW-style timeline: track rows with viewport-sized sticky canvases whose
 * display window follows scroll/zoom — full rendering resolution at any zoom
 * (no giant canvases). Automation lane strips sit pinned under their deck's
 * row, aligned to the transition region. Overlap = the Transition.
 */
function DawTimeline({
  mix,
  player,
  trackAId,
  trackBId,
  clockA,
  clockB,
  beatgridA,
  beatgridB,
  rateB,
  snap,
  visibleLanes,
  onLaneChange,
  onChange,
}: {
  mix: ProtoMix;
  player: MixProtoPlayer;
  trackAId: number | null;
  trackBId: number | null;
  clockA: PlaybackClock;
  clockB: PlaybackClock;
  beatgridA: BeatgridData | null;
  beatgridB: BeatgridData | null;
  rateB: number;
  snap: boolean;
  visibleLanes: LaneId[];
  onLaneChange: (id: LaneId, points: LanePoint[] | null) => void;
  onChange: React.Dispatch<React.SetStateAction<ProtoMix>>;
}) {
  const [pxPerSec, setPxPerSec] = useState(4);
  /** Horizontal offset in px — the single owner of all horizontal motion.
   * No native scrollbar: wheel and the minimap viewport drive it, and the
   * rAF tick applies it to every layer in the same frame (no tearing). */
  const scrollPxRef = useRef(0);
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const waveWrapARef = useRef<HTMLDivElement>(null);
  const waveWrapBRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const drag = useRef<null | {
    kind: 'bMove' | 'bTrim' | 'aTrim';
    grabOffsetSec: number;
    /** Lane/duration snapshot at drag start — crop remaps derive from these
     * so incremental moves never compound (and toggling alt mid-drag works). */
    origLanes: Lanes;
    origDur: number;
    origStart: number;
  }>(null);

  // Mirrors for native listeners / rAF.
  const pxRef = useRef(pxPerSec);
  const mixRef = useRef(mix);
  /** Wheel input accumulators — consumed once per frame by the rAF tick. */
  const pendingZoomRef = useRef<{ factor: number; clientX: number } | null>(null);
  const wheelGestureRef = useRef<{ axis: 'pan' | 'zoom'; last: number } | null>(null);
  useEffect(() => {
    pxRef.current = pxPerSec;
    mixRef.current = mix;
  });

  const durA = player.engineA.getSnapshot().duration;
  const durB = player.engineB.getSnapshot().duration;
  const tr = mix.transition;
  const aEnd = durA > 0 ? Math.min(tr.startSec + tr.durationSec, durA) : tr.startSec + tr.durationSec;
  // B is time-stretched on the mix axis by its playback rate.
  const bBlockLenMix = Math.max(durB - mix.bInSec, 0) / rateB;
  /** Rightmost content edge: end of the last track. Nothing renders past it. */
  const contentEnd = Math.max(durA, tr.startSec + bBlockLenMix, 10);

  const beatsA = beatgridA?.beat_times;
  const beatsB = beatgridB?.beat_times;
  const snapRef = useRef({ snap, beatsA, beatsB, rateB });
  useEffect(() => {
    snapRef.current = { snap, beatsA, beatsB, rateB };
  });

  // Waveform renderers: one viewport-sized canvas per row, windowed to the
  // visible time range (crisp at any zoom).
  const { data: waveA } = useWaveformData(trackAId);
  const { data: waveB } = useWaveformData(trackBId);
  const { data: hotCuesA = [] } = useHotCues(trackAId);
  const { data: hotCuesB = [] } = useHotCues(trackBId);
  const rowConfig = { isMinimapMode: false, playMarkerPosition: 0 };
  // Driven mode: the rAF tick below calls draw() for both rows right after
  // writing transforms + display windows — one motion clock, layer order
  // guaranteed (self-running renderer loops only aligned by rAF
  // registration luck, and tore when they ran before the tick).
  const rendA = useWaveformRenderer({
    clock: clockA,
    waveformData: waveA,
    config: rowConfig,
    hotCues: hotCuesA,
    beatgrid: beatgridA,
    driven: true,
  });
  const rendB = useWaveformRenderer({
    clock: clockB,
    waveformData: waveB,
    config: rowConfig,
    hotCues: hotCuesB,
    beatgrid: beatgridB,
    driven: true,
  });
  // Mirrors so the tick effect (keyed on [player]) never holds stale draws.
  const drawRowsRef = useRef({ a: rendA.draw, b: rendB.draw });
  useEffect(() => {
    drawRowsRef.current = { a: rendA.draw, b: rendB.draw };
  });

  // Viewport width for the fixed row canvases.
  const [viewW, setViewW] = useState(800);
  useEffect(() => {
    const measure = () => setViewW(viewportRef.current?.clientWidth ?? 800);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // Per-frame, single motion clock: read the scrollbar strip's position once
  // and apply it to EVERYTHING horizontal — content transform, canvas
  // counter-transforms, display windows, playhead. Native scrolling of the
  // content itself would move DOM layers on the compositor thread a frame
  // ahead of the rAF-painted waveforms (visible tearing); a detached
  // scrollbar + same-frame transforms keeps every layer in lockstep.
  useEffect(() => {
    // Frame-time readout for zoom-lag work (?protoperf) — logs the slowest
    // tick each second. Inert without the flag; remove at ride-back.
    const perf = new URLSearchParams(window.location.search).has('protoperf');
    let perfMax = 0;
    let perfLast = performance.now();
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const t0 = perf ? performance.now() : 0;
      const viewport = viewportRef.current;
      if (!viewport) return;
      // Apply at most one accumulated wheel-zoom step per frame. flushSync
      // commits the React re-render (block widths, ruler) NOW, so the
      // transforms/windows painted below use the same px — no torn frames.
      const zoom = pendingZoomRef.current;
      if (zoom) {
        pendingZoomRef.current = null;
        const rect = viewport.getBoundingClientRect();
        const px = pxRef.current;
        const minPx = (rect.width - 2) / contentEndRef.current; // fit = floor
        const next = Math.min(60, Math.max(minPx, px * zoom.factor));
        if (next !== px) {
          const cursorX = zoom.clientX - rect.left;
          const cursorSec = (cursorX + scrollPxRef.current) / px;
          scrollPxRef.current = Math.max(0, cursorSec * next - cursorX);
          pxRef.current = next;
          flushSync(() => setPxPerSec(next));
        }
      }
      const px = pxRef.current;
      // Clamp against the current content extent every frame (zoom changes it).
      const maxScroll = Math.max(0, contentEndRef.current * px - viewport.clientWidth);
      scrollPxRef.current = Math.max(0, Math.min(scrollPxRef.current, maxScroll));
      const scrollPx = scrollPxRef.current;
      if (contentRef.current) {
        contentRef.current.style.transform = `translateX(${-scrollPx}px)`;
      }
      if (waveWrapARef.current) waveWrapARef.current.style.transform = `translateX(${scrollPx}px)`;
      if (waveWrapBRef.current) waveWrapBRef.current.style.transform = `translateX(${scrollPx}px)`;
      if (playheadRef.current) {
        playheadRef.current.style.left = `${player.getMixTime() * px}px`;
      }
      const scrollSec = scrollPx / px;
      const viewSec = viewport.clientWidth / px;
      const m = mixRef.current;
      const s = snapRef.current;
      const dA = player.engineA.getSnapshot().duration;
      if (dA > 0) {
        rendA.rendererRef.current?.setDisplayWindow(scrollSec / dA, (scrollSec + viewSec) / dA);
      }
      const dB = player.engineB.getSnapshot().duration;
      if (dB > 0) {
        const first = (m.bInSec + (scrollSec - m.transition.startSec) * s.rateB) / dB;
        rendB.rendererRef.current?.setDisplayWindow(first, first + (viewSec * s.rateB) / dB);
      }
      // Paint both rows NOW — same frame as the transforms above.
      drawRowsRef.current.a();
      drawRowsRef.current.b();
      if (perf) {
        perfMax = Math.max(perfMax, performance.now() - t0);
        if (t0 - perfLast >= 1000) {
          console.log(`[protoperf] worst tick last 1s: ${perfMax.toFixed(1)}ms`);
          perfMax = 0;
          perfLast = t0;
        }
      }
    };
    tick();
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player]);

  const contentEndRef = useRef(contentEnd);
  useEffect(() => {
    contentEndRef.current = contentEnd;
  });

  const fit = useCallback(() => {
    const w = viewportRef.current?.clientWidth ?? 800;
    scrollPxRef.current = 0;
    setPxPerSec(Math.max(0.05, (w - 2) / contentEndRef.current));
  }, []);

  const didAutoFit = useRef(false);
  useEffect(() => {
    if (!didAutoFit.current && (durA > 0 || durB > 0)) {
      didAutoFit.current = true;
      fit();
    }
  }, [durA, durB, fit]);

  const secAtClientX = (clientX: number) => {
    const el = viewportRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return (clientX - rect.left + scrollPxRef.current) / pxRef.current;
  };

  // Native wheel listener: vertical = zoom around cursor; horizontal = pan.
  // Events only ACCUMULATE into refs here — the rAF tick applies them, so
  // scroll offset, zoom level, DOM widths, and canvas windows all commit in
  // the same frame (mutating state directly per event painted frames with
  // mismatched scroll/zoom pairs: sideways jumps). The gesture axis is
  // latched (pan vs zoom) so a slightly-diagonal trackpad zoom doesn't
  // sprinkle pans between zoom steps.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      // deltaMode: 0 = pixels, 1 = lines, 2 = pages.
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 160 : 1;
      const now = performance.now();
      const latch = wheelGestureRef.current;
      const axis =
        latch && now - latch.last < 150
          ? latch.axis
          : Math.abs(e.deltaX) > Math.abs(e.deltaY)
            ? ('pan' as const)
            : ('zoom' as const);
      wheelGestureRef.current = { axis, last: now };
      if (axis === 'pan') {
        scrollPxRef.current = Math.max(0, scrollPxRef.current + e.deltaX * unit);
        return;
      }
      // Continuous exponential zoom: proportional for fine trackpad deltas
      // and ~1.16x per mouse-wheel notch (1.0015^100).
      const pending = pendingZoomRef.current;
      pendingZoomRef.current = {
        factor: (pending?.factor ?? 1) * Math.pow(1.0015, -e.deltaY * unit),
        clientX: e.clientX,
      };
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  const EDGE_PX = 8;

  const zoneAt = (clientX: number, row: 'A' | 'B'): 'aTrim' | 'bTrim' | 'bMove' | 'seek' => {
    const sec = secAtClientX(clientX);
    const m = mixRef.current;
    const edgeSec = EDGE_PX / pxRef.current;
    if (row === 'A') {
      if (trackAId !== null && Math.abs(sec - (m.transition.startSec + m.transition.durationSec)) < edgeSec) {
        return 'aTrim';
      }
      return 'seek';
    }
    if (trackBId === null) return 'seek';
    if (Math.abs(sec - m.transition.startSec) < edgeSec) return 'bTrim';
    const lenMix = Math.max(durB - m.bInSec, 0) / snapRef.current.rateB;
    if (sec > m.transition.startSec && sec < m.transition.startSec + lenMix) return 'bMove';
    return 'seek';
  };

  const onRowPointerDown = (row: 'A' | 'B') => (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const sec = secAtClientX(e.clientX);
    const zone = zoneAt(e.clientX, row);
    if (zone === 'seek') {
      drag.current = null;
      player.seek(sec);
      return;
    }
    drag.current = {
      kind: zone,
      grabOffsetSec: zone === 'bMove' ? sec - mixRef.current.transition.startSec : 0,
      origLanes: structuredClone(mixRef.current.transition.lanes),
      origDur: mixRef.current.transition.durationSec,
      origStart: mixRef.current.transition.startSec,
    };
  };

  const onRowPointerMove = (row: 'A' | 'B') => (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) {
      const zone = zoneAt(e.clientX, row);
      e.currentTarget.style.cursor =
        zone === 'seek' ? 'pointer' : zone === 'bMove' ? 'grab' : 'ew-resize';
      return;
    }
    const sec = secAtClientX(e.clientX);
    const d = drag.current;
    const s = snapRef.current;
    onChange((m) => {
      if (d.kind === 'bMove') {
        let start = Math.max(0, sec - d.grabOffsetSec);
        if (s.snap && s.beatsA) {
          start = nearestTime(s.beatsA, start) ?? start;
        }
        return { ...m, transition: { ...m.transition, startSec: start } };
      }
      if (d.kind === 'bTrim') {
        // Left-edge resize: the transition END stays anchored; B's content
        // stays anchored (entry trims with the edge, DAW clip-trim style).
        const origEnd = d.origStart + d.origDur;
        const originMix = m.transition.startSec - m.bInSec / s.rateB;
        let bIn = Math.max(0, (sec - originMix) * s.rateB);
        if (s.snap && s.beatsB) {
          bIn = nearestTime(s.beatsB, bIn) ?? bIn;
        }
        bIn = Math.min(Math.max(bIn, 0), Math.max(durB - 0.1, 0));
        const newStart = originMix + bIn / s.rateB;
        const newDur = Math.max(origEnd - newStart, 0);
        // Alt = crop (lanes keep absolute timing); default = stretch.
        const lanes = e.altKey
          ? cropRemapLanesLeft(d.origLanes, d.origDur, newDur)
          : d.origLanes;
        return {
          ...m,
          bInSec: bIn,
          transition: {
            ...m.transition,
            startSec: newStart,
            durationSec: newDur,
            lanes: structuredClone(lanes),
          },
        };
      }
      const maxEnd = durA > 0 ? durA : Infinity;
      let newEnd = Math.min(Math.max(sec, m.transition.startSec), maxEnd);
      if (s.snap && s.beatsA) {
        const snapped = nearestTime(s.beatsA, newEnd);
        if (snapped !== null) newEnd = Math.min(Math.max(snapped, m.transition.startSec), maxEnd);
      }
      const newDur = newEnd - m.transition.startSec;
      // Alt = crop (lanes keep absolute timing); default = stretch (shapes
      // scale with the region — normalized points, no remap). Both derive
      // from the drag-start snapshot.
      const lanes = e.altKey
        ? cropRemapLanes(d.origLanes, d.origDur, newDur)
        : d.origLanes;
      return {
        ...m,
        transition: { ...m.transition, durationSec: newDur, lanes: structuredClone(lanes) },
      };
    });
  };

  const endDrag = () => (drag.current = null);

  // Beat/cue guide lines continued through the lane strips (normalized to the
  // transition window). Non-downbeats hidden when tighter than ~12px.
  const guidesA = useMemo<LaneGuide[]>(() => {
    const out: LaneGuide[] = [];
    const dur = tr.durationSec;
    if (dur <= 0) return out;
    if (beatgridA && beatgridA.beat_times.length > 0) {
      const downs = new Set(beatgridA.downbeat_times);
      const spb =
        beatgridA.beat_times.length > 1
          ? beatgridA.beat_times[1] - beatgridA.beat_times[0]
          : 1;
      const showWeak = spb * pxPerSec >= 12;
      for (const b of beatgridA.beat_times) {
        if (b < tr.startSec || b > tr.startSec + dur) continue;
        const strong = downs.has(b);
        if (!strong && !showWeak) continue;
        out.push({ x: (b - tr.startSec) / dur, strong });
      }
    }
    for (const c of hotCuesA) {
      if (c.time_seconds < tr.startSec || c.time_seconds > tr.startSec + dur) continue;
      out.push({ x: (c.time_seconds - tr.startSec) / dur, strong: true, color: c.color || '#39ff14' });
    }
    return out;
  }, [beatgridA, hotCuesA, tr.startSec, tr.durationSec, pxPerSec]);

  const guidesB = useMemo<LaneGuide[]>(() => {
    const out: LaneGuide[] = [];
    const dur = tr.durationSec;
    if (dur <= 0) return out;
    if (beatgridB && beatgridB.beat_times.length > 0) {
      const downs = new Set(beatgridB.downbeat_times);
      const spb =
        beatgridB.beat_times.length > 1
          ? beatgridB.beat_times[1] - beatgridB.beat_times[0]
          : 1;
      const showWeak = (spb / rateB) * pxPerSec >= 12;
      for (const bt of beatgridB.beat_times) {
        const mixT = tr.startSec + (bt - mix.bInSec) / rateB;
        if (mixT < tr.startSec || mixT > tr.startSec + dur) continue;
        const strong = downs.has(bt);
        if (!strong && !showWeak) continue;
        out.push({ x: (mixT - tr.startSec) / dur, strong });
      }
    }
    for (const c of hotCuesB) {
      const mixT = tr.startSec + (c.time_seconds - mix.bInSec) / rateB;
      if (mixT < tr.startSec || mixT > tr.startSec + dur) continue;
      out.push({ x: (mixT - tr.startSec) / dur, strong: true, color: c.color || '#39ff14' });
    }
    return out;
  }, [beatgridB, hotCuesB, tr.startSec, tr.durationSec, mix.bInSec, rateB, pxPerSec]);

  const laneStrip = (id: LaneId) => (
    <div key={id} className={`mixproto-lanestrip ${id.endsWith('A') ? 'a' : 'b'}`}>
      <span className="mixproto-lanelabel" style={{ color: LANE_COLORS[id] }}>
        {id}
        {id in tr.lanes && (
          <button
            className="mixproto-laneclear"
            title="reset lane"
            onClick={() => onLaneChange(id, null)}
          >
            ×
          </button>
        )}
      </span>
      <div
        className="mixproto-lanewindow"
        style={{ left: tr.startSec * pxPerSec, width: Math.max(tr.durationSec * pxPerSec, 4) }}
      >
        <LaneCanvas
          id={id}
          widthPx={Math.max(tr.durationSec * pxPerSec, 4)}
          points={lanePoints(tr.lanes, id)}
          guides={id.endsWith('A') ? guidesA : guidesB}
          onChange={(pts) => onLaneChange(id, pts)}
        />
      </div>
    </div>
  );

  const lanesA = visibleLanes.filter((id) => id.endsWith('A'));
  const lanesB = visibleLanes.filter((id) => id.endsWith('B'));

  return (
    <div className="mixproto-timeline-wrap">
      <GlobalMinimap
        player={player}
        mix={mix}
        waveA={waveA ?? null}
        waveB={waveB ?? null}
        rateB={rateB}
        contentEnd={contentEnd}
        pxPerSec={pxPerSec}
        getScrollPx={() => scrollPxRef.current}
        setScrollPx={(px) => {
          scrollPxRef.current = Math.max(0, px);
        }}
        getViewPx={() => viewportRef.current?.clientWidth ?? 800}
      />
      <div ref={viewportRef} className="mixproto-timeline">
        <div
          ref={contentRef}
          className="mixproto-timeline-content"
          style={{ width: contentEnd * pxPerSec }}
        >
          {/* Row A */}
          <div
            className="mixproto-timeline-row"
            onPointerDown={onRowPointerDown('A')}
            onPointerMove={onRowPointerMove('A')}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <div ref={waveWrapARef} className="mixproto-wavecanvas" style={{ width: viewW }}>
              <canvas ref={rendA.canvasRef} />
            </div>
            {trackAId !== null && durA > 0 && (
              <div className="mixproto-blockframe a" style={{ left: 0, width: aEnd * pxPerSec }} />
            )}
          </div>
          {lanesA.map(laneStrip)}

          {/* Row B */}
          <div
            className="mixproto-timeline-row"
            onPointerDown={onRowPointerDown('B')}
            onPointerMove={onRowPointerMove('B')}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <div ref={waveWrapBRef} className="mixproto-wavecanvas" style={{ width: viewW }}>
              <canvas ref={rendB.canvasRef} />
            </div>
            {trackBId !== null && durB > 0 && (
              <div
                className="mixproto-blockframe b"
                style={{ left: tr.startSec * pxPerSec, width: bBlockLenMix * pxPerSec }}
              />
            )}
          </div>
          {lanesB.map(laneStrip)}

          {/* Transition overlap highlight */}
          {tr.durationSec > 0 && (
            <div
              className="mixproto-overlap"
              style={{ left: tr.startSec * pxPerSec, width: tr.durationSec * pxPerSec }}
            />
          )}

          {/* Mix playhead */}
          <div ref={playheadRef} className="mixproto-playhead" />
        </div>
      </div>

      <button className="mixproto-fit" onClick={fit} title="Zoom to fit">
        fit
      </button>
    </div>
  );
}

/** One automation lane: breakpoint polyline editor (canvas only; the label
 * and clear button live in the lane strip). */
/** A vertical guide line inside a lane strip (normalized x within the transition). */
interface LaneGuide {
  x: number;
  /** Downbeats and cue lines render stronger than plain beats. */
  strong: boolean;
  color?: string;
}

function LaneCanvas({
  id,
  widthPx,
  points,
  guides,
  onChange,
}: {
  id: LaneId;
  /** Rendered width — a draw-effect dependency so zoom resizes redraw in
   * place (this used to be a `key`, remounting the canvas per zoom step). */
  widthPx: number;
  points: LanePoint[];
  guides: LaneGuide[];
  onChange: (points: LanePoint[]) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointsRef = useRef(points);
  useEffect(() => {
    pointsRef.current = points;
  });
  const dragIndex = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = 'rgba(24, 24, 37, 0.85)';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#313244';
    ctx.fillRect(0, h / 2, w, 1);

    // Beat/cue guides continue through the lanes (beatmatching alignment).
    for (const g of guides) {
      const gx = g.x * w;
      if (g.color) {
        ctx.fillStyle = g.color;
        ctx.globalAlpha = 0.5;
        ctx.fillRect(gx - 0.5, 0, 1.5, h);
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = g.strong ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.09)';
        ctx.fillRect(gx, 0, g.strong ? 1.5 : 1, h);
      }
    }

    const color = LANE_COLORS[id];
    // Curve path (with flat extensions to the window edges).
    const tracePath = () => {
      ctx.beginPath();
      points.forEach((p, i) => {
        const px = p.x * w;
        const py = (1 - p.y) * h;
        if (i === 0) {
          ctx.moveTo(0, py);
          ctx.lineTo(px, py);
        }
        ctx.lineTo(px, py);
        if (i === points.length - 1) ctx.lineTo(w, py);
      });
    };

    // Translucent fill under the curve (DAW-style) — makes each lane's shape
    // read at a glance even when several strips are stacked.
    tracePath();
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 1;

    tracePath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = color;
    for (const p of points) {
      ctx.beginPath();
      ctx.arc(p.x * w, (1 - p.y) * h, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [points, id, guides, widthPx]);

  const pointAt = (e: React.PointerEvent | React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height)),
      nearestIndex: (() => {
        let best = -1;
        let bestDist = Infinity;
        pointsRef.current.forEach((p, i) => {
          const dx = (p.x * rect.width) - (e.clientX - rect.left);
          const dy = ((1 - p.y) * rect.height) - (e.clientY - rect.top);
          const d = Math.hypot(dx, dy);
          if (d < bestDist) {
            bestDist = d;
            best = i;
          }
        });
        return bestDist < 10 ? best : -1;
      })(),
    };
  };

  const commit = (pts: LanePoint[]) => onChange([...pts].sort((a, b) => a.x - b.x));

  return (
    <canvas
      ref={canvasRef}
      onPointerDown={(e) => {
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        const hit = pointAt(e);
        if (hit.nearestIndex >= 0) {
          dragIndex.current = hit.nearestIndex;
        } else {
          const pts = [...pointsRef.current, { x: hit.x, y: hit.y }].sort((a, b) => a.x - b.x);
          dragIndex.current = pts.findIndex((p) => p.x === hit.x && p.y === hit.y);
          commit(pts);
        }
      }}
      onPointerMove={(e) => {
        if (dragIndex.current === null) return;
        const hit = pointAt(e);
        const pts = [...pointsRef.current];
        pts[dragIndex.current] = { x: hit.x, y: hit.y };
        const i = dragIndex.current;
        if (i > 0) pts[i].x = Math.max(pts[i].x, pts[i - 1].x);
        if (i < pts.length - 1) pts[i].x = Math.min(pts[i].x, pts[i + 1].x);
        onChange(pts);
      }}
      onPointerUp={() => (dragIndex.current = null)}
      onPointerCancel={() => (dragIndex.current = null)}
      onDoubleClick={(e) => {
        e.stopPropagation();
        const hit = pointAt(e);
        if (hit.nearestIndex >= 0 && pointsRef.current.length > 1) {
          const pts = pointsRef.current.filter((_, i) => i !== hit.nearestIndex);
          commit(pts);
        }
      }}
    />
  );
}

/**
 * Per-deck card (left/right of the transition center): track identity, base
 * BPM (editable, persisted) with tempo-matched effective BPM and pitch %,
 * key, and beatgrid tweaking.
 */
function DeckCard({
  deck,
  track,
  player,
  loadState,
  effectiveBpm,
  pitchPercent,
  onBpmSaved,
}: {
  deck: 'A' | 'B';
  track: Track | null;
  player: MixProtoPlayer;
  loadState: string;
  /** BPM after tempo match (differs from base only on the matched deck). */
  effectiveBpm: number | null;
  pitchPercent: number;
  onBpmSaved: (bpm: number) => void;
}) {
  const queryClient = useQueryClient();
  const nudge = useNudgeBeatgrid();
  const setDownbeat = useSetBeatgridDownbeat();
  const [bpmDraft, setBpmDraft] = useState('');
  // Reset the draft when the track (or its saved BPM) changes.
  const [draftKey, setDraftKey] = useState('');
  const key = `${track?.id ?? 'none'}-${track?.bpm ?? 0}`;
  if (key !== draftKey) {
    setDraftKey(key);
    setBpmDraft(track?.bpm ? track.bpm.toFixed(2) : '');
  }

  if (!track) {
    return (
      <div className={`mixproto-deckcard ${deck.toLowerCase()}`}>
        <div className="mixproto-deckcard-head">
          <span className={`mixproto-decklabel ${deck.toLowerCase()}`}>{deck}</span>
          <span className="mixproto-tweaktitle">no track — select below and load</span>
        </div>
      </div>
    );
  }

  const commitBpm = async () => {
    const bpm = Number(bpmDraft);
    if (!bpm || bpm <= 0 || bpm === track.bpm) return;
    await api.tracks.update(track.id, { bpm });
    await api.beatgrids.delete(track.id);
    await api.beatgrids.get(track.id);
    queryClient.invalidateQueries({ queryKey: ['beatgrid', track.id] });
    player.setBpm(deck, bpm);
    onBpmSaved(bpm);
  };

  return (
    <div className={`mixproto-deckcard ${deck.toLowerCase()}`}>
      <div className="mixproto-deckcard-head">
        <span className={`mixproto-decklabel ${deck.toLowerCase()}`}>{deck}</span>
        <span className="mixproto-tweaktitle" title={track.title || track.filename}>
          {track.title || track.filename}
        </span>
        <span className="mixproto-deckcard-artist">{track.artist || '—'}</span>
      </div>
      <div className="mixproto-deckcard-row">
        <label title="Base BPM (the track's real tempo — edits persist)">
          BPM
          <input
            className="mixproto-bpm-base"
            type="number"
            step={0.01}
            min={1}
            value={bpmDraft}
            onChange={(e) => setBpmDraft(e.target.value)}
            onBlur={() => void commitBpm()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
          />
        </label>
        <span className="mixproto-bpm-eff" title="Effective BPM during the mix (after tempo match)">
          » {effectiveBpm !== null ? effectiveBpm.toFixed(1) : '—'}
          {Math.abs(pitchPercent) > 0.05 && (
            <em>
              {' '}
              ({pitchPercent > 0 ? '+' : ''}
              {pitchPercent.toFixed(1)}%)
            </em>
          )}
        </span>
        <span className="mixproto-deckcard-key">{formatKeyDisplay(track.key)}</span>
        <span className="mixproto-tweaktitle">{loadState !== 'ready' ? loadState : ''}</span>
      </div>
      <div className="mixproto-deckcard-row">
        <button
          title="Nudge beatgrid 10ms earlier"
          onClick={() => nudge.mutate({ trackId: track.id, offsetMs: -10 })}
        >
          grid ◀
        </button>
        <button
          title="Nudge beatgrid 10ms later"
          onClick={() => nudge.mutate({ trackId: track.id, offsetMs: 10 })}
        >
          ▶
        </button>
        <button
          title="Set downbeat at this deck's playhead"
          onClick={() =>
            setDownbeat.mutate({ trackId: track.id, downbeatTime: player.getTrackTime(deck) })
          }
        >
          downbeat @ playhead
        </button>
      </div>
    </div>
  );
}

/**
 * Global minimap of the whole mix: A's waveform where only A is audible,
 * B's where only B is, vertically split (A top / B bottom) in the overlap.
 * Columns are transformed by the drawn envelopes — height scales with the
 * fader lane, band colors fade with their EQ lanes — so the minimap previews
 * the mix's energy shape, not just the source material. Overlays: transition
 * frame, viewport rectangle (drag to pan), playhead. Click outside the
 * viewport = seek.
 */
function GlobalMinimap({
  player,
  mix,
  waveA,
  waveB,
  rateB,
  contentEnd,
  pxPerSec,
  getScrollPx,
  setScrollPx,
  getViewPx,
}: {
  player: MixProtoPlayer;
  mix: ProtoMix;
  waveA: WaveformDataWebGL | null;
  waveB: WaveformDataWebGL | null;
  rateB: number;
  contentEnd: number;
  pxPerSec: number;
  getScrollPx: () => number;
  setScrollPx: (px: number) => void;
  getViewPx: () => number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const drag = useRef<{ grabOffsetSec: number } | null>(null);

  // ── Base layer: waveforms + transition frame (debounced redraw) ──
  useEffect(() => {
    const timer = setTimeout(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (!baseRef.current) baseRef.current = document.createElement('canvas');
      const base = baseRef.current;
      base.width = w * dpr;
      base.height = h * dpr;
      const ctx = base.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#0b0b12';
      ctx.fillRect(0, 0, w, h);

      const tr = mix.transition;
      const durA = waveA?.duration ?? 0;
      const durB = waveB?.duration ?? 0;
      const aEnd = durA > 0 ? Math.min(tr.startSec + tr.durationSec, durA) : 0;
      const eqScale = (v: number) => Math.min(v * 2, 1.15);
      const bands = [
        { key: 'low' as const, color: '242,97,97' },
        { key: 'mid' as const, color: '0,230,0' },
        { key: 'high' as const, color: '135,222,237' },
      ];

      for (let x = 0; x < w; x++) {
        const t = (x / w) * contentEnd;
        const v = laneValuesAt(tr, t);
        const bTrack = mix.bInSec + (t - tr.startSec) * rateB;
        const aOn = durA > 0 && t >= 0 && t < aEnd;
        const bOn = durB > 0 && t >= tr.startSec && bTrack >= 0 && bTrack < durB;

        const drawCol = (
          wave: WaveformDataWebGL,
          trackT: number,
          fader: number,
          eq: { low: number; mid: number; high: number },
          dir: 'down' | 'up'
        ) => {
          const idx = Math.max(0, Math.min(wave.low.length - 1, Math.floor((trackT / wave.duration) * wave.low.length)));
          for (const band of bands) {
            const amp = wave[band.key][idx] * fader * h * 0.95;
            if (amp <= 0.5) continue;
            ctx.fillStyle = `rgba(${band.color},${(0.6 * eqScale(eq[band.key])).toFixed(3)})`;
            ctx.fillRect(x, dir === 'down' ? 0 : h - amp, 1, amp);
          }
        };

        // A hangs from the top edge, B rises from the bottom; through the
        // transition the two interleave in the same space.
        if (aOn && waveA) {
          drawCol(waveA, t, v.faderA, { low: v.eqLowA, mid: v.eqMidA, high: v.eqHighA }, 'down');
        }
        if (bOn && waveB) {
          drawCol(waveB, bTrack, v.faderB, { low: v.eqLowB, mid: v.eqMidB, high: v.eqHighB }, 'up');
        }
      }

      // Transition frame.
      const fx = (tr.startSec / contentEnd) * w;
      const fw = Math.max((tr.durationSec / contentEnd) * w, 2);
      ctx.strokeStyle = 'rgba(255,45,149,0.8)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(fx, 0.75, fw, h - 1.5);
    }, 100);
    return () => clearTimeout(timer);
  }, [mix, waveA, waveB, rateB, contentEnd]);

  // ── Overlay layer: viewport rect + playhead (rAF) ──
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (baseRef.current) ctx.drawImage(baseRef.current, 0, 0, w, h);

      const viewStart = getScrollPx() / pxPerSec;
      const viewSec = getViewPx() / pxPerSec;
      const vx = (viewStart / contentEnd) * w;
      const vw = Math.min((viewSec / contentEnd) * w, w);
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 1;
      ctx.strokeRect(vx + 0.5, 0.5, vw - 1, h - 1);
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(vx, 0, vw, h);

      const px = (player.getMixTime() / contentEnd) * w;
      ctx.fillStyle = '#00e5ff';
      ctx.fillRect(px - 1, 0, 2, h);
    };
    tick();
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player, contentEnd, pxPerSec]);

  const secAt = (e: React.PointerEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return ((e.clientX - rect.left) / rect.width) * contentEnd;
  };

  return (
    <canvas
      ref={canvasRef}
      className="mixproto-globalminimap"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        const sec = secAt(e);
        const viewStart = getScrollPx() / pxPerSec;
        const viewSec = getViewPx() / pxPerSec;
        if (sec >= viewStart && sec <= viewStart + viewSec) {
          drag.current = { grabOffsetSec: sec - viewStart };
        } else {
          drag.current = null;
          player.seek(sec);
        }
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        const sec = secAt(e);
        setScrollPx((sec - drag.current.grabOffsetSec) * pxPerSec);
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
    />
  );
}
