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
import { toThreeBands } from '../waveform/blob';
import { useHotCues } from '../hooks/useHotCues';
import { MixPlayer } from './MixPlayer';
import { GlobalMinimap } from './GlobalMinimap';
import { LaneCanvas } from './LaneCanvas';
import { LANE_COLORS } from './laneColors';
import type { LaneGuide } from './LaneCanvas';
import {
  LANE_IDS,
  cropRemapJumps,
  cropRemapJumpsLeft,
  cropRemapLanes,
  cropRemapLanesLeft,
  defaultLanePoints,
  evalLane,
  lanePoints,
  nearestTime,
  visibleLaneIds,
} from './mixModel';
import type { JumpEvent, LaneId, LanePoint, Lanes, EditorMix } from './mixModel';
import { EditorStore, useEditorSelector } from './editorStore';
import { jumpDeltaLabel } from './beatReadout';
import { beatPeriodSec } from './templateModel';
import type { PlaybackClock } from '../playback/clock';
import type { BeatgridData } from '../types';

/** Zoom-in ceiling. At 240 px/s a 128 BPM beat spans ~112px — enough room
 * to place breakpoints between beats. */
const MAX_PX_PER_SEC = 240;

/** Envelope-preview LUT resolution (samples across the window). */
const MOD_LUT_N = 2048;

