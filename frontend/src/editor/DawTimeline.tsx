/**
 * DAW-style timeline: track rows with viewport-sized sticky canvases whose
 * display window follows scroll/zoom — full rendering resolution at any
 * zoom (no giant canvases). A lanes / A wave / seam / B wave / B lanes;
 * the overlap is the Transition. One rAF tick owns all horizontal motion
 * (dirty-keyed: an idle editor draws nothing).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useWaveformBlob } from '../waveform/useWaveformBlob';
import { useWaveformRendererV2 } from '../waveform/useWaveformRendererV2';
import { useHotCues } from '../hooks/useHotCues';
import { MixPlayer } from './MixPlayer';
import { ConductorLanePlayhead } from './ConductorLanePlayhead';
import { GlobalMinimap } from './GlobalMinimap';
import { LaneCanvas } from './LaneCanvas';
import { DECK_LANE_ORDER, LANE_COLORS, LANE_LABELS } from './laneColors';
import { cueCssColor } from '../hotcues/palette';
import { AUDIBILITY_FILL_ALPHA } from '../theme/markers';
import { hexToRgbTriplet } from '../theme/deckColors';
import type { LaneGuide } from './LaneCanvas';
import {
  LANE_IDS,
  aContentSegments,
  aEndMixTime,
  aTrackTimeAt,
  bContentSegments,
  cropRemapJumps,
  cropRemapJumpsLeft,
  cropRemapLanes,
  cropRemapLanesLeft,
  defaultLanePoints,
  evalLane,
  jumpRepeatCount,
  lanePoints,
  nearestTime,
  visibleLaneIds,
} from './mixModel';
import type { JumpEvent, LaneId, LanePoint, Lanes, EditorMix } from './mixModel';
import { deleteSelected } from './laneSelection';
import { isTypingTarget } from '../components/performance/performanceKeys';
import { EditorStore, useEditorSelector } from './editorStore';
import { jumpDeltaLabel } from './beatReadout';
import { JumpBackIcon, JumpForwardIcon } from '../components/icons/JumpIcons';
import { beatPeriodSec } from './templateModel';
import { downbeatLadderMap } from '../meter/ladder';
import { useMetricLadderData } from '../hooks/useMetricLadderData';
import type { PlaybackClock } from '../playback/clock';
import { channelFaderToGain } from '../playback/mixerMath';
import type { BeatgridData } from '../types';

/** Zoom-in ceiling. At 240 px/s a 128 BPM beat spans ~112px — enough room
 * to place breakpoints between beats. */
const MAX_PX_PER_SEC = 240;
const IDLE_TICK_MS = 250;

/** Envelope-preview LUT resolution (samples across the window). */
const MOD_LUT_N = 2048;

/** Stable empty selection: LaneCanvas draw effects key on the `selected`
 * identity — a fresh [] per render would redraw every lane every render. */
const NO_SELECTION: number[] = [];

/** First index with arr[i] >= v (arr ascending). */
/** Audibility-style gain fill behind a deck waveform row (mix-editor 39):
 * the session timeline's area-chart language — deck color at 0.16 alpha,
 * column height = the fader lane's effective gain — applied to the
 * transition window. Anchored at the row's OUTER edge, growing toward the
 * seam like the waveform peaks. Content-space positioned, so it scrolls
 * and zooms with the content transform; redraws only on lane/zoom
 * changes. Bitmap width capped like the lane canvases. */
function GainFill({
  points,
  color,
  leftPx,
  widthPx,
  anchor,
}: {
  points: LanePoint[];
  color: string;
  leftPx: number;
  widthPx: number;
  anchor: 'top' | 'bottom';
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const w = Math.max(widthPx, 4);
    const h = canvas.clientHeight;
    if (h === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 8192 / Math.max(w, 1));
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = `rgba(${hexToRgbTriplet(color)},${AUDIBILITY_FILL_ALPHA})`;
    ctx.beginPath();
    for (let x = 0; x < w; x += 1) {
      const gain = channelFaderToGain(evalLane(points, x / w));
      if (gain <= 0) continue;
      const gh = Math.min(1, gain) * h;
      ctx.rect(x, anchor === 'top' ? 0 : h - gh, 1, gh);
    }
    ctx.fill();
  }, [points, widthPx, color, anchor]);
  return (
    <canvas
      ref={ref}
      className="editor-gainfill"
      style={{ left: leftPx, width: Math.max(widthPx, 4) }}
    />
  );
}