/** First index with arr[i] >= v (arr ascending). */
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
  /** Remove the lane from the editor (envelope kept; re-add restores). */
  const onLaneHide = useCallback((id: LaneId) => store.hideLane(id), [store]);
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
  // 3-band arrays for the global minimap's own 2D drawing (memoized: new
  // identities would re-fire its redraw effect every render).
  const waveA3 = useMemo(() => (waveA ? toThreeBands(waveA) : null), [waveA]);
  const waveB3 = useMemo(() => (waveB ? toThreeBands(waveB) : null), [waveB]);

  // Draw before decode (mix-editor 28): engine durations are 0 until
  // decodeAudioData finishes (seconds for two full tracks), but the
  // waveform response's duration arrives in milliseconds — geometry and
  // drawing use it as a fallback so waveforms + envelopes render
  // immediately. Audio readiness still gates transport (play button,
  // park-after-ready), never drawing.
  const durA = player.engineA.getSnapshot().duration || (waveA?.duration ?? 0);
  const durB = player.engineB.getSnapshot().duration || (waveB?.duration ?? 0);
  const waveDursRef = useRef({ a: 0, b: 0 });
  useEffect(() => {
    waveDursRef.current = { a: waveA?.duration ?? 0, b: waveB?.duration ?? 0 };
  });
  const tr = mix.transition;
  const aEnd = durA > 0 ? Math.min(tr.startSec + tr.durationSec, durA) : tr.startSec + tr.durationSec;
  // B is time-stretched on the mix axis by its playback rate. The block
  // starts at B's TRUE audio start: a negative entry anchor (bInSec < 0)
  // opens a silent lead gap after the window start before audio begins.
  const bAudioStartMix = tr.startSec + Math.max(0, -tr.bInSec) / rateB;
  const bBlockLenMix = Math.max(durB - Math.max(tr.bInSec, 0), 0) / rateB;
  /** Leftmost drawn B content (track 0 mapped to mix time, clipped at 0) —
   * drawn-but-inaudible head before the window start gets greyed. */
  const bHeadStartMix = Math.max(0, tr.startSec - tr.bInSec / rateB);
  /** Rightmost content edge: end of the last track. Nothing renders past it. */
  const contentEnd = Math.max(durA, bAudioStartMix + bBlockLenMix, 10);

  const beatsA = beatgridA?.beat_times;
  const beatsB = beatgridB?.beat_times;
  const snapRef = useRef({ snap, beatsA, beatsB, rateB, lockedWindow });
  useEffect(() => {
    snapRef.current = { snap, beatsA, beatsB, rateB, lockedWindow };
  });

  const { data: hotCuesA = [] } = useHotCues(trackAId);
  const { data: hotCuesB = [] } = useHotCues(trackBId);
  // Dimmed bands so hot cues / beatgrid pop in the editor rows (issue 05).
  // Stacked half-waveforms (issue 13): A's baseline at its top edge (peaks
  // grow down), B's at its bottom edge (peaks grow up) — loud peaks meet at
  // the seam between the two rows for transient-vs-transient beat reading.
  const rowConfigA = {
    isMinimapMode: false,
    playMarkerPosition: 0,
    waveformBrightness: 0.6,
    amplitudeAnchor: 'top' as const,
  };
  const rowConfigB = {
    isMinimapMode: false,
    playMarkerPosition: 0,
    waveformBrightness: 0.6,
    amplitudeAnchor: 'bottom' as const,
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
    driven: true,
  });
  const rendB = useWaveformRendererV2({
    clock: clockB,
    waveformData: waveB,
    config: rowConfigB,
    hotCues: hotCuesB,
    beatgrid: beatgridB,
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
    rendB.rendererRef.current?.setModulation(
      mkMod(
        modLuts.b,
        dur <= 0 ? (bt) => (bt < tr.bInSec ? 0 : 1) : (bt) => (bt - tr.bInSec) / (rateB * dur)
      )
    );
  }, [modLuts, tr.startSec, tr.durationSec, tr.bInSec, rateB, waveA, waveB, rendA.rendererRef, rendB.rendererRef]);

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

  // Dirty tracking for the tick: bump on any React-side change that affects
  // what the rows draw. The tick skips ALL per-frame writes + draws when its
  // key (scroll, zoom, mix time, durations, this version) is unchanged — an
  // idle editor costs ~nothing instead of two full WebGL passes per frame.
  const modelVersionRef = useRef(0);
  useEffect(() => {
    modelVersionRef.current++;
  }, [mix, rateB, waveA, waveB, hotCuesA, hotCuesB, beatgridA, beatgridB, viewW]);

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
    let lastDrawKey = '';
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
      // Same pre-decode duration fallback as the render path (issue 28).
      const dA = player.engineA.getSnapshot().duration || waveDursRef.current.a;
      const dB = player.engineB.getSnapshot().duration || waveDursRef.current.b;
      const drawKey =
        `${scrollPx}:${px}:${player.getMixTime()}:${viewport.clientWidth}:` +
        `${dA}:${dB}:${modelVersionRef.current}`;
      if (drawKey !== lastDrawKey) {
        lastDrawKey = drawKey;
        if (contentRef.current) {
          contentRef.current.style.transform = `translateX(${-scrollPx}px)`;
        }
        if (waveWrapARef.current) waveWrapARef.current.style.transform = `translateX(${scrollPx}px)`;
        if (waveWrapBRef.current) waveWrapBRef.current.style.transform = `translateX(${scrollPx}px)`;
        for (const el of laneLabelRefs.current.values()) {
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
          rendA.rendererRef.current?.setDisplayWindow(scrollSec / dA, (scrollSec + viewSec) / dA);
        }
        if (dB > 0) {
          const first = (m.transition.bInSec + (scrollSec - m.transition.startSec) * s.rateB) / dB;
          rendB.rendererRef.current?.setDisplayWindow(first, first + (viewSec * s.rateB) / dB);
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
  // signal). Also runs on mount for the initial view.
  useEffect(() => {
    frameTransition();
  }, [frameSignal, frameTransition]);

  const didAutoFit = useRef(false);
  useEffect(() => {
    if (!didAutoFit.current && (durA > 0 || durB > 0)) {
      didAutoFit.current = true;
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
      const bStart =
        m.transition.startSec + Math.max(0, -m.transition.bInSec) / snapRef.current.rateB;
      const lenMix = Math.max(durB - Math.max(m.transition.bInSec, 0), 0) / snapRef.current.rateB;
      if (sec > bStart && sec < bStart + lenMix) return 'bMove';
    }
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
      return {
        ...m,
        transition: { ...m.transition, durationSec: newDur, lanes, jumps },
      };
    });
  };

  const endDrag = () => (drag.current = null);

  // ── Jump events (transition-takes 01) ─────────────────────────────────
  // Markers on the mix axis: drag moves the instant (A-grid snap — the
  // instant lives on mix time), click opens the delta editor, double-click
  // on row B inside the window adds one. B's waveform keeps its base
  // (no-jump) alignment mapping — post-jump content on screen is a known
  // v1 approximation; the AUDIO is authoritative (arrangementAt).
  const [editingJump, setEditingJump] = useState<number | null>(null);
  const jumpDrag = useRef<null | { index: number; downClientX: number; moved: boolean }>(null);

  // A Transition switch invalidates jump indices — close the editor.
  useEffect(() => setEditingJump(null), [frameSignal]);

  const onJumpPointerDown = (i: number) => (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    jumpDrag.current = { index: i, downClientX: e.clientX, moved: false };
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
    store.updateJump(d.index, { x: Math.max(0, Math.min(1, x)) });
  };

  const onJumpPointerUp = () => {
    const d = jumpDrag.current;
    jumpDrag.current = null;
    if (d && !d.moved) setEditingJump((cur) => (cur === d.index ? null : d.index));
  };

  /** Double-click on row B inside the window: add a jump there (Δ 0 —
   * the editor that opens sets the distance). */
  const onRowBDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const m = mixRef.current;
    const dur = m.transition.durationSec;
    const sec = secAtClientX(e.clientX);
    if (dur <= 0 || sec < m.transition.startSec || sec > m.transition.startSec + dur) return;
    store.addJump((sec - m.transition.startSec) / dur);
    setEditingJump(m.transition.jumps?.length ?? 0); // appended index
  };

  /** One B beat in B's own seconds (Δ steppers and chip labels). */
  const beatSecB = beatgridB ? beatPeriodSec(beatgridB) : null;

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
      // Binary-search the window slice instead of scanning every beat
      // (this memo re-runs per zoom frame).
      const beats = beatgridA.beat_times;
      for (let i = lowerBound(beats, tr.startSec); i < beats.length; i++) {
        const b = beats[i];
        if (b > tr.startSec + dur) break;
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
      // Window ⇔ B-track bounds: mixT ∈ [start, start+dur] ⇔ bt ∈
      // [bIn, bIn + dur·rateB] — binary-search the slice.
      const beats = beatgridB.beat_times;
      const btEnd = tr.bInSec + dur * rateB;
      for (let i = lowerBound(beats, tr.bInSec); i < beats.length; i++) {
        const bt = beats[i];
        if (bt > btEnd) break;
        const strong = downs.has(bt);
        if (!strong && !showWeak) continue;
        out.push({ x: (bt - tr.bInSec) / (rateB * dur), strong });
      }
    }
    for (const c of hotCuesB) {
      const mixT = tr.startSec + (c.time_seconds - tr.bInSec) / rateB;
      if (mixT < tr.startSec || mixT > tr.startSec + dur) continue;
      out.push({ x: (mixT - tr.startSec) / dur, strong: true, color: c.color || '#39ff14' });
    }
    return out;
  }, [beatgridB, hotCuesB, tr.startSec, tr.durationSec, tr.bInSec, rateB, pxPerSec]);

  const laneStrip = (id: LaneId) => (
    <div key={id} className={`editor-lanestrip ${id.endsWith('A') ? 'a' : 'b'}`}>
      <span
        className="editor-lanelabel"
        style={{ color: LANE_COLORS[id] }}
        ref={(el) => {
          if (el) laneLabelRefs.current.set(id, el);
          else laneLabelRefs.current.delete(id);
        }}
      >
        {id}
        <button
          className="editor-laneclear"
          title="Remove lane (envelope kept — re-add restores it)"
          onClick={() => onLaneHide(id)}
        >
          ×
        </button>
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
        />
      </div>
    </div>
  );

  const lanesA = visibleLanes.filter((id) => id.endsWith('A'));
  const lanesB = visibleLanes.filter((id) => id.endsWith('B'));

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
      <div ref={viewportRef} className="editor-timeline">
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
          >
            <div ref={waveWrapARef} className="editor-wavecanvas" style={{ width: viewW }}>
              <canvas ref={rendA.canvasRef} />
            </div>
            {trackAId !== null && durA > 0 && (
              <div className="editor-blockframe a" style={{ left: 0, width: aEnd * pxPerSec }} />
            )}
            {/* A goes silent at the transition end: grey the tail. */}
            {trackAId !== null && durA > aEnd && (
              <div
                className="editor-inaudible"
                style={{ left: aEnd * pxPerSec, width: (durA - aEnd) * pxPerSec }}
              />
            )}
          </div>

          {/* Row B — flush under A, forming the seam. */}
          <div
            className="editor-timeline-row b"
            onPointerDown={onRowPointerDown('B')}
            onPointerMove={onRowPointerMove('B')}
            onPointerUp={onRowPointerUp}
            onPointerCancel={endDrag}
            onDoubleClick={onRowBDoubleClick}
          >
            <div ref={waveWrapBRef} className="editor-wavecanvas" style={{ width: viewW }}>
              <canvas ref={rendB.canvasRef} />
            </div>
            {trackBId !== null && durB > 0 && (
              <div
                className="editor-blockframe b"
                style={{ left: bAudioStartMix * pxPerSec, width: bBlockLenMix * pxPerSec }}
              />
            )}
            {/* B's content before the window start is drawn for context
                but never plays: grey the head. */}
            {trackBId !== null && durB > 0 && bAudioStartMix > bHeadStartMix && (
              <div
                className="editor-inaudible"
                style={{
                  left: bHeadStartMix * pxPerSec,
                  width: (bAudioStartMix - bHeadStartMix) * pxPerSec,
                }}
              />
            )}
          </div>
          {lanesB.map(laneStrip)}

          {/* Transition overlap highlight */}
          {tr.durationSec > 0 && (
            <div
              className="editor-overlap"
              style={{ left: tr.startSec * pxPerSec, width: tr.durationSec * pxPerSec }}
            />
          )}

          {/* Jump events: incoming-track discontinuities (glossary). */}
          {(tr.jumps ?? []).map((j, i) => (
            <div
              key={i}
              className="editor-jump"
              style={{ left: (tr.startSec + j.x * tr.durationSec) * pxPerSec }}
              onPointerDown={onJumpPointerDown(i)}
              onPointerMove={onJumpPointerMove}
              onPointerUp={onJumpPointerUp}
              onPointerCancel={() => (jumpDrag.current = null)}
              title="Jump event — drag to move, click to edit"
            >
              <span className="editor-jump-chip">⤺ {jumpDeltaLabel(j.deltaSec, beatSecB)}</span>
            </div>
          ))}
          {editingJump !== null && tr.jumps?.[editingJump] && (
            <div
              className="editor-jump-popover"
              style={{
                left: (tr.startSec + tr.jumps[editingJump].x * tr.durationSec) * pxPerSec + 8,
              }}
            >
              <label>
                Δ
                <input
                  type="number"
                  step={0.1}
                  value={Number(tr.jumps[editingJump].deltaSec.toFixed(2))}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) store.updateJump(editingJump, { deltaSec: v });
                  }}
                />
                s
              </label>
              {beatSecB && (
                <span className="editor-jump-beatsteps">
                  {[-4, -1, 1, 4].map((n) => (
                    <button
                      key={n}
                      title={`${n > 0 ? '+' : ''}${n} B beat${Math.abs(n) > 1 ? 's' : ''}`}
                      onClick={() =>
                        store.updateJump(editingJump, {
                          deltaSec: tr.jumps![editingJump].deltaSec + n * beatSecB,
                        })
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
                  store.removeJump(editingJump);
                  setEditingJump(null);
                }}
              >
                delete
              </button>
              <button onClick={() => setEditingJump(null)}>✕</button>
            </div>
          )}

          {/* Mix playhead */}
          <div ref={playheadRef} className="editor-playhead" />
        </div>
      </div>

      {/* Whole-mix overview under the detail view, above the controls. */}
      <GlobalMinimap
        player={player}
        mix={mix}
        waveA={waveA3}
        waveB={waveB3}
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