function lowerBound(arr: number[], v: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
/**
 * DAW-style timeline: track rows with viewport-sized sticky canvases whose
 * display window follows scroll/zoom — full rendering resolution at any zoom
 * (no giant canvases). Automation lane strips sit pinned under their deck's
 * row, aligned to the transition region. Overlap = the Transition.
 */
export function DawTimeline({
  store,
  player,
  trackAId,
  trackBId,
  clockA,
  clockB,
  beatgridA,
  beatgridB,
  rateB,
  frameSignal,
}: {
  /** Editor session state (mix-editor 27): mix/snap/lock come from narrow
   * subscriptions, mutations go back through named store methods. */
  store: EditorStore;
  player: MixPlayer;
  trackAId: number | null;
  trackBId: number | null;
  clockA: PlaybackClock;
  clockB: PlaybackClock;
  beatgridA: BeatgridData | null;
  beatgridB: BeatgridData | null;
  rateB: number;
  /** Bumped by the parent when a Transition loads/switches — re-frames the
   * viewport around the window. */
  frameSignal: number;
}) {
  const mix = useEditorSelector(store, (s) => s.mix);
  const snap = useEditorSelector(store, (s) => s.snap);
  /** Slide-lock (glossary): dragging B moves the window with it only when
   * locked; unlocked, B's content slides under a fixed window. */
  const lockedWindow = useEditorSelector(store, (s) => s.lockedWindow);
  const visibleLanes = useMemo(() => visibleLaneIds(mix.transition), [mix.transition]);
  const onChange = useCallback(
    (fn: (m: EditorMix) => EditorMix) => store.updateMix(fn),
    [store]
  );
  const onLaneChange = useCallback(
    (id: LaneId, points: LanePoint[] | null) => store.setLane(id, points),
    [store]
  );

  // ── Lane node group selection (mix-editor 16) ──
  // One selection at a time, KEYED BY LANE ID (v1 is per-lane; v2's
  // cross-lane time-shift would widen this to a map without a reshape).
  // View state, never persisted.
  const [laneSel, setLaneSel] = useState<{ lane: LaneId; indices: number[] } | null>(null);
  // A different Transition's points invalidate indices wholesale.
  const activeItem = useEditorSelector(store, (s) => s.session.active);
  const pairKey = useEditorSelector(store, (s) => s.pairKey);
  useEffect(() => setLaneSel(null), [activeItem, pairKey]);
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
  /** Lane label elements, counter-transformed per frame so they pin to the
   * viewport's left edge (CSS sticky is blind to transform-based scroll). */
  const laneLabelRefs = useRef(new Map<LaneId, HTMLSpanElement>());
  /** Lane-accent edge bars (right of the toggle column), pinned the same way. */
  const laneEdgeRefs = useRef(new Map<LaneId, HTMLSpanElement>());
  /** Per-strip backdrop panels behind the toggles/labels, pinned likewise —
   * they form the visual left sidebar over the automation strips only. */
  const laneBackdropRefs = useRef(new Map<LaneId, HTMLSpanElement>());
  /** Lane canvas scroll hooks: the tick feeds each one the visible content
   * range; a canvas repositions/redraws only when the view exits its drawn
   * span (viewport-windowed lane canvases — scroll-jitter fix). */
  const laneScrollDraws = useRef(new Map<LaneId, (l: number, r: number) => void>());
  const registerScrollDraw = useCallback(
    (id: LaneId, fn: ((l: number, r: number) => void) | null) => {
      if (fn) laneScrollDraws.current.set(id, fn);
      else laneScrollDraws.current.delete(id);
    },
    []
  );
  const drag = useRef<null | {
    kind: 'bMove' | 'bTrim' | 'aTrim';
    /** Pointer-down x; a release without real movement (≤4px) is a CLICK —
     * bMove clicks seek, like clicking anywhere on row A. */
    downClientX: number;
    moved: boolean;
    grabOffsetSec: number;
    /** Lane/duration snapshot at drag start — crop remaps derive from these
     * so incremental moves never compound (and toggling alt mid-drag works). */
    origLanes: Lanes;
    origJumps: JumpEvent[] | undefined;
    origJumpsA: JumpEvent[] | undefined;
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

  // Waveform renderers: one viewport-sized canvas per row, windowed to the
  // visible time range (crisp at any zoom). Fetched before the audio
  // decodes — see the duration fallback below.
  const { data: waveA } = useWaveformBlob(trackAId);
  const { data: waveB } = useWaveformBlob(trackBId);
  // Draw before decode (mix-editor 28): engine durations are 0 until
  // decodeAudioData finishes (seconds for two full tracks), but the
  // waveform response's duration arrives in milliseconds — geometry and
  // drawing use it as a fallback so waveforms + envelopes render
  // immediately. Audio readiness still gates transport (play button,
  // park-after-ready), never drawing.
  //
  // The engine read is trusted ONLY while the engine holds this side's
  // track: the editor plays through the SHARED decks (ADR 0022), and a
  // mounted-but-silent editor over a conducting Set (the normal case
  // since sets 21) sees the Conductor ping-pong OTHER tracks through
  // them — unguarded, the timeline's block math re-warped at every
  // handover ("misaligned depending on the set's play position").
  const engineDur = (snap: { trackId: number | null; duration: number }, trackId: number | null) =>
    trackId !== null && snap.trackId === trackId ? snap.duration : 0;
  const durA = engineDur(player.engineA.getSnapshot(), trackAId) || (waveA?.duration ?? 0);
  const durB = engineDur(player.engineB.getSnapshot(), trackBId) || (waveB?.duration ?? 0);
  const waveDursRef = useRef({ a: 0, b: 0 });
  useEffect(() => {
    waveDursRef.current = { a: waveA?.duration ?? 0, b: waveB?.duration ?? 0 };
  });
  const trackIdsRef = useRef({ a: trackAId, b: trackBId });
  useEffect(() => {
    trackIdsRef.current = { a: trackAId, b: trackBId };
  });
  const tr = mix.transition;

  // Selection keyboard: Esc deselects; Delete/Backspace removes the
  // selected nodes (deleteSelected keeps the lane's ≥1-point invariant).
  useEffect(() => {
    if (!laneSel) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e)) return;
      if (e.key === 'Escape') {
        setLaneSel(null);
        return;
      }
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      e.preventDefault();
      const lane = laneSel.lane;
      const pts = tr.lanes[lane]?.length
        ? tr.lanes[lane]
        : defaultLanePoints(lane, tr.durationSec);
      onLaneChange(lane, deleteSelected(pts, laneSel.indices));
      setLaneSel(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [laneSel, tr.lanes, tr.durationSec, onLaneChange]);

  // A's end is jump-aware (issue 177): the window end, or A's first durA
  // crossing on the jumped path if that comes sooner. Without jumpsA this
  // is the old min(startSec + durationSec, durA).
  const aEnd = durA > 0 ? aEndMixTime(tr, durA) : tr.startSec + tr.durationSec;
  /** A's audible footprint as piecewise segments (issue 177): the same
   * walk B gets, from mix 0 at track 0, capped at the window end. One
   * segment (no jumpsA) = the legacy linear row. */
  const aSegments = useMemo(
    () => (durA > 0 ? aContentSegments(tr, durA) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tr.startSec, tr.durationSec, tr.jumpsA, durA]
  );
  // A goes silent at the window end but its remaining audio is still
  // context: a greyed TAIL strip from the exit position (simulated
  // through jumps) to the track end. Backward jumps repeat material, so
  // A's mix footprint can exceed durA.
  const aTailTrackStart = durA > 0 ? Math.min(durA, Math.max(0, aTrackTimeAt(tr, aEnd))) : 0;
  const aFootprintEnd = durA > 0 ? aEnd + (durA - aTailTrackStart) : 0;
  const aDrawSegments = useMemo(
    () =>
      aFootprintEnd > aEnd
        ? [...aSegments, { mixStartSec: aEnd, mixEndSec: aFootprintEnd, bStartSec: aTailTrackStart }]
        : aSegments,
    [aSegments, aEnd, aFootprintEnd, aTailTrackStart]
  );
  const aDrawSegmentsRef = useRef(aDrawSegments);
  useEffect(() => {
    aDrawSegmentsRef.current = aDrawSegments;
  });
  // B is time-stretched on the mix axis by its playback rate. The block
  // starts at B's TRUE audio start: a negative entry anchor (bInSec < 0)
  // opens a silent lead gap after the window start before audio begins.
  const bAudioStartMix = tr.startSec + Math.max(0, -tr.bInSec) / rateB;
  const bBlockLenMix = Math.max(durB - Math.max(tr.bInSec, 0), 0) / rateB;
  /** B's audible footprint as piecewise segments (transition-takes 06):
   * the single walk every B-side surface maps through. One segment and
   * this degenerates to the legacy block math. */
  const bSegments = useMemo(
    () => (durB > 0 ? bContentSegments(tr, durB, rateB) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tr.startSec, tr.durationSec, tr.bInSec, tr.jumps, durB, rateB]
  );
  const bSegmentsRef = useRef(bSegments);
  useEffect(() => {
    bSegmentsRef.current = bSegments;
  });
  /** Drawn start of segment i: the FIRST segment extends back to B's
   * content origin (the greyed head the editor has always drawn); splice
   * segments start hard at their jump instant. */
  const segDrawStart = (i: number): number => {
    const g = bSegments[i];
    return i === 0 ? Math.max(0, g.mixStartSec - g.bStartSec / rateB) : g.mixStartSec;
  };
  /** Rightmost content edge: end of the last track. Nothing renders past
   * it. A backward jump extends B past its linear end; a forward jump
   * truncates — the walk's last segment is the real footprint edge. */
  const bFootprintEnd =
    bSegments.length > 0
      ? bSegments[bSegments.length - 1].mixEndSec
      : bAudioStartMix + bBlockLenMix;
  // aFootprintEnd ≡ durA without jumpsA — the legacy extent.
  const contentEnd = Math.max(aFootprintEnd, bFootprintEnd, 10);

  const beatsA = beatgridA?.beat_times;
  const beatsB = beatgridB?.beat_times;
  const snapRef = useRef({ snap, beatsA, beatsB, rateB, lockedWindow });
  useEffect(() => {
    snapRef.current = { snap, beatsA, beatsB, rateB, lockedWindow };
  });

  const { data: hotCuesA = [] } = useHotCues(trackAId);
  const { data: hotCuesB = [] } = useHotCues(trackBId);
  const { data: ladderA = null } = useMetricLadderData(trackAId);
  const { data: ladderB = null } = useMetricLadderData(trackBId);
  // Bipolar rows (cosmetic pass 2026-07-10, supersedes issue 13's stacked
  // halves): both rows mirror around their own center baseline, at full
  // band brightness like the library/performance waveforms (the issue-05
  // 0.6 dim is retired; out-of-window dimming stays — .editor-inaudible).
  // playMarkerPosition 0: documented override of PLAY_MARKER_FRACTION
  // (theme/markers) — the editor rows use an external window (the DOM
  // playhead scrolls; the renderer's fixed marker is unused).
  const rowConfigA = {
    isMinimapMode: false,
    playMarkerPosition: 0,
    amplitudeAnchor: 'center' as const,
  };
  const rowConfigB = {
    isMinimapMode: false,
    playMarkerPosition: 0,
    amplitudeAnchor: 'center' as const,
  };
  // Driven mode: the rAF tick below calls draw() for both rows right after
  // writing transforms + display windows — one motion clock, layer order
  // guaranteed (self-running renderer loops only aligned by rAF
  // registration luck, and tore when they ran before the tick).
  const rendA = useWaveformRendererV2({
    clock: clockA,
    waveformData: waveA,
    config: rowConfigA,
    hotCues: hotCuesA,
    beatgrid: beatgridA,
    metricLadder: ladderA,
    driven: true,
  });
  const rendB = useWaveformRendererV2({
    clock: clockB,
    waveformData: waveB,
    config: rowConfigB,
    hotCues: hotCuesB,
    beatgrid: beatgridB,
    metricLadder: ladderB,
    driven: true,
  });
  // Envelope preview on the rows (minimap parity): fader lanes scale bar
  // heights, EQ lanes scale band colors — a drawn bass kill visibly removes
  // the red band. HOT PATH: the renderer calls the modulation per pixel
  // column during zoom-gesture regens (~10k+/frame), so the envelopes are
  // SAMPLED ONCE into a LUT here (they only vary inside the window —
  // evalLane clamps outside, so index clamping covers the constant tails)
  // and the callback is a clamped array lookup into a reused object.
  // LUTs depend on lane SHAPES only (normalized x) — window moves and
  // slides must not pay the 8k-evalLane rebuild, just the cheap remap
  // below.
  const modLuts = useMemo(() => {
    const eqVis = (v: number) => Math.min(v * 2, 1.15);
    const laneY = (id: LaneId, x: number) =>
      evalLane(
        tr.hiddenLanes?.includes(id)
          ? defaultLanePoints(id, tr.durationSec)
          : lanePoints(tr.lanes, id, tr.durationSec),
        x
      );
    const buildLut = (fader: LaneId, low: LaneId, mid: LaneId, high: LaneId) => {
      const lut = new Float32Array(MOD_LUT_N * 4);
      for (let i = 0; i < MOD_LUT_N; i++) {
        const x = i / (MOD_LUT_N - 1);
        lut[i * 4] = laneY(fader, x);
        lut[i * 4 + 1] = eqVis(laneY(low, x));
        lut[i * 4 + 2] = eqVis(laneY(mid, x));
        lut[i * 4 + 3] = eqVis(laneY(high, x));
      }
      return lut;
    };
    return {
      a: buildLut('faderA', 'eqLowA', 'eqMidA', 'eqHighA'),
      b: buildLut('faderB', 'eqLowB', 'eqMidB', 'eqHighB'),
    };
  }, [tr.lanes, tr.hiddenLanes, tr.durationSec]);

  useEffect(() => {
    const mkMod = (lut: Float32Array, xAt: (t: number) => number) => {
      const out = { gain: 1, low: 1, mid: 1, high: 1 };
      return (t: number) => {
        const x = xAt(t);
        const i = 4 * Math.max(0, Math.min(MOD_LUT_N - 1, Math.round(x * (MOD_LUT_N - 1))));
        out.gain = lut[i];
        out.low = lut[i + 1];
        out.mid = lut[i + 2];
        out.high = lut[i + 3];
        return out;
      };
    };
    const dur = tr.durationSec;
    rendA.rendererRef.current?.setModulation(
      mkMod(modLuts.a, dur <= 0 ? (t) => (t < tr.startSec ? 0 : 1) : (t) => (t - tr.startSec) / dur)
    );
    // B's domain switches with the splice (transition-takes 06): the
    // segmented path remaps track → MIX time per strip (modAffine), so
    // with jumps present the callback reads mix time, exactly like A's.
    // Without jumps it keeps the legacy track-time mapping.
    const hasJumps = (tr.jumps?.length ?? 0) > 0;
    rendB.rendererRef.current?.setModulation(
      mkMod(
        modLuts.b,
        hasJumps
          ? dur <= 0
            ? (t) => (t < tr.startSec ? 0 : 1)
            : (t) => (t - tr.startSec) / dur
          : dur <= 0
            ? (bt) => (bt < tr.bInSec ? 0 : 1)
            : (bt) => (bt - tr.bInSec) / (rateB * dur)
      )
    );
  }, [modLuts, tr.startSec, tr.durationSec, tr.bInSec, tr.jumps, rateB, waveA, waveB, rendA.rendererRef, rendB.rendererRef]);

  // Mirrors so the tick effect (keyed on [player]) never holds stale draws.
  const drawRowsRef = useRef({ a: rendA.draw, b: rendB.draw });
  useEffect(() => {
    drawRowsRef.current = { a: rendA.draw, b: rendB.draw };
  });

  // Viewport width for the fixed row canvases. Observed on the viewport
  // itself, not window resize: the viewport can change width without the
  // window (layout/CSS changes) and a stale width draws the wave rows
  // compressed against the content-space lanes.
  const [viewW, setViewW] = useState(800);
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const measure = () => setViewW(viewport.clientWidth || 800);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(viewport);
    return () => ro.disconnect();
  }, []);

  // Dirty tracking for the tick: bump on any React-side change that affects
  // what the rows draw. The tick skips ALL per-frame writes + draws when its
  // key (scroll, zoom, mix time, durations, this version) is unchanged — an
  // idle editor costs ~nothing instead of two full WebGL passes per frame.
  const modelVersionRef = useRef(0);
  useEffect(() => {
    modelVersionRef.current++;
  }, [mix, rateB, waveA, waveB, hotCuesA, hotCuesB, beatgridA, beatgridB, viewW]);

  /** Kicks the motion loop off its idle timeout onto the rAF clock — set by
   * the tick effect, called by input handlers (wheel pan/zoom, row grabs). */
  const wakeTickRef = useRef<() => void>(() => {});

  // Per-frame, single motion clock: read the scrollbar strip's position once
  // and apply it to EVERYTHING horizontal — content transform, canvas
  // counter-transforms, display windows, playhead. Native scrolling of the
  // content itself would move DOM layers on the compositor thread a frame
  // ahead of the rAF-painted waveforms (visible tearing); a detached
  // scrollbar + same-frame transforms keeps every layer in lockstep.
  useEffect(() => {
    // TEMP instrumentation (?protoperf): worst tick per second — remove
    // after the perf pass is verified.
    const perf = new URLSearchParams(window.location.search).has('protoperf');
    let perfMax = 0;
    let perfLast = performance.now();
    let raf = 0;
    let idleTimer = 0;
    let onRafClock = true;
    let lastDrawKey = '';
    const schedule = (active: boolean) => {
      onRafClock = active;
      if (active) raf = requestAnimationFrame(tick);
      else idleTimer = window.setTimeout(tick, IDLE_TICK_MS);
    };
    // Input wake-up: the idle loop polls at IDLE_TICK_MS, and input handlers
    // only accumulate into refs — without this, the FIRST wheel of a gesture
    // waited out the idle timeout (up to 250ms) before anything moved: the
    // start-of-scroll/zoom stutter. Inputs call wake() to jump the loop back
    // onto the rAF clock for the next frame.
    wakeTickRef.current = () => {
      if (onRafClock) return;
      window.clearTimeout(idleTimer);
      schedule(true);
    };
    const tick = () => {
      const t0 = perf ? performance.now() : 0;
      const viewport = viewportRef.current;
      if (!viewport) {
        schedule(false);
        return;
      }
      // Apply at most one accumulated wheel-zoom step per frame. flushSync
      // commits the React re-render (block widths, ruler) NOW, so the
      // transforms/windows painted below use the same px — no torn frames.
      const zoom = pendingZoomRef.current;
      if (zoom) {
        pendingZoomRef.current = null;
        const rect = viewport.getBoundingClientRect();
        const px = pxRef.current;
        const minPx = (rect.width - 2) / contentEndRef.current; // fit = floor
        const next = Math.min(MAX_PX_PER_SEC, Math.max(minPx, px * zoom.factor));
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
      // Dirty check: skip every write/draw below when nothing that feeds
      // them changed since the last frame (idle editor = idle GPU).
      // Same pre-decode duration fallback — and the same own-track gate —
      // as the render path (issue 28; conductor-load misalignment fix).
      const snapA = player.engineA.getSnapshot();
      const snapB = player.engineB.getSnapshot();
      const dA =
        (snapA.trackId === trackIdsRef.current.a ? snapA.duration : 0) ||
        waveDursRef.current.a;
      const dB =
        (snapB.trackId === trackIdsRef.current.b ? snapB.duration : 0) ||
        waveDursRef.current.b;
      const drawKey =
        `${scrollPx}:${px}:${player.getMixTime()}:${viewport.clientWidth}:` +
        `${dA}:${dB}:${modelVersionRef.current}`;
      const didDraw = drawKey !== lastDrawKey;
      if (didDraw) {
        lastDrawKey = drawKey;
        if (contentRef.current) {
          contentRef.current.style.transform = `translateX(${-scrollPx}px)`;
        }
        if (waveWrapARef.current) waveWrapARef.current.style.transform = `translateX(${scrollPx}px)`;
        if (waveWrapBRef.current) waveWrapBRef.current.style.transform = `translateX(${scrollPx}px)`;
        for (const el of laneLabelRefs.current.values()) {
          el.style.transform = `translateX(${scrollPx}px)`;
        }
        for (const el of laneEdgeRefs.current.values()) {
          el.style.transform = `translateX(${scrollPx}px)`;
        }
        for (const el of laneBackdropRefs.current.values()) {
          el.style.transform = `translateX(${scrollPx}px)`;
        }
        for (const fn of laneScrollDraws.current.values()) {
          fn(scrollPx, scrollPx + viewport.clientWidth);
        }
        if (playheadRef.current) {
          // transform, not `left`: a layout-property write per frame forces
          // style/layout recalc scaling with the whole document (the embedded
          // library table) — the library-mode jitter disease (issue 10).
          playheadRef.current.style.transform = `translateX(${player.getMixTime() * px}px)`;
        }
        const scrollSec = scrollPx / px;
        const viewSec = viewport.clientWidth / px;
        const m = mixRef.current;
        const s = snapRef.current;
        if (dA > 0) {
          const jumpsA = m.transition.jumpsA ?? [];
          if (jumpsA.length === 0) {
            // Legacy single-window path (zero jumps = zero new cost).
            rendA.rendererRef.current?.setDisplaySegments(null);
            rendA.rendererRef.current?.setDisplayWindow(scrollSec / dA, (scrollSec + viewSec) / dA);
          } else {
            // DAW splice for the OUTGOING row (issue 177): mix time is A's
            // elapsed play — repeated audio drawn repeated. Native rate,
            // no grey head (A starts at track 0 = mix 0); the greyed tail
            // rides as the last draw segment.
            const mixTime = player.getMixTime();
            const segs = aDrawSegmentsRef.current;
            let ownerIdx = segs.findIndex((g) => mixTime < g.mixEndSec);
            if (ownerIdx === -1) ownerIdx = segs.length - 1;
            const strips = [];
            for (let i = 0; i < segs.length; i++) {
              const g = segs[i];
              const visStart = Math.max(g.mixStartSec, scrollSec);
              const visEnd = Math.min(g.mixEndSec, scrollSec + viewSec);
              if (visEnd <= visStart) continue;
              const aAtVisStart = g.bStartSec + (visStart - g.mixStartSec);
              strips.push({
                x0Frac: (visStart - scrollSec) / viewSec,
                x1Frac: (visEnd - scrollSec) / viewSec,
                first: aAtVisStart / dA,
                last: (aAtVisStart + (visEnd - visStart)) / dA,
                drawPlayhead: i === ownerIdx,
                // A's modulation already reads mix time; the affine maps
                // the renderer's track domain onto it (rate 1).
                modAffine: { offset: g.mixStartSec - g.bStartSec, scale: 1 },
              });
            }
            rendA.rendererRef.current?.setDisplaySegments(strips);
          }
        }
        if (dB > 0) {
          const jumps = m.transition.jumps ?? [];
          if (jumps.length === 0) {
            // Legacy single-window path (zero jumps = zero new cost).
            rendB.rendererRef.current?.setDisplaySegments(null);
            const first =
              (m.transition.bInSec + (scrollSec - m.transition.startSec) * s.rateB) / dB;
            rendB.rendererRef.current?.setDisplayWindow(first, first + (viewSec * s.rateB) / dB);
          } else {
            // DAW splice (transition-takes 06): map the walk's segments
            // into viewport strips. The playhead marker belongs to the
            // segment that owns the current MIX time (replayed content
            // holds the same track time twice).
            const mixTime = player.getMixTime();
            const segs = bSegmentsRef.current;
            // Playhead ownership: the first segment still ahead of (or
            // containing) the mix time — in segment 0's grey head or a
            // splice gap the deck clock clamps to the NEXT content's
            // start, so the marker lands on that strip's left edge; past
            // B's end it parks on the last strip's right edge.
            let ownerIdx = segs.findIndex((g) => mixTime < g.mixEndSec);
            if (ownerIdx === -1) ownerIdx = segs.length - 1;
            const strips = [];
            for (let i = 0; i < segs.length; i++) {
              const g = segs[i];
              const drawStart =
                i === 0 ? Math.max(0, g.mixStartSec - g.bStartSec / s.rateB) : g.mixStartSec;
              const visStart = Math.max(drawStart, scrollSec);
              const visEnd = Math.min(g.mixEndSec, scrollSec + viewSec);
              if (visEnd <= visStart) continue;
              const bAtVisStart = g.bStartSec + (visStart - g.mixStartSec) * s.rateB;
              strips.push({
                x0Frac: (visStart - scrollSec) / viewSec,
                x1Frac: (visEnd - scrollSec) / viewSec,
                first: bAtVisStart / dB,
                last: (bAtVisStart + (visEnd - visStart) * s.rateB) / dB,
                drawPlayhead: i === ownerIdx,
                // Mix-domain envelopes (the modulation fn switches domain
                // with the splice — see the modulation effect).
                modAffine: {
                  offset: g.mixStartSec - g.bStartSec / s.rateB,
                  scale: 1 / s.rateB,
                },
              });
            }
            // An empty array is deliberate: spliced-with-nothing-visible
            // clears the row (never fall back to a stale window).
            rendB.rendererRef.current?.setDisplaySegments(strips);
          }
        }
        // Paint both rows NOW — same frame as the transforms above.
        drawRowsRef.current.a();
        drawRowsRef.current.b();
      }
      if (perf) {
        perfMax = Math.max(perfMax, performance.now() - t0);
        if (t0 - perfLast >= 1000) {
          console.log(`[protoperf] worst tick last 1s: ${perfMax.toFixed(1)}ms`);
          perfMax = 0;
          perfLast = t0;
        }
      }
      schedule(player.isPlaying() || pendingZoomRef.current !== null || didDraw);
    };
    tick();
    return () => {
      wakeTickRef.current = () => {};
      cancelAnimationFrame(raf);
      window.clearTimeout(idleTimer);
    };
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

  /** Frame the Transition window: viewport spans the window plus ~10%
   * padding each side. The load-time view (frameSignal) and the view when
   * durations first arrive. */
  const frameTransition = useCallback(() => {
    const w = viewportRef.current?.clientWidth ?? 800;
    const tr = mixRef.current.transition;
    const dur = Math.max(tr.durationSec, 1);
    const span = dur * 1.2;
    const px = Math.min(MAX_PX_PER_SEC, Math.max(0.05, (w - 2) / span));
    pxRef.current = px;
    scrollPxRef.current = Math.max(0, (tr.startSec - dur * 0.1) * px);
    // flushSync, like the wheel-zoom path above: the refs and the React
    // commit must land in the same frame. Mutating pxRef ahead of an async
    // commit let a rAF tick consume the dirty key with stale lane geometry
    // (geomRef/lastViewRef from the old zoom) — envelopes then didn't
    // redraw on Transition switch until a zoom/scroll changed the key.
    flushSync(() => setPxPerSec(px));
  }, []);

  // Re-frame whenever a Transition is loaded/switched (parent bumps the
  // signal). Also runs on mount for the initial view. The frame stays
  // ARMED until the pair's durations are in: a load that swaps both
  // tracks (opening a Take) frames before audio/waveforms resolve —
  // geometry built on zero durations gets scroll-clamped into the weeds
  // (window start pinned at the viewport edge) and the old once-only
  // auto-fit never refired. Re-framing on readiness settles it.
  const framePending = useRef(false);
  useEffect(() => {
    framePending.current = true;
    frameTransition();
  }, [frameSignal, frameTransition]);

  useEffect(() => {
    if (framePending.current && durA > 0 && durB > 0) {
      framePending.current = false;
      frameTransition();
    }
  }, [durA, durB, frameTransition]);

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
      } else {
        // Continuous exponential zoom: proportional for fine trackpad deltas
        // and ~1.16x per mouse-wheel notch (1.0015^100).
        const pending = pendingZoomRef.current;
        pendingZoomRef.current = {
          factor: (pending?.factor ?? 1) * Math.pow(1.0015, -e.deltaY * unit),
          clientX: e.clientX,
        };
      }
      // Jump the loop off its idle timeout NOW — the first frame of a
      // gesture must not wait out IDLE_TICK_MS.
      wakeTickRef.current();
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  const EDGE_PX = 8;

  const zoneAt = (clientX: number, row: 'A' | 'B'): 'aTrim' | 'bTrim' | 'bMove' | 'seek' => {
    const sec = secAtClientX(clientX);
    const m = mixRef.current;
    const edgeSec = EDGE_PX / pxRef.current;
    // Both transition edges are grabbable from EITHER row (the edge lines
    // span the full timeline height, so the affordance shouldn't care which
    // track the pointer happens to be over). Nearest edge wins when the
    // window is narrow enough for both to be in range.
    const dStart = Math.abs(sec - m.transition.startSec);
    const dEnd = Math.abs(sec - (m.transition.startSec + m.transition.durationSec));
    const bTrimOk = trackBId !== null && dStart < edgeSec;
    const aTrimOk = trackAId !== null && dEnd < edgeSec;
    if (bTrimOk && (!aTrimOk || dStart <= dEnd)) return 'bTrim';
    if (aTrimOk) return 'aTrim';
    if (row === 'B') {
      if (trackBId === null) return 'seek';
      // Piecewise footprint (transition-takes 06): grab anywhere audible
      // B content is drawn — splice gaps fall through to seek.
      for (const g of bSegmentsRef.current) {
        if (sec > g.mixStartSec && sec < g.mixEndSec) return 'bMove';
      }
    }
    return 'seek';
  };

  const onRowPointerDown = (row: 'A' | 'B') => (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    wakeTickRef.current(); // same idle-latency hole as the wheel path

    const sec = secAtClientX(e.clientX);
    const zone = zoneAt(e.clientX, row);
    if (zone === 'seek') {
      drag.current = null;
      player.seek(sec);
      return;
    }
    // bMove grabs the window start when locked (window rides B), or B's
    // content origin when unlocked (content slides under a fixed window).
    const tr0 = mixRef.current.transition;
    const originMix = tr0.startSec - tr0.bInSec / snapRef.current.rateB;
    drag.current = {
      kind: zone,
      downClientX: e.clientX,
      moved: false,
      grabOffsetSec:
        zone === 'bMove' ? sec - (snapRef.current.lockedWindow ? tr0.startSec : originMix) : 0,
      origLanes: structuredClone(tr0.lanes),
      origJumps: tr0.jumps ? structuredClone(tr0.jumps) : undefined,
      origJumpsA: tr0.jumpsA ? structuredClone(tr0.jumpsA) : undefined,
      origDur: tr0.durationSec,
      origStart: tr0.startSec,
    };
  };

  /** Release: a bMove that never moved is a click — seek (row-A parity). */
  const onRowPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (d && d.kind === 'bMove' && !d.moved) player.seek(secAtClientX(e.clientX));
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
    // Ignore sub-threshold jitter so a click stays a click (and micro
    // wobbles don't mutate the model); past it, the drag is committed.
    if (!d.moved && Math.abs(e.clientX - d.downClientX) <= 4) return;
    d.moved = true;
    // Shift = fine drag: beat snap suspended while held (issue 09).
    const snapOn = s.snap && !e.shiftKey;
    onChange((m) => {
      if (d.kind === 'bMove') {
        if (!s.lockedWindow) {
          // Unlocked: the window stays with A — the drag slides B's content
          // origin, mutating bInSec only. Snap aligns B's GRID to A's GRID
          // (issue 25): take B's beat nearest the window anchor (its first
          // beat when the anchor sits in a lead gap), land its mix-time
          // position on A's nearest gridline, solve back for bInSec. The
          // window edge itself is NOT a snap target — startSec may sit
          // off A's grid (typed values), and B's beats must still land
          // on A's beats.
          const newOrigin = sec - d.grabOffsetSec;
          let bIn = (m.transition.startSec - newOrigin) * s.rateB;
          if (snapOn) {
            if (s.beatsA?.length && s.beatsB?.length) {
              const refB = nearestTime(s.beatsB, bIn) ?? bIn;
              const refMix =
                m.transition.startSec + (refB - bIn) / s.rateB;
              const snapped = nearestTime(s.beatsA, refMix) ?? refMix;
              bIn = refB - (snapped - m.transition.startSec) * s.rateB;
            } else if (s.beatsB?.length && bIn >= 0) {
              // No A grid: fall back to a B beat on the window start.
              bIn = nearestTime(s.beatsB, bIn) ?? bIn;
            } else if (s.beatsA?.length && bIn < 0) {
              // No B grid: fall back to B's audio start on A's grid.
              const audioStart = m.transition.startSec - bIn / s.rateB;
              const snapped = nearestTime(s.beatsA, audioStart) ?? audioStart;
              bIn = (m.transition.startSec - snapped) * s.rateB;
            }
          }
          return { ...m, transition: { ...m.transition, bInSec: bIn } };
        }
        let start = Math.max(0, sec - d.grabOffsetSec);
        if (snapOn && s.beatsA) {
          start = nearestTime(s.beatsA, start) ?? start;
        }
        return { ...m, transition: { ...m.transition, startSec: start } };
      }
      if (d.kind === 'bTrim') {
        // Left-edge resize: the transition END stays anchored; B's content
        // stays anchored (entry trims with the edge, DAW clip-trim style).
        const origEnd = d.origStart + d.origDur;
        const originMix = m.transition.startSec - m.transition.bInSec / s.rateB;
        let bIn = Math.max(0, (sec - originMix) * s.rateB);
        if (snapOn && s.beatsB) {
          bIn = nearestTime(s.beatsB, bIn) ?? bIn;
        }
        bIn = Math.min(Math.max(bIn, 0), Math.max(durB - 0.1, 0));
        const newStart = originMix + bIn / s.rateB;
        const newDur = Math.max(origEnd - newStart, 0);
        // Default = crop (lanes/jumps keep absolute timing); alt = stretch.
        const lanes = e.altKey
          ? d.origLanes
          : cropRemapLanesLeft(d.origLanes, d.origDur, newDur);
        const jumps = e.altKey
          ? d.origJumps
          : cropRemapJumpsLeft(d.origJumps, d.origDur, newDur);
        const jumpsA = e.altKey
          ? d.origJumpsA
          : cropRemapJumpsLeft(d.origJumpsA, d.origDur, newDur);
        return {
          ...m,
          transition: {
            ...m.transition,
            startSec: newStart,
            durationSec: newDur,
            bInSec: bIn,
            // No clone: cropRemap output is fresh; the alt path aliases the
            // drag-start snapshot, which is itself a private clone and lane
            // edits never mutate point arrays in place.
            lanes,
            jumps,
            jumpsA,
          },
        };
      }
      const maxEnd = durA > 0 ? durA : Infinity;
      let newEnd = Math.min(Math.max(sec, m.transition.startSec), maxEnd);
      if (snapOn && s.beatsA) {
        const snapped = nearestTime(s.beatsA, newEnd);
        if (snapped !== null) newEnd = Math.min(Math.max(snapped, m.transition.startSec), maxEnd);
      }
      const newDur = newEnd - m.transition.startSec;
      // Default = crop (lanes/jumps keep absolute timing); alt = stretch
      // (shapes scale with the region — normalized points, no remap). Both
      // derive from the drag-start snapshot.
      const lanes = e.altKey
        ? d.origLanes
        : cropRemapLanes(d.origLanes, d.origDur, newDur);
      const jumps = e.altKey ? d.origJumps : cropRemapJumps(d.origJumps, d.origDur, newDur);
      const jumpsA = e.altKey ? d.origJumpsA : cropRemapJumps(d.origJumpsA, d.origDur, newDur);
      return {
        ...m,
        transition: { ...m.transition, durationSec: newDur, lanes, jumps, jumpsA },
      };
    });
  };

  const endDrag = () => (drag.current = null);

  // ── Jump events (transition-takes 01; both roles since issue 177) ─────
  // Markers on the mix axis: drag moves the instant (A-grid snap — the
  // instant lives on mix time), click opens the delta editor, double-click
  // on a row inside the window adds one on THAT deck. Each waveform keeps
  // its base (no-jump) alignment mapping for snap targets — post-jump
  // content on screen is a known v1 approximation; the AUDIO is
  // authoritative (arrangementAt).
  const [editingJump, setEditingJump] = useState<null | { role: 'A' | 'B'; index: number }>(null);
  const jumpDrag = useRef<null | {
    role: 'A' | 'B';
    index: number;
    downClientX: number;
    moved: boolean;
  }>(null);

  // A Transition switch invalidates jump indices — close the editor.
  useEffect(() => setEditingJump(null), [frameSignal]);

  const onJumpPointerDown =
    (role: 'A' | 'B', i: number) => (e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      jumpDrag.current = { role, index: i, downClientX: e.clientX, moved: false };
    };

  const onJumpPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = jumpDrag.current;
    if (!d) return;
    // Same ≤4px click-vs-drag threshold as the row drags above.
    if (!d.moved && Math.abs(e.clientX - d.downClientX) <= 4) return;
    d.moved = true;
    const m = mixRef.current;
    const s = snapRef.current;
    let sec = secAtClientX(e.clientX);
    if (s.snap && !e.shiftKey && s.beatsA?.length) sec = nearestTime(s.beatsA, sec) ?? sec;
    const dur = m.transition.durationSec;
    const x = dur > 0 ? (sec - m.transition.startSec) / dur : 0;
    store.updateJump(d.index, { x: Math.max(0, Math.min(1, x)) }, d.role);
  };

  const onJumpPointerUp = () => {
    const d = jumpDrag.current;
    jumpDrag.current = null;
    if (d && !d.moved) {
      setEditingJump((cur) =>
        cur && cur.role === d.role && cur.index === d.index
          ? null
          : { role: d.role, index: d.index }
      );
    }
  };

  /** Double-click on a deck row inside the window: add a jump on that
   * deck there (Δ 0 — the editor that opens sets the distance). */
  const onRowDoubleClick = (role: 'A' | 'B') => (e: React.MouseEvent<HTMLDivElement>) => {
    const m = mixRef.current;
    const dur = m.transition.durationSec;
    const sec = secAtClientX(e.clientX);
    if (dur <= 0 || sec < m.transition.startSec || sec > m.transition.startSec + dur) return;
    store.addJump((sec - m.transition.startSec) / dur, role);
    const arr = role === 'A' ? m.transition.jumpsA : m.transition.jumps;
    setEditingJump({ role, index: arr?.length ?? 0 }); // appended index
  };

  /** One beat in each deck's own seconds (Δ steppers and chip labels). */
  const beatSecA = beatgridA ? beatPeriodSec(beatgridA) : null;
  const beatSecB = beatgridB ? beatPeriodSec(beatgridB) : null;

  // Downbeat time → Metric-ladder tier + parenthetical flag, per side
  // (metric-ladder 01/02/03, with persisted Reset marks applied). Keyed on
  // the exact floats of downbeat_times — the guides read the same array.
  const tiersA = useMemo(() => downbeatLadderMap(beatgridA, ladderA), [beatgridA, ladderA]);
  const tiersB = useMemo(() => downbeatLadderMap(beatgridB, ladderB), [beatgridB, ladderB]);

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
      // Guides map through A's spliced segments (issue 177, mirroring
      // guidesB): per segment ∩ window, binary-search the beats in that
      // segment's track range and land them at their MIX position — a
      // beat in replayed material appears once per replay. One segment =
      // the legacy behavior. Rate is 1: mix time IS A's elapsed play.
      const beats = beatgridA.beat_times;
      for (const g of aSegments) {
        const segStart = Math.max(g.mixStartSec, tr.startSec);
        const segEnd = Math.min(g.mixEndSec, tr.startSec + dur);
        if (segEnd <= segStart) continue;
        const btFrom = g.bStartSec + (segStart - g.mixStartSec);
        const btTo = g.bStartSec + (segEnd - g.mixStartSec);
        for (let i = lowerBound(beats, btFrom); i < beats.length; i++) {
          const b = beats[i];
          if (b > btTo) break;
          const strong = downs.has(b);
          if (!strong && !showWeak) continue;
          const mixT = g.mixStartSec + (b - g.bStartSec);
          const la = tiersA.get(b);
          out.push({ x: (mixT - tr.startSec) / dur, strong, tier: la?.tier, parenthetical: la?.parenthetical });
        }
      }
    }
    for (const c of hotCuesA) {
      // A hot cue can land in SEVERAL segments (replayed content).
      for (const g of aSegments) {
        if (c.time_seconds < g.bStartSec) continue;
        const mixT = g.mixStartSec + (c.time_seconds - g.bStartSec);
        if (mixT < Math.max(g.mixStartSec, tr.startSec)) continue;
        if (mixT > Math.min(g.mixEndSec, tr.startSec + dur)) continue;
        out.push({
          x: (mixT - tr.startSec) / dur,
          strong: true,
          // Slot palette fallback, stored-color-wins (mix-editor 32).
          color: cueCssColor(c.slot_number, c.color),
        });
      }
    }
    return out;
  }, [beatgridA, hotCuesA, tr.startSec, tr.durationSec, pxPerSec, tiersA, aSegments]);

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
      // Guides map through the spliced segments (transition-takes 06):
      // per segment ∩ window, binary-search the beats in that segment's
      // B-range and land them at their MIX position. One segment = the
      // legacy behavior.
      const beats = beatgridB.beat_times;
      for (const g of bSegments) {
        const segStart = Math.max(g.mixStartSec, tr.startSec);
        const segEnd = Math.min(g.mixEndSec, tr.startSec + dur);
        if (segEnd <= segStart) continue;
        const btFrom = g.bStartSec + (segStart - g.mixStartSec) * rateB;
        const btTo = g.bStartSec + (segEnd - g.mixStartSec) * rateB;
        for (let i = lowerBound(beats, btFrom); i < beats.length; i++) {
          const bt = beats[i];
          if (bt > btTo) break;
          const strong = downs.has(bt);
          if (!strong && !showWeak) continue;
          const mixT = g.mixStartSec + (bt - g.bStartSec) / rateB;
          const lb = tiersB.get(bt);
          out.push({ x: (mixT - tr.startSec) / dur, strong, tier: lb?.tier, parenthetical: lb?.parenthetical });
        }
      }
    }
    for (const c of hotCuesB) {
      // A hot cue can land in SEVERAL segments (replayed content).
      for (const g of bSegments) {
        if (c.time_seconds < g.bStartSec) continue;
        const mixT = g.mixStartSec + (c.time_seconds - g.bStartSec) / rateB;
        if (mixT < Math.max(g.mixStartSec, tr.startSec)) continue;
        if (mixT > Math.min(g.mixEndSec, tr.startSec + dur)) continue;
        out.push({
          x: (mixT - tr.startSec) / dur,
          strong: true,
          color: cueCssColor(c.slot_number, c.color),
        });
      }
    }
    return out;
  }, [beatgridB, hotCuesB, tr.startSec, tr.durationSec, rateB, pxPerSec, bSegments, tiersB]);

  /** Jump stamps + Δ popover for one deck's row (issue 177: role-aware —
   * 'A' renders the outgoing's jumps on row A, deltas in A's own beats). */
  const jumpMarkers = (role: 'A' | 'B') => {
    const arr = (role === 'A' ? tr.jumpsA : tr.jumps) ?? [];
    const beatSec = role === 'A' ? beatSecA : beatSecB;
    const editing =
      editingJump && editingJump.role === role && arr[editingJump.index] !== undefined
        ? editingJump.index
        : null;
    return (
      <>
        {arr.map((j, i) => (
          <div
            key={i}
            className={`editor-jump ${role === 'A' ? 'a' : 'b'}`}
            style={{ left: (tr.startSec + j.x * tr.durationSec) * pxPerSec }}
            onPointerDown={onJumpPointerDown(role, i)}
            onPointerMove={onJumpPointerMove}
            onPointerUp={onJumpPointerUp}
            onPointerCancel={() => (jumpDrag.current = null)}
            onDoubleClick={(e) => e.stopPropagation()}
            title="Jump event — drag to move, click to edit"
          >
            <span className="editor-jump-chip">
              {j.deltaSec < 0 ? <JumpBackIcon size={11} /> : <JumpForwardIcon size={11} />}{' '}
              {jumpDeltaLabel(j.deltaSec, beatSec)}
              {jumpRepeatCount(j) > 1 ? ` ×${jumpRepeatCount(j)}` : ''}
            </span>
          </div>
        ))}
        {editing !== null && (
          <div
            className="editor-jump-popover"
            style={{
              left: (tr.startSec + arr[editing].x * tr.durationSec) * pxPerSec + 8,
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <label>
              Δ
              <input
                type="number"
                step={0.1}
                value={Number(arr[editing].deltaSec.toFixed(2))}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) store.updateJump(editing, { deltaSec: v }, role);
                }}
              />
              s
            </label>
            {beatSec && (
              <span className="editor-jump-beatsteps">
                {[-4, -1, 1, 4].map((n) => (
                  <button
                    key={n}
                    title={`${n > 0 ? '+' : ''}${n} ${role} beat${Math.abs(n) > 1 ? 's' : ''}`}
                    onClick={() =>
                      store.updateJump(
                        editing,
                        { deltaSec: arr[editing].deltaSec + n * beatSec },
                        role
                      )
                    }
                  >
                    {n > 0 ? `+${n}` : n}
                  </button>
                ))}
              </span>
            )}
            <button
              className="editor-jump-delete"
              onClick={() => {
                store.removeJump(editing, role);
                setEditingJump(null);
              }}
            >
              delete
            </button>
            <button onClick={() => setEditingJump(null)}>✕</button>
          </div>
        )}
      </>
    );
  };

  const laneStrip = (id: LaneId) => (
    <div key={id} className={`editor-lanestrip ${id.endsWith('A') ? 'a' : 'b'}`}>
      <span
        className="editor-lanebackdrop"
        ref={(el) => {
          if (el) laneBackdropRefs.current.set(id, el);
          else laneBackdropRefs.current.delete(id);
        }}
      />
      <span
        className="editor-laneedge"
        style={{ background: LANE_COLORS[id] }}
        ref={(el) => {
          if (el) laneEdgeRefs.current.set(id, el);
          else laneEdgeRefs.current.delete(id);
        }}
      />
      <span
        className="editor-lanelabel"
        style={{ color: LANE_COLORS[id] }}
        ref={(el) => {
          if (el) laneLabelRefs.current.set(id, el);
          else laneLabelRefs.current.delete(id);
        }}
      >
        {LANE_LABELS[id]}
      </span>
      <div
        className="editor-lanewindow"
        style={{ left: tr.startSec * pxPerSec, width: Math.max(tr.durationSec * pxPerSec, 4) }}
      >
        <LaneCanvas
          id={id}
          widthPx={Math.max(tr.durationSec * pxPerSec, 4)}
          points={tr.lanes[id]?.length ? tr.lanes[id] : defaultPts.get(id)!}
          guides={id.endsWith('A') ? guidesA : guidesB}
          chopWall={0.02 / Math.max(tr.durationSec, 0.01)}
          windowLeftPx={tr.startSec * pxPerSec}
          registerScrollDraw={registerScrollDraw}
          onChange={(pts) => onLaneChange(id, pts)}
          selected={laneSel?.lane === id ? laneSel.indices : NO_SELECTION}
          onSelectedChange={(indices) =>
            setLaneSel(indices.length > 0 ? { lane: id, indices } : null)
          }
        />
      </div>
    </div>
  );

  // Strips render in the fixed mirrored display order (review nit
  // 2026-07-06): A top→bottom FILTER→FADER, B FADER→FILTER — never the
  // model's insertion order.
  const lanesA = DECK_LANE_ORDER.A.filter((id) => visibleLanes.includes(id));
  const lanesB = DECK_LANE_ORDER.B.filter((id) => visibleLanes.includes(id));

  // Stable default-shape identities: lanePoints() mints a fresh default
  // array per call, which made every DawTimeline render redraw every
  // undrawn lane's canvas (the draw effect keys on points identity).
  const defaultPts = useMemo(() => {
    const m = new Map<LaneId, LanePoint[]>();
    for (const id of LANE_IDS) m.set(id, defaultLanePoints(id, tr.durationSec));
    return m;
  }, [tr.durationSec]);

  return (
    <div className="editor-timeline-wrap">
      <div className="editor-timeline">
        {/* Lane toggle gutter (mix-editor 32): per-deck chip strips at the
            left edge of each deck's lane region — A's at the top, B's at
            the bottom, mirroring the strip stack. On = addLane (unhide,
            envelope restored), off = hideLane (envelope kept; hidden
            lanes play their default) — per-Transition, persisted. */}
        <div className="editor-lanegutter">
          {(['A', 'B'] as const).map((deck) => (
            <div key={deck} className="editor-lanetoggles">
              {DECK_LANE_ORDER[deck].map((id) => {
                const on = visibleLanes.includes(id);
                return (
                  <button
                    key={id}
                    className={`editor-lanetoggle${on ? ' on' : ''}`}
                    aria-pressed={on}
                    style={
                      on
                        ? { background: LANE_COLORS[id], borderColor: LANE_COLORS[id] }
                        : { color: LANE_COLORS[id], borderColor: LANE_COLORS[id] }
                    }
                    title={
                      on
                        ? `Hide the ${LANE_LABELS[id]} ${deck} lane (envelope kept — it plays its default)`
                        : `Show the ${LANE_LABELS[id]} ${deck} lane (drawn envelope restored)`
                    }
                    onClick={(e) => {
                      if (on) store.hideLane(id);
                      else store.addLane(id);
                      e.currentTarget.blur();
                    }}
                  >
                    {LANE_LABELS[id]}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div ref={viewportRef} className="editor-timeline-viewport">
        <div
          ref={contentRef}
          className="editor-timeline-content"
          style={{ width: contentEnd * pxPerSec }}
        >
          {/* Stacked halves (issue 13): A lanes / A wave (peaks down) /
              seam / B wave (peaks up) / B lanes — quiet audio hugs the
              outer edges, loud peaks meet at the seam. */}
          {lanesA.map(laneStrip)}

          {/* Row A */}
          <div
            className="editor-timeline-row a"
            onPointerDown={onRowPointerDown('A')}
            onPointerMove={onRowPointerMove('A')}
            onPointerUp={onRowPointerUp}
            onPointerCancel={endDrag}
            onDoubleClick={onRowDoubleClick('A')}
          >
            <div ref={waveWrapARef} className="editor-wavecanvas" style={{ width: viewW }}>
              <canvas ref={rendA.canvasRef} />
            </div>
            {trackAId !== null && durA > 0 && (
              <GainFill
                points={lanePoints(tr.lanes, 'faderA', tr.durationSec)}
                color={LANE_COLORS.faderA}
                leftPx={tr.startSec * pxPerSec}
                widthPx={tr.durationSec * pxPerSec}
                anchor="top"
              />
            )}
            {/* Piecewise footprint (issue 177): one frame per audible A
                segment — a single frame when jumpsA is empty. */}
            {trackAId !== null &&
              durA > 0 &&
              aSegments.map((g, i) => (
                <div
                  key={`af${i}`}
                  className="editor-blockframe a"
                  style={{
                    left: g.mixStartSec * pxPerSec,
                    width: (g.mixEndSec - g.mixStartSec) * pxPerSec,
                  }}
                />
              ))}
            {/* A goes silent at the transition end: grey the tail (drawn
                from the exit position, simulated through jumps). */}
            {trackAId !== null && aFootprintEnd > aEnd && (
              <div
                className="editor-inaudible"
                style={{ left: aEnd * pxPerSec, width: (aFootprintEnd - aEnd) * pxPerSec }}
              />
            )}
            {/* Outgoing Jump events (issue 177) — first-class stamps,
                editable like the incoming's. */}
            {jumpMarkers('A')}
          </div>

          {/* Row B — flush under A, forming the seam. */}
          <div
            className="editor-timeline-row b"
            onPointerDown={onRowPointerDown('B')}
            onPointerMove={onRowPointerMove('B')}
            onPointerUp={onRowPointerUp}
            onPointerCancel={endDrag}
            onDoubleClick={onRowDoubleClick('B')}
          >
            <div ref={waveWrapBRef} className="editor-wavecanvas" style={{ width: viewW }}>
              <canvas ref={rendB.canvasRef} />
            </div>
            {trackBId !== null && durB > 0 && (
              <GainFill
                points={lanePoints(tr.lanes, 'faderB', tr.durationSec)}
                color={LANE_COLORS.faderB}
                leftPx={tr.startSec * pxPerSec}
                widthPx={tr.durationSec * pxPerSec}
                anchor="bottom"
              />
            )}
            {/* Piecewise footprint (transition-takes 06): one frame per
                audible segment — a jump past B's end truncates, a jump
                below zero leaves an unframed gap. */}
            {trackBId !== null &&
              durB > 0 &&
              bSegments.map((g, i) => (
                <div
                  key={`bf${i}`}
                  className="editor-blockframe b"
                  style={{
                    left: g.mixStartSec * pxPerSec,
                    width: (g.mixEndSec - g.mixStartSec) * pxPerSec,
                  }}
                />
              ))}
            {/* B's content before the window start is drawn for context
                but never plays: grey the head (first segment only). */}
            {trackBId !== null &&
              durB > 0 &&
              bSegments.length > 0 &&
              bSegments[0].mixStartSec > segDrawStart(0) && (
                <div
                  className="editor-inaudible"
                  style={{
                    left: segDrawStart(0) * pxPerSec,
                    width: (bSegments[0].mixStartSec - segDrawStart(0)) * pxPerSec,
                  }}
                />
              )}

            {/* Jump events (glossary): discontinuities of THIS deck — the
                seam line spans this row only, deck-colored, with the Δ
                chip riding the waveform's edge. */}
            {jumpMarkers('B')}
          </div>
          {lanesB.map(laneStrip)}

          {/* Transition overlap highlight */}
          {tr.durationSec > 0 && (
            <div
              className="editor-overlap"
              style={{ left: tr.startSec * pxPerSec, width: tr.durationSec * pxPerSec }}
            />
          )}

          {/* Mix playhead */}
          <div ref={playheadRef} className="editor-playhead" />

          {/* Live Conductor playhead (sets 38): where the ongoing set is
              on THIS pair's timeline — the outgoing's solo, the window,
              and the incoming's tail. */}
          <ConductorLanePlayhead store={store} pxPerSec={pxPerSec} />
        </div>
        </div>
      </div>

      {/* Whole-mix overview under the detail view, above the controls. */}
      <GlobalMinimap
        player={player}
        mix={mix}
        waveA={waveA ?? null}
        waveB={waveB ?? null}
        rateB={rateB}
        contentEnd={contentEnd}
        pxPerSec={pxPerSec}
        hotCuesA={hotCuesA}
        hotCuesB={hotCuesB}
        getScrollPx={() => scrollPxRef.current}
        setScrollPx={(px) => {
          scrollPxRef.current = Math.max(0, px);
        }}
        getViewPx={() => viewportRef.current?.clientWidth ?? 800}
      />

      <button className="editor-fit" onClick={fit} title="Zoom to fit">
        fit
      </button>
    </div>
  );
}
