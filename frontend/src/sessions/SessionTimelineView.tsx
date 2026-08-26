/**
 * Session timeline (sessions 04 + iteration, ADR 0033): the per-Session
 * lens. Deck lanes in the Performance view's physical order (C A B D),
 * full-color styled waveforms of the audio that played (the app's one
 * Waveform style, CPU-interpreted per constant-rate trace run), an
 * audibility area-chart behind each waveform, beat gridlines mapped
 * through the playhead traces, jump/loop markers, Takes in place, idle
 * collapsed (and re-collapsible), machine tenure as honest gaps.
 *
 * Interaction parity with the editor/set timelines: axis-latched wheel
 * (horizontal = pan, vertical = cursor-anchored zoom), hover scrub,
 * click = moment (and SEEK while a replay is rolling), space =
 * pause/resume replay. A moving playhead tracks session replay.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type {
  RoutineCandidateWire,
  RoutineTakeRowWire,
  SessionRowWire,
  TakeRowWire,
} from '../api/client';
import { DEFAULT_DETECTOR_PARAMS, DETECTOR_VERSION } from '../capture/events';
import { DECK_COLORS } from '../theme/deckColors';
import { requestTakeReview } from '../capture/takeReview';
import { useDecks } from '../hooks/useDeck';
import { useMixer } from '../hooks/useMixer';
import { useToast } from '../components/Toast';
import { openCandidateInEditor, openRoutineTakeInEditor } from '../routines/openFlow';
import { requestRoutineEdit } from '../routines/openRoutine';
import { isTypingTarget } from '../components/performance/performanceKeys';
import { beatgridQueryOptions } from '../hooks/useBeatgridData';
import type { BeatgridResponse } from '../types';
import type { CaptureDeck, CaptureEvent } from '../capture/events';
import { decodeWaveformBlob } from '../waveform/blob';
import type { DecodedWaveform } from '../waveform/blob';
import { useStyleSlot } from '../waveform/styleSlots';
import {
  ALL_DECKS,
  COLLAPSED_MARKER_PX,
  buildTimeAxis,
  candidateDupesTake,
  castSpanRefs,
  collapseCandidates,
  createStateIndex,
  deriveTimeline,
  takeDeckPair,
  takeSpanPair,
  traceWindow,
} from './timelineModel';
import type { CollapseCandidate, StateAtT, TakeSpanRef, TimeAxis, TimelineModel } from './timelineModel';
import { REARM_AFTER_MS, followScrollTarget } from './followScroll';
import { useViewActive } from '../contexts/viewActive';
import { getTimelineViewState, patchTimelineViewState } from './timelineViewState';
import { staggerRows } from './labelStagger';
import {
  createMonotonicTToPx,
  decimatePlayheadTrace,
  drawAudibilityArea,
  drawGridlines,
  drawStyledRuns,
  tracePolylinePoints,
  traceRuns,
} from './waveformLanes';
import type { TraceRun } from './waveformLanes';
import { planReplay } from './replayPlanner';
import type { ServoDeckActivity } from './replayStore';
import {
  replayNowT,
  replayServoActivity,
  replayState,
  seekReplay,
  startReplay,
  stopReplay,
  subscribeReplay,
  toggleReplayPause,
} from './replayStore';
import './sessionTimeline.css';

// ── Layout ──────────────────────────────────────────────────────────────

/** Physical fader order, as the Performance view arranges the decks. */
const LANE_ORDER: CaptureDeck[] = ['C', 'A', 'B', 'D'];

/** Full-size lane height; lanes SCALE DOWN to fit short hosts (the
 * Performance view's embedded browse hands the pane far less height than
 * the Library — the timeline must fit what it gets). */
const LANE_H_MAX = 84;
const LANE_H_MIN = 40;
const LANE_GAP = 6;
const CHIP_STRIP_H = 30;
const RULER_H = 22;
const MAX_PX_PER_SEC = 60;
/** Detail marks — gesture markers (◆N/↷N/▲/↕ labels + ticks) and take
 * boundary whiskers — render only when the viewport shows at most this
 * many (un-collapsed) seconds: zoomed way out they smear into noise and
 * cost thousands of text/line nodes (sessions 22). Take chips stay. */
const DETAIL_MARKS_MAX_VISIBLE_S = 600;
/** Canvas draws this much beyond the viewport each side, so native
 * scrolling never outruns the painted window between re-centers. */
const CANVAS_MARGIN = 400;
/** Zoom gestures BLIT the last full waveform paint (per-axis-segment
 * drawImage) instead of re-interpreting the waveform per wheel frame —
 * at low zoom a full CPU repaint spans the whole session × 4 lanes and
 * blocked every frame of the gesture (this issue). The real repaint
 * runs once, this long after the last zoom wheel event. */
const ZOOM_REPAINT_SETTLE_MS = 160;

// ── Formatting ──────────────────────────────────────────────────────────

function fmtClock(s: number): string {
  const abs = Math.abs(s);
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const sec = Math.floor(abs % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}

function fmtDur(s: number): string {
  if (s < 90) return `${Math.round(s)}s`;
  return `${Math.round(s / 60)}m`;
}

function fmtWhen(iso: string): string {
  const d = new Date(iso.endsWith('Z') || iso.includes('+') ? iso : `${iso}Z`);
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

type Selection =
  | { kind: 'none' }
  | { kind: 'moment'; t: number }
  | { kind: 'take'; take: TakeRowWire }
  | { kind: 'candidate'; candidate: RoutineCandidateWire }
  | { kind: 'routineTake'; take: RoutineTakeRowWire };

/** A hovered routine band/chip (gh#187): the cast + window driving the
 * hover-dim spotlight (take-chip parity, any tier — ◆/◇/⧉). */
interface HoverCast {
  cast: number[];
  start: number;
  end: number;
}

/** The trim-adjusted confirm payload pieces: slots whose entry survives
 * the trimmed window, offsets re-based onto the new start (clamped ≥ 0 —
 * a slot already playing at the trimmed start enters at 0). Mechanical:
 * trimming the end before a slot's entry drops it from the cast (that is
 * how a candidate can shrink to n=2 and route to the hand-cut Take flow). */
function effectiveCast(
  candidate: RoutineCandidateWire,
  trim: { start: number; end: number }
): { cast: number[]; offsets: number[] } {
  const cast: number[] = [];
  const offsets: number[] = [];
  candidate.cast.forEach((tid, i) => {
    const entryAbs = candidate.window_start_s + candidate.entry_offsets[i];
    if (entryAbs >= trim.end) return;
    cast.push(tid);
    offsets.push(Math.max(0, entryAbs - trim.start));
  });
  return { cast, offsets };
}

interface Props {
  session: SessionRowWire;
  /** Deep-link: center on this capture-clock moment on open (history jump). */
  focusS?: number | null;
  /** Deep-link zoom (sessions 16): show at most this many seconds around
   * the focus moment (never zooms below fit; short sessions keep fit). */
  focusSpanS?: number | null;
  /** Momentary source-region highlight (gh#170 provenance deep-link). */
  focusFlash?: { start: number; end: number } | null;
  /** Bumps per deep-link request (perf-layout 09): a kept-alive view must
   * re-apply focus when a NEW request arrives, not only on mount. */
  focusVersion?: number;
  /** Standalone-mode back affordance; embedded in the Library the sidebar
   * IS the navigation (Sets parity) and this is omitted. */
  onBack?: () => void;
}

export function SessionTimelineView({ session, focusS, focusSpanS, focusFlash, focusVersion, onBack }: Props) {
  // Keep-alive (perf-layout 09): sleep the per-frame work while hidden.
  const viewActive = useViewActive();
  // Responsive vertical budget: lanes scale, chrome sheds when tight.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [rootH, setRootH] = useState(900);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setRootH(el.clientHeight));
    ro.observe(el);
    setRootH(el.clientHeight);
    return () => ro.disconnect();
  }, []);
  // One-row chrome: controls+state+hints live in the top strip; the
  // timeline gets everything else.
  const laneH = Math.max(
    LANE_H_MIN,
    Math.min(LANE_H_MAX, Math.floor((rootH - 125) / 4))
  );

  // View state is shared ACROSS instances via the per-uuid store
  // (sessions 21): seeded here, written through on change, adopted on
  // view activation (the other Library instance may have moved it).
  const [collapseIdle, setCollapseIdle] = useState(
    () => getTimelineViewState(session.uuid)?.collapseIdle ?? true
  );
  const [thresholdS, setThresholdS] = useState(
    () => getTimelineViewState(session.uuid)?.thresholdS ?? 45
  );
  const [expandedGaps, setExpandedGaps] = useState<Set<number>>(
    () => new Set(getTimelineViewState(session.uuid)?.expandedGaps ?? [])
  );
  const [showTraces, setShowTraces] = useState(
    () => getTimelineViewState(session.uuid)?.showTraces ?? true
  );
  const [scrubT, setScrubT] = useState<number | null>(null);
  const [selection, setSelection] = useState<Selection>({ kind: 'none' });
  // Boundary trim for the selected candidate (routines 158): seeded to the
  // candidate's window on select, dragged via the overlay's edge handles,
  // clamped inside the miner window (trim only — no expansion).
  const [trim, setTrim] = useState<{ start: number; end: number } | null>(null);
  // Hovered take chip (sessions 22): spotlight state lives HERE and renders
  // in the per-frame overlay — the memoized scene must not re-render per
  // hover, so it only receives the stable callback.
  const [hoverTake, setHoverTake] = useState<TakeRowWire | null>(null);
  // Hovered routine band/chip (◆/◇/⧉, gh#187): the cast-track spotlight —
  // exact parity with the take-chip hover, generalized to n cast tracks.
  const [hoverCast, setHoverCast] = useState<HoverCast | null>(null);
  const [pxPerSec, setPxPerSec] = useState<number | null>(
    () => getTimelineViewState(session.uuid)?.pxPerSec ?? null
  ); // null = fit

  const { data: detail, error } = useQuery({
    queryKey: ['session', session.uuid],
    queryFn: () => api.sessions.get(session.uuid),
    // An ended Session's log is immutable — never refetch the multi-MB
    // payload on focus/remount. Drop it from the cache soon after leaving
    // (a large log resident in the query cache is app-wide GC pressure).
    staleTime: session.ended_at !== null ? Infinity : 60_000,
    gcTime: 60_000,
  });
  const { data: allTakes } = useQuery({ queryKey: ['takes'], queryFn: api.takes.list });
  // Routine confirm flow (ADR 0035, routines 158): miner candidates for
  // this Session + already-confirmed Routine Takes.
  const { data: allRoutineCandidates } = useQuery({
    queryKey: ['routine-candidates', session.uuid],
    queryFn: () => api.routineCandidates.forSession(session.uuid),
  });
  const { data: allRoutineTakes } = useQuery({
    queryKey: ['routine-takes'],
    queryFn: api.routineTakes.list,
  });

  const events = detail?.events as CaptureEvent[] | undefined;
  const takes = useMemo(
    () => (allTakes ?? []).filter((t) => t.session_uuid === session.uuid),
    [allTakes, session.uuid]
  );
  const routineTakes = useMemo(
    () => (allRoutineTakes ?? []).filter((t) => t.session_uuid === session.uuid),
    [allRoutineTakes, session.uuid]
  );
  // A confirmed candidate stops highlighting — its Routine Take chip is
  // the surviving surface. The uuid check alone leaks after a re-mine
  // (candidate rows are replaced with fresh uuids — the origin uuid
  // dangles by design), so a span-shaped dedupe backs it up: a candidate
  // duplicating a confirmed take's span collapses instead of stacking a
  // dashed ⧉ band under the ◆ (gh#187).
  const routineCandidates = useMemo(() => {
    const confirmed = new Set(
      (allRoutineTakes ?? []).map((t) => t.origin_candidate_uuid).filter(Boolean)
    );
    return (allRoutineCandidates ?? []).filter(
      (c) => !confirmed.has(c.uuid) && !routineTakes.some((rt) => candidateDupesTake(c, rt))
    );
  }, [allRoutineCandidates, allRoutineTakes, routineTakes]);

  const model: TimelineModel | null = useMemo(
    () => (events ? deriveTimeline(events) : null),
    [events]
  );

  // Track titles for every loaded track + Take pairs.
  const [trackNames, setTrackNames] = useState<Record<number, string>>({});
  useEffect(() => {
    if (!model) return;
    const wanted = new Set<number>(model.trackIds);
    for (const t of takes) {
      wanted.add(t.a_track_id);
      wanted.add(t.b_track_id);
    }
    for (const c of routineCandidates) for (const id of c.cast) wanted.add(id);
    for (const rt of routineTakes) for (const id of rt.cast) wanted.add(id);
    const missing = [...wanted].filter((id) => trackNames[id] === undefined);
    if (missing.length === 0) return;
    Promise.all(
      missing.map((id) =>
        api.tracks
          .getById(id)
          .then((tr: { title?: string }) => [id, tr.title ?? `#${id}`] as const)
          .catch(() => [id, `#${id}`] as const)
      )
    ).then((pairs) => setTrackNames((prev) => ({ ...prev, ...Object.fromEntries(pairs) })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, takes, routineCandidates, routineTakes]);

  // Collapse geometry pre-pass (pxPerSec-independent): what the fit zoom
  // and the axis both need.
  // Collapse candidates: idle AND machine tenures (sessions 14) — one
  // list, one toggle, one threshold.
  const candidates = useMemo(() => (model ? collapseCandidates(model) : []), [model]);
  const collapseInfo = useMemo(() => {
    if (!model) return { visDur: 1, collapsedCount: 0 };
    const spans = collapseIdle
      ? candidates.filter((sp, i) => sp.end - sp.start >= thresholdS && !expandedGaps.has(i))
      : [];
    const collapsedDur = spans.reduce((a, s) => a + (s.end - s.start), 0);
    return {
      visDur: Math.max(0.001, model.end - model.start - collapsedDur),
      collapsedCount: spans.length,
    };
  }, [model, candidates, collapseIdle, thresholdS, expandedGaps]);

  // ── Zoom/scroll (the editor-timeline idiom) ───────────────────────────
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [viewportW, setViewportW] = useState(1180);
  const hasModel = model !== null;
  const [scrollX, setScrollX] = useState(0);
  // Follow-scroll bookkeeping (sessions 17): scrolls WE issue (follow,
  // zoom, deep-link) are announced here so the onScroll handler can tell
  // them from the user's — a manual scroll disarms following until
  // REARM_AFTER_MS passes without another one (or a new replay starts).
  const programmaticScrollRef = useRef(-1);
  const lastManualScrollAtRef = useRef(-Infinity);
  const setScrollLeft = useCallback((el: HTMLDivElement, value: number) => {
    programmaticScrollRef.current = value;
    el.scrollLeft = value;
  }, []);
  useEffect(() => {
    // Re-attach once the timeline actually renders (the scroll container
    // is inside the model-gated branch — a mount-only effect sees null).
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewportW(el.clientWidth));
    ro.observe(el);
    setViewportW(el.clientWidth);
    // Synchronous scroll tracking: sticky labels/areas repaint the same
    // frame (the old rAF throttle made them visibly trail the scroll).
    const onScroll = () => {
      // Anything off our announced position is the human's hand (wheel
      // pan, scrollbar, trackpad momentum): disarm follow for the re-arm
      // window; every further manual scroll refreshes it (sessions 17).
      if (Math.abs(el.scrollLeft - programmaticScrollRef.current) > 1.5) {
        lastManualScrollAtRef.current = performance.now();
      }
      setScrollX(el.scrollLeft);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', onScroll);
    };
  }, [hasModel]);

  const fitPx = Math.max(
    0.02,
    (viewportW - 2 - collapseInfo.collapsedCount * COLLAPSED_MARKER_PX) / collapseInfo.visDur
  );
  const effPx = Math.min(MAX_PX_PER_SEC, Math.max(fitPx, pxPerSec ?? fitPx));
  const axis = useMemo(
    () =>
      model
        ? buildTimeAxis(model, { collapseIdle, thresholdS, expanded: expandedGaps, pxPerSec: effPx })
        : null,
    [model, collapseIdle, thresholdS, expandedGaps, effPx]
  );
  const width = Math.max(viewportW, Math.ceil(axis?.totalPx ?? viewportW));
  // A primitive that flips only when zoom crosses the 10-min line — the
  // memoized scene re-renders exactly then (axis changes anyway).
  const showDetailMarks = viewportW / effPx <= DETAIL_MARKS_MAX_VISIBLE_S;

  const zoomCtxRef = useRef({ model, axis, fitPx, viewportW, collapseIdle, thresholdS, expandedGaps });
  zoomCtxRef.current = { model, axis, fitPx, viewportW, collapseIdle, thresholdS, expandedGaps };
  const pendingZoomRef = useRef<{ factor: number; clientX: number } | null>(null);
  const wheelGestureRef = useRef<{ axis: 'pan' | 'zoom'; last: number } | null>(null);
  // Zoom-gesture blit state: the last FULL canvas paint plus the axis it
  // was painted under. While `zoomBlitUntilRef` is in the future the
  // canvas effect remaps this snapshot instead of repainting; the settle
  // timer then forces one real repaint (paintEpoch) iff any blit ran.
  const paintSnapshotRef = useRef<{
    canvas: HTMLCanvasElement;
    x0: number;
    winW: number;
    dpr: number;
    svgH: number;
    segments: TimeAxis['segments'];
  } | null>(null);
  const zoomBlitUntilRef = useRef(0);
  const blitDirtyRef = useRef(false);
  const settleTimerRef = useRef(0);
  const [paintEpoch, setPaintEpoch] = useState(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const applyZoom = () => {
      raf = 0;
      const zoom = pendingZoomRef.current;
      if (!zoom) return;
      pendingZoomRef.current = null;
      const ctx = zoomCtxRef.current;
      if (!ctx.model || !ctx.axis) return;
      const next = Math.min(
        MAX_PX_PER_SEC,
        Math.max(ctx.fitPx, ctx.axis.pxPerSec * zoom.factor)
      );
      if (next === ctx.axis.pxPerSec) return;
      const rect = el.getBoundingClientRect();
      const cursorX = zoom.clientX - rect.left;
      // Anchor the TIME under the cursor, not the width fraction:
      // collapsed markers are fixed px, so time-space is the only stable
      // coordinate across zoom (fraction anchoring made content jump).
      const tCursor = ctx.axis.pxToT(el.scrollLeft + cursorX);
      const newAxis = buildTimeAxis(ctx.model, {
        collapseIdle: ctx.collapseIdle,
        thresholdS: ctx.thresholdS,
        expanded: ctx.expandedGaps,
        pxPerSec: next,
      });
      const newW = Math.max(ctx.viewportW, Math.ceil(newAxis.totalPx));
      const newScroll = Math.max(
        0,
        Math.min(newAxis.tToPx(tCursor) - cursorX, newW - ctx.viewportW)
      );
      // Commit zoom + the matching scroll WINDOW in one synchronous render
      // (the DawTimeline flushSync idiom): the new width, the canvas
      // window, and the DOM scroll all land in the same frame — no torn
      // frames, no left/right wobble.
      flushSync(() => {
        setPxPerSec(next);
        setScrollX(newScroll);
      });
      setScrollLeft(el, newScroll); // zoom scroll is ours, not a disarm
    };
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 160 : 1;
      const now = performance.now();
      const latch = wheelGestureRef.current;
      const gestureAxis =
        latch && now - latch.last < 150
          ? latch.axis
          : Math.abs(e.deltaX) > Math.abs(e.deltaY)
            ? ('pan' as const)
            : ('zoom' as const);
      wheelGestureRef.current = { axis: gestureAxis, last: now };
      if (gestureAxis === 'pan') {
        el.scrollLeft = Math.max(0, el.scrollLeft + e.deltaX * unit);
        return;
      }
      const pending = pendingZoomRef.current;
      pendingZoomRef.current = {
        factor: (pending?.factor ?? 1) * Math.pow(1.0015, -e.deltaY * unit),
        clientX: e.clientX,
      };
      // Gesture in flight: the canvas blits until the wheel goes quiet,
      // then one real repaint (only if a blit actually painted — a zoom
      // pinned at the fit floor never dirtied the canvas).
      zoomBlitUntilRef.current = now + ZOOM_REPAINT_SETTLE_MS + 80;
      window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = window.setTimeout(() => {
        zoomBlitUntilRef.current = 0;
        if (blitDirtyRef.current) setPaintEpoch((v) => v + 1);
      }, ZOOM_REPAINT_SETTLE_MS);
      if (!raf) raf = requestAnimationFrame(applyZoom);
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => {
      el.removeEventListener('wheel', handler);
      if (raf) cancelAnimationFrame(raf);
      window.clearTimeout(settleTimerRef.current);
    };
     
  }, [hasModel, setScrollLeft]);

  // Write-through (sessions 21): every knob change lands in the shared
  // store immediately, so the OTHER Library instance adopts it on its
  // next activation. centerT (scroll) writes on deactivation only —
  // per-frame scroll writes would be churn.
  useEffect(() => {
    patchTimelineViewState(session.uuid, {
      pxPerSec,
      collapseIdle,
      thresholdS,
      expandedGaps: [...expandedGaps],
      showTraces,
    });
  }, [session.uuid, pxPerSec, collapseIdle, thresholdS, expandedGaps, showTraces]);
  const centerRef = useRef<{ axis: typeof axis; scrollX: number; viewportW: number }>({
    axis: null,
    scrollX: 0,
    viewportW,
  });
  centerRef.current = { axis, scrollX, viewportW };
  const writeCenter = useCallback(
    (uuid: string) => {
      const c = centerRef.current;
      if (c.axis) {
        patchTimelineViewState(uuid, { centerT: c.axis.pxToT(c.scrollX + c.viewportW / 2) });
      }
    },
    []
  );
  useEffect(() => {
    const uuid = session.uuid;
    return () => writeCenter(uuid); // unmount (session switch)
  }, [session.uuid, writeCenter]);

  // Adopt on activation (sessions 21): the view was hidden; the other
  // instance may have moved zoom/scroll for this session. Also writes our
  // center on DEactivation so the handoff is symmetric.
  const wasActiveRef = useRef(viewActive);
  useEffect(() => {
    if (wasActiveRef.current === viewActive) return;
    wasActiveRef.current = viewActive;
    if (!viewActive) {
      writeCenter(session.uuid);
      return;
    }
    const saved = getTimelineViewState(session.uuid);
    if (!saved) return;
    setPxPerSec(saved.pxPerSec);
    setCollapseIdle(saved.collapseIdle);
    setThresholdS(saved.thresholdS);
    setExpandedGaps(new Set(saved.expandedGaps));
    setShowTraces(saved.showTraces);
    if (saved.centerT != null) {
      const el = scrollRef.current;
      const c = centerRef.current;
      if (el && c.axis) {
        setScrollLeft(el, Math.max(0, c.axis.tToPx(saved.centerT) - el.clientWidth / 2));
      }
    }
  }, [viewActive, session.uuid, writeCenter, setScrollLeft]);

  // Deep-link focus: drop the cursor + moment once, and scroll it into
  // view. A zoom request (sessions 16: at most focusSpanS seconds visible)
  // applies FIRST and defers the scroll one render — centering must use
  // the axis rebuilt at the new pxPerSec, not the fit axis.
  const focusedRef = useRef(false);
  const focusVersionRef = useRef(focusVersion);
  useEffect(() => {
    if (focusVersionRef.current !== focusVersion) {
      focusVersionRef.current = focusVersion;
      focusedRef.current = false; // a NEW deep-link re-arms the focus
    }
    if (focusedRef.current || focusS == null || !model || !axis) return;
    if (focusSpanS != null) {
      const target = Math.min(MAX_PX_PER_SEC, Math.max(fitPx, viewportW / focusSpanS));
      if (Math.abs(axis.pxPerSec - target) > 1e-9 && target > fitPx) {
        setPxPerSec(target);
        return; // re-runs with the rebuilt axis
      }
    }
    focusedRef.current = true;
    setScrubT(focusS);
    setSelection({ kind: 'moment', t: focusS });
    const el = scrollRef.current;
    if (el) setScrollLeft(el, Math.max(0, axis.tToPx(focusS) - el.clientWidth / 2));
    // Provenance flash (gh#170): pulse the source region once, keyed so a
    // repeated deep-link re-triggers the CSS animation.
    if (focusFlash) setFlash({ ...focusFlash, key: focusVersion ?? 0 });
  }, [focusS, focusSpanS, focusFlash, focusVersion, model, axis, width, fitPx, viewportW, setScrollLeft]);

  // Momentary region flash state (cleared after the animation).
  const [flash, setFlash] = useState<{ start: number; end: number; key: number } | null>(null);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 2600);
    return () => clearTimeout(t);
  }, [flash]);

  // Checkpointed scrub lookups: hover fires per mousemove — reducing the
  // whole 100k-event log each time froze large Sessions (issue 13).
  const stateIndex = useMemo(() => (events ? createStateIndex(events) : null), [events]);
  const scrubState = useMemo(
    () => (stateIndex && scrubT !== null ? stateIndex.at(scrubT) : null),
    [stateIndex, scrubT]
  );
  const momentState = useMemo(
    () => (stateIndex && selection.kind === 'moment' ? stateIndex.at(selection.t) : null),
    [stateIndex, selection]
  );

  // ── Replay (sessions 05) ──────────────────────────────────────────────
  const decks = useDecks();
  const mixer = useMixer();
  const toast = useToast();
  const replay = useSyncExternalStore(subscribeReplay, replayState);
  const replayHere = replay.sessionUuid === session.uuid && replay.status !== 'idle';
  const decksRef = useRef(decks);
  decksRef.current = decks;

  const loadTrack = useCallback(async (deck: CaptureDeck, trackId: number): Promise<boolean> => {
    try {
      const track = await api.tracks.getById(trackId);
      decksRef.current[deck].loadTrack(track);
      return true;
    } catch {
      return false;
    }
  }, []);

  const replayFrom = (t: number) => {
    if (!events) return;
    const res = planReplay(events, t);
    if (!res.ok) {
      toast(
        res.reason === 'empty-log'
          ? 'Nothing to replay — this Session has no events.'
          : 'Nothing to replay at this moment — no track was loaded, and none is coming.'
      );
      return;
    }
    void startReplay(
      session.uuid,
      res.plan,
      {
        mixer,
        engines: { A: decks.A.engine, B: decks.B.engine, C: decks.C.engine, D: decks.D.engine },
      },
      loadTrack,
      (reason, cause) => {
        if (reason === 'load-failed') {
          toast('Replay refused — a track this moment needs is missing from the library.');
        } else if (reason === 'takeover') {
          // The cause names the trigger: an idle controller's jittering
          // fader shows up here by name instead of as a mystery stop.
          toast(`Takeover (${cause ?? 'manual gesture'}) — the decks are yours; capture resumed.`);
        }
      }
    );
  };

  // Moving playhead: follow the driver's session clock while it rolls.
  // ONE cursor: during playback this replaces the click anchor; when
  // playback ends (stop/takeover/ended) the anchor lands where it stopped.
  const [replayT, setReplayT] = useState<number | null>(null);
  const lastReplayTRef = useRef<number | null>(null);
  // A fresh replay re-arms follow-scroll immediately (sessions 17).
  useEffect(() => {
    if (replayHere) lastManualScrollAtRef.current = -Infinity;
  }, [replayHere]);
  // Follow the rolling playhead: pinned at the zone edge while it rides
  // the last 20% of the viewport — paused for REARM_AFTER_MS after a
  // manual scroll, then back on duty.
  useEffect(() => {
    if (replayT === null || !axis) return;
    if (performance.now() - lastManualScrollAtRef.current < REARM_AFTER_MS) return;
    const el = scrollRef.current;
    if (!el) return;
    const target = followScrollTarget(
      axis.tToPx(replayT),
      el.scrollLeft,
      el.clientWidth,
      el.scrollWidth
    );
    if (target !== null) setScrollLeft(el, target);
  }, [replayT, axis, setScrollLeft]);
  useEffect(() => {
    if (!viewActive) return; // hidden view: no per-frame playhead work
    if (!replayHere) {
      const last = lastReplayTRef.current;
      lastReplayTRef.current = null;
      setReplayT(null);
      if (last !== null) {
        // The anchor lands where playback stopped — including after a
        // remount mid-replay (selection 'none'), so the next space/▶ has
        // its moment. A selected Take keeps its selection.
        setSelection((sel) => (sel.kind === 'take' ? sel : { kind: 'moment', t: last }));
      }
      return;
    }
    // The playhead reads the DRIVER's clock directly, not store status —
    // one authoritative source. `replayNowT()` returns null only when the
    // driver is genuinely inactive (torn down): the loop keeps its last
    // position rather than snapping the cursor away on a transient null.
    let raf = 0;
    const loop = () => {
      const t = replayNowT();
      if (t !== null) {
        lastReplayTRef.current = t;
        setReplayT(t);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [replayHere, viewActive]);

  // Space: pause/resume while rolling; START playback from the selected
  // moment when idle (view-scoped, like the editor's space).
  const spaceRef = useRef({ selection, replayFrom });
  spaceRef.current = { selection, replayFrom };
  useEffect(() => {
    // CAPTURE phase + stopPropagation: the library/performance hubs also
    // bind space (deck play toggle) — both firing turned a pause into a
    // deck gesture, which the replay driver rightly read as a takeover.
    // When the timeline owns the gesture, nobody else hears it.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || isTypingTarget(e)) return;
      if (replayHere) {
        e.preventDefault();
        e.stopPropagation();
        toggleReplayPause();
        return;
      }
      const { selection: sel, replayFrom: start } = spaceRef.current;
      if (sel.kind === 'moment') {
        e.preventDefault();
        e.stopPropagation();
        start(sel.t);
      }
    };
    document.addEventListener('keydown', onKeyDown, { capture: true });
    return () => document.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [replayHere]);

  // ── Waveform + beatgrid data ──────────────────────────────────────────
  const blobQueries = useQueries({
    queries: (model?.trackIds ?? []).map((id) => ({
      queryKey: ['waveform-blob', id],
      queryFn: async () => decodeWaveformBlob(await api.waveforms.getData(id)),
      staleTime: Infinity,
      retry: 5,
      refetchInterval: (query: { state: { data: unknown } }) =>
        query.state.data === undefined ? 8000 : false,
    })),
  });
  const blobsReadyKey = blobQueries.map((q) => (q.data ? '1' : '0')).join('');
  const wavesByTrack = useMemo(() => {
    const out: Record<number, DecodedWaveform> = {};
    (model?.trackIds ?? []).forEach((id, i) => {
      const d = blobQueries[i]?.data;
      if (d) out[id] = d;
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, blobsReadyKey]);

  const gridQueries = useQueries({
    queries: (model?.trackIds ?? []).map((id) => beatgridQueryOptions(id)),
  });
  const gridsReadyKey = gridQueries.map((q) => (q.data ? '1' : '0')).join('');
  const gridsByTrack = useMemo(() => {
    const out: Record<number, BeatgridResponse> = {};
    (model?.trackIds ?? []).forEach((id, i) => {
      const d = gridQueries[i]?.data;
      if (d) out[id] = d;
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, gridsReadyKey]);

  // Zoom-adaptive run decimation (this issue): at low zoom a jog/pitch-
  // heavy session cut into thousands of SUB-PIXEL runs, and the per-run
  // fixed cost made every canvas repaint a main-thread stall. Thin trace
  // samples to ~¾px of session time before run-cutting — position error
  // stays sub-pixel by construction. Quantized to powers of two so the
  // memo only recomputes when zoom crosses a bucket, not per wheel frame.
  const runMinDtSRaw = 0.75 / effPx;
  const runMinDtS = runMinDtSRaw <= 1 ? 0 : 2 ** Math.floor(Math.log2(runMinDtSRaw));
  const runsByDeck = useMemo(() => {
    const out = {} as Record<CaptureDeck, TraceRun[]>;
    for (const d of ALL_DECKS) out[d] = model ? traceRuns(model.decks[d], undefined, runMinDtS) : [];
    return out;
  }, [model, runMinDtS]);

  // Scene copies of the traces, thinned to the SAME zoom bucket (this
  // issue, part 2): the trace polylines walked every raw sample per scene
  // render — at low zoom that's the whole multi-hour trace × 4 decks on
  // every zoom frame / scroll-quantum crossing. Points that can't move
  // ≥1px horizontally are dropped up front; a seek that jumps the lane
  // vertically (≥ ~1px of playhead scale) always survives.
  const sceneTracesByDeck = useMemo(() => {
    const out = {} as Record<CaptureDeck, { t: number; playhead: number }[][]>;
    for (const d of ALL_DECKS) {
      const dt = model?.decks[d];
      const minPh = dt && dt.maxPlayhead > 0 ? dt.maxPlayhead / Math.max(1, laneH - 24) : Infinity;
      out[d] = dt ? dt.traces.map((tr) => decimatePlayheadTrace(tr, runMinDtS, minPh)) : [];
    }
    return out;
  }, [model, runMinDtS, laneH]);

  const slot = useStyleSlot('full');

  const svgH = RULER_H + CHIP_STRIP_H + 4 * (laneH + LANE_GAP);
  const lanesTop = RULER_H + CHIP_STRIP_H;
  const laneY = (deck: CaptureDeck) => lanesTop + LANE_ORDER.indexOf(deck) * (laneH + LANE_GAP);

  // ── The waveform canvas: windowed to the visible px + margin ─────────
  // (a multi-hour session at high zoom is hundreds of thousands of px —
  // a full-width canvas backing store would freeze the renderer). The
  // window is quantized: native scroll carries the canvas smoothly (it
  // lives in the scrolled content); the redraw only re-centers when the
  // scroll crosses a quantum, so edges never blank within the margin.
  const canvasWinStart = Math.max(0, Math.floor((scrollX - CANVAS_MARGIN) / 300) * 300);
  // The SVG scene windows on the SAME quantum: scrollX changes every
  // scroll frame, but the memoized scene only re-renders when the scroll
  // crosses a quantum (issue 13 — reconciling thousands of un-windowed
  // SVG nodes per scroll frame was the timeline's dominant stutter).
  const sceneX0 = canvasWinStart;
  const sceneX1 = Math.min(width, canvasWinStart + viewportW + 2 * CANVAS_MARGIN);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !model || !axis) return;
    const dpr = window.devicePixelRatio || 1;
    const x0 = Math.max(0, Math.floor(canvasWinStart));
    const x1 = Math.min(width, x0 + viewportW + 2 * CANVAS_MARGIN);
    const winW = Math.max(1, x1 - x0);
    canvas.width = winW * dpr;
    canvas.height = svgH * dpr;
    canvas.style.transform = `translateX(${x0}px)`;
    canvas.style.width = `${winW}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, winW, svgH);
    ctx.translate(-x0, 0); // helpers draw in timeline coordinates
    // Zoom gesture in flight: remap the last full paint through the new
    // axis instead of re-interpreting the waveform. The axis is piecewise
    // linear, so a per-segment drawImage is exact in position (waveform
    // detail stretches until the settle repaint) — GPU-cheap where the
    // full paint was a per-frame main-thread stall at low zoom.
    const snap = paintSnapshotRef.current;
    if (
      performance.now() < zoomBlitUntilRef.current &&
      snap !== null &&
      snap.svgH === svgH &&
      snap.segments.length === axis.segments.length
    ) {
      blitDirtyRef.current = true;
      for (let i = 0; i < axis.segments.length; i++) {
        const os = snap.segments[i];
        const ns = axis.segments[i];
        // The slice of this segment the snapshot actually painted…
        const o0 = Math.max(os.px0, snap.x0);
        const o1 = Math.min(os.px1, snap.x0 + snap.winW);
        if (o1 <= o0) continue;
        // …mapped linearly into the new axis' px space.
        const ow = os.px1 - os.px0;
        const f0 = ow > 0 ? (o0 - os.px0) / ow : 0;
        const f1 = ow > 0 ? (o1 - os.px0) / ow : 1;
        const n0 = ns.px0 + f0 * (ns.px1 - ns.px0);
        const n1 = ns.px0 + f1 * (ns.px1 - ns.px0);
        if (n1 <= n0 || n1 <= x0 || n0 >= x1) continue;
        ctx.drawImage(
          snap.canvas,
          (o0 - snap.x0) * snap.dpr,
          0,
          (o1 - o0) * snap.dpr,
          snap.svgH * snap.dpr,
          n0,
          0,
          n1 - n0,
          svgH
        );
      }
      return;
    }
    for (const deck of LANE_ORDER) {
      const geo = { width, yOffset: laneY(deck), height: laneH, x0, x1 };
      const dt = model.decks[deck];
      // 1. Audibility area chart (behind).
      drawAudibilityArea(ctx, dt.gainSteps, axis, DECK_COLORS[deck], geo);
      // 2. Full-color styled waveform per track span's runs, modulated by
      // the recorded mixer state (sessions 19: EQ kills drop their band,
      // fader/trim shrink the waveform).
      for (const span of dt.trackSpans) {
        const wave = wavesByTrack[span.trackId];
        const spanRuns = runsByDeck[deck].filter((r) => r.t0 >= span.start && r.t1 <= span.end);
        if (wave) {
          drawStyledRuns(ctx, wave, slot.styleId, slot.params, spanRuns, axis, geo, dt.controlSteps);
          // 3. Beat gridlines over the waveform (jump/pitch-aware).
          const grid = gridsByTrack[span.trackId];
          if (grid?.data) {
            drawGridlines(
              ctx,
              grid.data.beat_times ?? [],
              grid.data.downbeat_times ?? [],
              spanRuns,
              axis,
              geo
            );
          }
        }
      }
    }
    // Snapshot the full paint for the next zoom gesture's blits.
    const snapCanvas = snap?.canvas ?? document.createElement('canvas');
    snapCanvas.width = canvas.width;
    snapCanvas.height = canvas.height;
    snapCanvas.getContext('2d')?.drawImage(canvas, 0, 0);
    paintSnapshotRef.current = { canvas: snapCanvas, x0, winW, dpr, svgH, segments: axis.segments };
    blitDirtyRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, axis, width, svgH, canvasWinStart, viewportW, wavesByTrack, gridsByTrack, runsByDeck, slot, paintEpoch]);

  // Stable scene callbacks (the scene is memoized — inline closures would
  // defeat it every render).
  const onTakeClick = useCallback((take: TakeRowWire) => setSelection({ kind: 'take', take }), []);
  const onTakeHover = useCallback((take: TakeRowWire | null) => setHoverTake(take), []);
  const onCastHover = useCallback((hover: HoverCast | null) => setHoverCast(hover), []);
  const trimBoundsRef = useRef<{ lo: number; hi: number } | null>(null);
  const onCandidateClick = useCallback((c: RoutineCandidateWire) => {
    setSelection({ kind: 'candidate', candidate: c });
    setTrim({ start: c.window_start_s, end: c.window_end_s });
    // Trim bounds reach the WHOLE session (gh#170 follow-up: outward trim
    // — the miner under-sizes dwell-shaped windows, #181's WYGFM case),
    // not just the miner's window; confirm re-derives from the session
    // slice either way.
    const segs = axisRef.current?.segments;
    const hi = segs && segs.length > 0 ? segs[segs.length - 1].end : c.window_end_s;
    trimBoundsRef.current = { lo: 0, hi: Math.max(hi, c.window_end_s) };
  }, []);
  const onRoutineTakeClick = useCallback(
    (rt: RoutineTakeRowWire) => setSelection({ kind: 'routineTake', take: rt }),
    []
  );

  const onGapToggle = useCallback(
    (idx: number) =>
      setExpandedGaps((prev) => {
        const next = new Set(prev);
        if (next.has(idx)) next.delete(idx);
        else next.add(idx);
        return next;
      }),
    []
  );

  const svgRef = useRef<SVGSVGElement | null>(null);
  const pxAt = (clientX: number): number => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.min(rect.width, Math.max(0, clientX - rect.left));
  };

  // ── Candidate confirm flow (ADR 0035, routines 158) ──────────────────
  const queryClient = useQueryClient();

  // Region → Routine editor (gh#170 pass 2 directive 4): the ✎ button on
  // a detected region runs its tier's open flow (candidate: confirm +
  // promote — the deliberate act; take: promote if needed) and the app
  // flips to the editor.
  const onOpenCandidateInEditor = useCallback(
    async (c: RoutineCandidateWire) => {
      try {
        await openCandidateInEditor(c);
        void queryClient.invalidateQueries({ queryKey: ['routine-takes'] });
        void queryClient.invalidateQueries({ queryKey: ['routines'] });
        void queryClient.invalidateQueries({ queryKey: ['routine-candidates', session.uuid] });
      } catch (err) {
        toast(`Open failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [queryClient, session.uuid, toast]
  );
  const onOpenRoutineTakeInEditor = useCallback(
    async (rt: RoutineTakeRowWire) => {
      try {
        await openRoutineTakeInEditor(rt);
        void queryClient.invalidateQueries({ queryKey: ['routine-takes'] });
        void queryClient.invalidateQueries({ queryKey: ['routines'] });
      } catch (err) {
        toast(`Open failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [queryClient, session.uuid, toast]
  );
  // Persisted tier (gh#170 follow-up): the ◆ region's ✎ opens directly.
  const onOpenRoutine = useCallback((routineUuid: string) => {
    requestRoutineEdit({ routineUuid });
  }, []);
  // Names for ◆ region labels (metadata only; cheap and cached).
  const { data: routineRows } = useQuery({ queryKey: ['routines'], queryFn: api.routines.list });
  const routineNames = useMemo(
    () => Object.fromEntries((routineRows ?? []).map((r) => [r.uuid, r.name])),
    [routineRows]
  );
  const axisRef = useRef(axis);
  axisRef.current = axis;
  const trimDraggedRef = useRef(false);
  /** Drag a trim boundary: window-level listeners for the gesture, time
   * clamped inside the miner window and 2s off the opposite edge. */
  const onTrimHandleDown = useCallback((edge: 'start' | 'end', e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const move = (ev: MouseEvent) => {
      const ax = axisRef.current;
      const rect = svgRef.current?.getBoundingClientRect();
      if (!ax || !rect) return;
      trimDraggedRef.current = true;
      const t = ax.pxToT(Math.min(rect.width, Math.max(0, ev.clientX - rect.left)));
      const b = trimBoundsRef.current;
      setTrim((prev) => {
        if (!prev) return prev;
        if (edge === 'start') {
          return { ...prev, start: Math.min(Math.max(t, b?.lo ?? -Infinity), prev.end - 2) };
        }
        return { ...prev, end: Math.max(Math.min(t, b?.hi ?? Infinity), prev.start + 2) };
      });
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }, []);

  const confirmCandidate = async () => {
    if (selection.kind !== 'candidate' || !trim) return;
    const { cast, offsets } = effectiveCast(selection.candidate, trim);
    if (cast.length < 3) return;
    try {
      const row = await api.routineTakes.create({
        uuid: crypto.randomUUID(),
        session_uuid: session.uuid,
        window_start_s: trim.start,
        window_end_s: trim.end,
        cast,
        entry_offsets: offsets,
        origin_candidate_uuid: selection.candidate.uuid,
      });
      await queryClient.invalidateQueries({ queryKey: ['routine-takes'] });
      setSelection({ kind: 'routineTake', take: row });
      toast(`Routine Take confirmed — ${cast.length} tracks · ${fmtDur(trim.end - trim.start)}.`);
    } catch (err) {
      toast(String(err));
    }
  };

  /** n=2 route (ADR 0035): a 2-cast confirm is a Transition — cut a
   * hand-cut Take (origin 'manual') with the trimmed slice copied in. */
  const cutTakeInstead = async () => {
    if (selection.kind !== 'candidate' || !trim || !events) return;
    const { cast } = effectiveCast(selection.candidate, trim);
    if (cast.length !== 2) return;
    const pad = 2;
    const slice = events.filter((e) => e.t >= trim.start - pad && e.t <= trim.end + pad);
    try {
      await api.takes.create({
        uuid: crypto.randomUUID(),
        a_track_id: cast[0],
        b_track_id: cast[1],
        window_start_s: trim.start,
        window_end_s: trim.end,
        confidence: 1,
        detector_version: DETECTOR_VERSION,
        params: DEFAULT_DETECTOR_PARAMS,
        events: slice,
        session_uuid: session.uuid,
        origin: 'manual',
      });
      await queryClient.invalidateQueries({ queryKey: ['takes'] });
      setSelection({ kind: 'none' });
      toast('Hand-cut Take created — a 2-cast span is a Transition, not a Routine.');
    } catch (err) {
      toast(String(err));
    }
  };

  const promoteRoutineTake = async (rt: RoutineTakeRowWire) => {
    try {
      const routine = await api.routineTakes.promote(rt.uuid);
      await queryClient.invalidateQueries({ queryKey: ['routine-takes'] });
      await queryClient.invalidateQueries({ queryKey: ['routines'] });
      setSelection({
        kind: 'routineTake',
        take: { ...rt, promoted_routine_uuid: routine.uuid },
      });
      toast(
        `Promoted — Routine saved: ${routine.cast.length} slots · ${Math.round(routine.duration_beats)} beats.`
      );
    } catch (err) {
      toast(String(err));
    }
  };

  const deleteRoutineTake = async (rt: RoutineTakeRowWire) => {
    try {
      await api.routineTakes.delete(rt.uuid);
      await queryClient.invalidateQueries({ queryKey: ['routine-takes'] });
      setSelection({ kind: 'none' });
    } catch (err) {
      toast(String(err));
    }
  };

  const onTimelineClick = (clientX: number) => {
    if (!axis || !events) return;
    // The click that lands after a trim drag must not move the selection.
    if (trimDraggedRef.current) {
      trimDraggedRef.current = false;
      return;
    }
    const t = axis.pxToT(pxAt(clientX));
    setSelection({ kind: 'moment', t });
    // Click during playback = seek (the deck-jog idiom: position gestures
    // act immediately while something is rolling).
    if (replayHere && (replay.status === 'playing' || replay.status === 'paused')) {
      const res = planReplay(events, t);
      if (res.ok) seekReplay(res.plan);
      else toast('Nothing to replay at that moment.');
    }
  };

  return (
    <div className="session-timeline" ref={rootRef}>
      <div className="stl-controls">
        {onBack ? (
          <button className="stl-back" onClick={onBack}>
            ‹ Sessions
          </button>
        ) : null}
        <span className="stl-title">
          {fmtWhen(session.started_at)}
          {model ? ` · ${fmtDur(model.end - model.start)} · ${takes.length} takes` : ''}
        </span>

        {/* Replay transport: present whenever THIS session is rolling —
            a remount mid-replay opens with selection 'none', and gating
            the cluster on a moment selection left a moving playhead with
            no pause/stop (the play-button-never-appears bug). The start
            button still needs a selected moment to start FROM. */}
        {replayHere ? (
          <span className="stl-cluster">
            {replay.status !== 'loading' ? (
              <button className="stl-replay" onClick={toggleReplayPause}>
                {replay.status === 'paused' ? '▶' : '⏸'}
              </button>
            ) : null}
            <button className="stl-replay stop" onClick={stopReplay}>
              {replay.status === 'loading' ? 'loading…' : '■'}
            </button>
          </span>
        ) : selection.kind === 'moment' ? (
          <button
            className="stl-replay"
            title="Replay through the shared live decks from this moment — any manual gesture takes over"
            onClick={() => replayFrom(selection.t)}
          >
            ▶ {fmtClock(selection.t)}
          </button>
        ) : null}
        {selection.kind === 'take' ? (
          <span className="stl-cluster">
            <button
              className="stl-open-editor"
              onClick={() => requestTakeReview(selection.take.uuid)}
            >
              Take {trackNames[selection.take.a_track_id] ?? selection.take.a_track_id} →{' '}
              {trackNames[selection.take.b_track_id] ?? selection.take.b_track_id} · open in
              editor
            </button>
            <button className="stl-clear" onClick={() => setSelection({ kind: 'none' })}>
              ✕
            </button>
          </span>
        ) : null}

        {/* Candidate confirm cluster (routines 158): trim on the timeline,
            confirm here. Trimming the cast to 2 flips the button to the
            hand-cut-Take route (a 2-cast span is a Transition, ADR 0035). */}
        {selection.kind === 'candidate' && trim
          ? (() => {
              const eff = effectiveCast(selection.candidate, trim);
              const chain = eff.cast.map((id) => trackNames[id] ?? `#${id}`).join(' → ');
              return (
                <span className="stl-cluster stl-cand-cluster">
                  <span className="stl-cand-title" title={chain}>
                    ⧉ candidate · {eff.cast.length} tracks · {fmtDur(trim.end - trim.start)}
                  </span>
                  {eff.cast.length >= 3 ? (
                    <button
                      className="stl-confirm"
                      title={`Confirm this span as a Routine Take\n${chain}`}
                      onClick={() => void confirmCandidate()}
                    >
                      ✓ Confirm Routine Take
                    </button>
                  ) : eff.cast.length === 2 ? (
                    <button
                      className="stl-confirm two"
                      title="A 2-cast span is a Transition — this cuts a hand-cut Take instead (ADR 0035)"
                      onClick={() => void cutTakeInstead()}
                    >
                      n=2 → Cut Take instead
                    </button>
                  ) : (
                    <span className="stl-cand-title">window too tight</span>
                  )}
                  <button
                    className="stl-clear"
                    title="Reset trim to the miner's window"
                    onClick={() =>
                      setTrim({
                        start: selection.candidate.window_start_s,
                        end: selection.candidate.window_end_s,
                      })
                    }
                  >
                    ↺
                  </button>
                  <button className="stl-clear" onClick={() => setSelection({ kind: 'none' })}>
                    ✕
                  </button>
                </span>
              );
            })()
          : null}

        {/* Routine Take cluster: promote (mechanical deck→slot + beat
            rebase) or delete; the raw take is never altered by promotion. */}
        {selection.kind === 'routineTake' ? (
          <span className="stl-cluster stl-cand-cluster">
            <span
              className="stl-cand-title"
              title={selection.take.cast.map((id) => trackNames[id] ?? `#${id}`).join(' → ')}
            >
              ◆ Routine Take · {selection.take.cast.length} tracks
            </span>
            {selection.take.promoted_routine_uuid ? (
              <span className="stl-cand-title" title="Promoted to a saved Routine">
                ★ promoted
              </span>
            ) : (
              <button
                className="stl-confirm"
                title="Mechanically promote: deck→slot re-addressing + beat-domain rebase via the cast Beatgrids"
                onClick={() => void promoteRoutineTake(selection.take)}
              >
                ↑ Promote to Routine
              </button>
            )}
            <button
              className="stl-clear"
              title="Delete this Routine Take"
              onClick={() => void deleteRoutineTake(selection.take)}
            >
              ✕ delete
            </button>
            <button className="stl-clear" onClick={() => setSelection({ kind: 'none' })}>
              ✕
            </button>
          </span>
        ) : null}

        {/* Inline state readout: cursor (or selected moment) reconstruction. */}
        <InlineReadout state={scrubState ?? momentState} trackNames={trackNames} />

        {/* Servo readout (sessions 20): which decks replay is nudging back
            into phase, by how much, and how far off they are. */}
        {replayHere && viewActive ? <ServoReadout /> : null}

        <label>
          <input
            type="checkbox"
            checked={collapseIdle}
            onChange={(e) => setCollapseIdle(e.target.checked)}
          />
          gaps ≥
        </label>
        <select
          value={thresholdS}
          onChange={(e) => setThresholdS(Number(e.target.value))}
          disabled={!collapseIdle}
        >
          <option value={30}>30s</option>
          <option value={45}>45s</option>
          <option value={120}>2m</option>
          <option value={300}>5m</option>
        </select>
        <label>
          <input
            type="checkbox"
            checked={showTraces}
            onChange={(e) => setShowTraces(e.target.checked)}
          />
          traces
        </label>
        <span className="stl-zoom">
          <button title="Zoom to fit" onClick={() => setPxPerSec(null)}>
            fit
          </button>
        </span>
        <span
          className="stl-hint"
          title="waveform = audio that played · background fill = audibility (height = Master gain) · ◆N hot cue · ↷N/↶N beat jump · ↕ seek · ▶/▪ play/pause · ⌐¬ loop · dashes = machine tenure · wheel = zoom, trackpad = pan"
        >
          hover=scrub · click=moment/seek · space=pause · ⓘ
        </span>
      </div>

      {error ? <div className="stl-error">{String(error)}</div> : null}

      {model && axis ? (
        <>
          <div className="stl-scroll" ref={scrollRef}>
            <div className="stl-stage" style={{ width, height: svgH }}>
              <canvas ref={canvasRef} className="stl-canvas" style={{ height: svgH }} />
              <svg
                ref={svgRef}
                width={width}
                height={svgH}
                className="stl-svg"
                onMouseMove={(e) => axis && setScrubT(axis.pxToT(pxAt(e.clientX)))}
                onMouseLeave={() => setScrubT(null)}
                onClick={(e) => onTimelineClick(e.clientX)}
              >
                <TimelineScene
                  model={model}
                  axis={axis}
                  width={width}
                  viewX0={sceneX0}
                  viewX1={sceneX1}
                  laneH={laneH}
                  lanesTop={lanesTop}
                  takes={takes}
                  routineCandidates={routineCandidates}
                  routineTakes={routineTakes}
                  trackNames={trackNames}
                  selectedTakeUuid={selection.kind === 'take' ? selection.take.uuid : null}
                  selectedCandidateUuid={
                    selection.kind === 'candidate' ? selection.candidate.uuid : null
                  }
                  selectedRoutineTakeUuid={
                    selection.kind === 'routineTake' ? selection.take.uuid : null
                  }
                  tracesByDeck={sceneTracesByDeck}
                  showTraces={showTraces}
                  showDetailMarks={showDetailMarks}
                  candidates={candidates}
                  collapseIdle={collapseIdle}
                  thresholdS={thresholdS}
                  expandedGaps={expandedGaps}
                  onTakeClick={onTakeClick}
                  onTakeHover={onTakeHover}
                  onCastHover={onCastHover}
                  onCandidateClick={onCandidateClick}
                  onRoutineTakeClick={onRoutineTakeClick}
                  onOpenCandidateInEditor={onOpenCandidateInEditor}
                  onOpenRoutineTakeInEditor={onOpenRoutineTakeInEditor}
                  onOpenRoutine={onOpenRoutine}
                  routineNames={routineNames}
                  onGapToggle={onGapToggle}
                />
                <SceneOverlay
                  model={model}
                  axis={axis}
                  laneH={laneH}
                  lanesTop={lanesTop}
                  trackNames={trackNames}
                  scrollX={scrollX}
                  viewportW={viewportW}
                  scrubT={scrubT}
                  replayT={replayHere ? replayT : null}
                  replayPaused={replay.status === 'paused'}
                  selection={selection}
                  hoverTake={hoverTake}
                  hoverCast={hoverCast}
                  trim={selection.kind === 'candidate' ? trim : null}
                  onTrimHandleDown={onTrimHandleDown}
                  flash={flash}
                />
              </svg>
            </div>
          </div>

        </>
      ) : (
        <div className="stl-loading">Loading session…</div>
      )}
    </div>
  );
}

// ── SVG scene ─────────────────────────────────────────────────────────────

/** Lane vertical position — pure of component state so the memoized scene
 * and the per-frame overlay share one definition. */
function laneYOf(deck: CaptureDeck, lanesTop: number, laneH: number): number {
  return lanesTop + LANE_ORDER.indexOf(deck) * (laneH + LANE_GAP);
}

interface SceneProps {
  model: TimelineModel;
  axis: ReturnType<typeof buildTimeAxis>;
  width: number;
  /** Quantized visible px window (±margin): every per-time element renders
   * only here, and the window only moves on scroll-quantum crossings — so
   * the memoized scene sits out ordinary scroll frames entirely. */
  viewX0: number;
  viewX1: number;
  laneH: number;
  lanesTop: number;
  takes: TakeRowWire[];
  /** Miner-suggested Routine spans (unconfirmed) + confirmed Routine
   * Takes (routines 158) — chips in the same strip as Take chips. */
  routineCandidates: RoutineCandidateWire[];
  routineTakes: RoutineTakeRowWire[];
  trackNames: Record<number, string>;
  selectedTakeUuid: string | null;
  selectedCandidateUuid: string | null;
  selectedRoutineTakeUuid: string | null;
  /** Zoom-bucket-decimated traces for the polylines (identity changes
   * only when the bucket does — not per zoom frame). */
  tracesByDeck: Record<CaptureDeck, { t: number; playhead: number }[][]>;
  showTraces: boolean;
  showDetailMarks: boolean;
  /** Collapse candidates (idle + tenure, sessions 14) — indices key the
   * expanded set. */
  candidates: CollapseCandidate[];
  collapseIdle: boolean;
  thresholdS: number;
  expandedGaps: ReadonlySet<number>;
  onTakeClick(take: TakeRowWire): void;
  onTakeHover(take: TakeRowWire | null): void;
  /** Routine band/chip hover (gh#187): the cast-track spotlight. */
  onCastHover(hover: HoverCast | null): void;
  onCandidateClick(candidate: RoutineCandidateWire): void;
  onRoutineTakeClick(take: RoutineTakeRowWire): void;
  onOpenCandidateInEditor(candidate: RoutineCandidateWire): void | Promise<void>;
  onOpenRoutineTakeInEditor(take: RoutineTakeRowWire): void | Promise<void>;
  /** Direct open — persisted tier (gh#170 follow-up). */
  onOpenRoutine(routineUuid: string): void;
  /** Persisted Routine names keyed by uuid (labels for the ◆ tier). */
  routineNames: Record<string, string | null>;
  onGapToggle(idx: number): void;
}

const TimelineScene = memo(function TimelineScene({
  model,
  axis,
  width,
  viewX0,
  viewX1,
  laneH,
  lanesTop,
  takes,
  routineCandidates,
  routineTakes,
  trackNames,
  selectedTakeUuid,
  selectedCandidateUuid,
  selectedRoutineTakeUuid,
  tracesByDeck,
  showTraces,
  showDetailMarks,
  candidates,
  collapseIdle,
  thresholdS,
  expandedGaps,
  onTakeClick,
  onTakeHover,
  onCastHover,
  onCandidateClick,
  onRoutineTakeClick,
  onOpenCandidateInEditor,
  onOpenRoutineTakeInEditor,
  onOpenRoutine,
  routineNames,
  onGapToggle,
}: SceneProps) {
  const X = (t: number) => axis.tToPx(t);
  const laneY = (deck: CaptureDeck) => laneYOf(deck, lanesTop, laneH);
  const lanesBottom = laneY('D') + laneH;
  // The window in capture time (pxToT is monotonic): trace culling slices
  // by time, everything else compares pixels.
  const tView0 = axis.pxToT(viewX0);
  const tView1 = axis.pxToT(viewX1);

  const ticks: number[] = [];
  {
    const targetCount = Math.max(4, Math.floor(width / 110));
    const stepRaw = axis.visibleDurationS / targetCount;
    const step = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200].find((s) => s >= stepRaw) ?? 1800;
    for (let t = Math.ceil(model.start / step) * step; t <= model.end; t += step) {
      const x = axis.tToPx(t);
      if (x < viewX0 || x > viewX1) continue; // window: high zoom = many ticks
      const seg = axis.segments.find((s) => t >= s.start && t <= s.end);
      if (seg?.collapsed) continue;
      ticks.push(t);
    }
  }

  // Expanded gaps (idle or tenure) that could re-collapse (the toggle
  // affordance).
  const expandedSpans = collapseIdle
    ? candidates
        .map((sp, idx) => ({ sp, idx }))
        .filter(({ sp, idx }) => sp.end - sp.start >= thresholdS && expandedGaps.has(idx))
    : [];

  // Tenures the axis collapsed render as markers alone — the full rect +
  // label would just bury the marker under a ≥14px block.
  const collapsedTenureStarts = new Set(
    axis.segments.filter((s) => s.collapsed && s.kind === 'tenure').map((s) => s.start)
  );

  // Take chip coloring (sessions 22): outgoing → incoming deck gradient.
  // One def per deck pair in use; chips whose decks the log doesn't
  // resolve keep the stylesheet's default fill.
  const takePairs = takes.map((t) => takeDeckPair(model, t));

  // Chip layout (sessions 22): overlapping chips share the strip height.
  // Up to FOUR rows (2 rows capped dense stretches at overlap — the third
  // concurrent chip landed on an occupied row); each connected overlap
  // cluster shrinks only as much as IT needs (rows = max row used within
  // the cluster), so a lone pair keeps half-height chips while a 4-deep
  // pile drops to quarter height. Isolated chips keep the full strip.
  // Routine-take + candidate chips (routines 158) share the strip and the
  // stagger: indices run takes, then routineTakes, then candidates.
  const chipWindows = [
    ...takes.map((t) => ({ start: t.window_start_s, end: t.window_end_s })),
    ...routineTakes.map((t) => ({ start: t.window_start_s, end: t.window_end_s })),
    ...routineCandidates.map((c) => ({ start: c.window_start_s, end: c.window_end_s })),
  ];
  const rtakeChipBase = takes.length;
  const candChipBase = takes.length + routineTakes.length;
  const chipLayout = (() => {
    const order = chipWindows
      .map((_, i) => i)
      .sort((a, b) => chipWindows[a].start - chipWindows[b].start);
    const items = order.map((i) => {
      const x0 = X(chipWindows[i].start);
      return { x0, x1: Math.max(X(chipWindows[i].end), x0 + 12) };
    });
    const rows = staggerRows(items, 4);
    const layout = new Array<{ row: number; rows: number }>(chipWindows.length);
    let clusterStart = 0;
    let clusterEnd = items.length > 0 ? items[0].x1 : 0;
    const closeCluster = (k: number) => {
      let rowsNeeded = 1;
      for (let j = clusterStart; j < k; j++) rowsNeeded = Math.max(rowsNeeded, rows[j] + 1);
      for (let j = clusterStart; j < k; j++) {
        layout[order[j]] = { row: rows[j], rows: rowsNeeded };
      }
    };
    for (let k = 1; k < items.length; k++) {
      if (items[k].x0 < clusterEnd) {
        clusterEnd = Math.max(clusterEnd, items[k].x1);
      } else {
        closeCluster(k);
        clusterStart = k;
        clusterEnd = items[k].x1;
      }
    }
    closeCluster(items.length);
    return layout;
  })();
  const gradientPairs = [
    ...new Set(
      takePairs
        .filter((p): p is { from: CaptureDeck; to: CaptureDeck } => p.from !== null && p.to !== null)
        .map((p) => `${p.from}-${p.to}`)
    ),
  ];

  return (
    <g>
      <defs>
        {/* Track-label backing: newer titles obscure older ones, with a
            soft fade-in so the covered title dissolves instead of
            colliding (text-stacking illegibility fix). */}
        <linearGradient id="stl-label-fade" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--mantle, #181818)" stopOpacity="0" />
          <stop offset="12%" stopColor="var(--mantle, #181818)" stopOpacity="0.92" />
          <stop offset="100%" stopColor="var(--mantle, #181818)" stopOpacity="0.92" />
        </linearGradient>
        {/* Take chip gradients: outgoing deck color → incoming deck color. */}
        {gradientPairs.map((key) => {
          const [from, to] = key.split('-') as [CaptureDeck, CaptureDeck];
          return (
            <linearGradient key={key} id={`stl-take-grad-${key}`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={DECK_COLORS[from]} />
              <stop offset="100%" stopColor={DECK_COLORS[to]} />
            </linearGradient>
          );
        })}
      </defs>
      {ticks.map((t) => (
        <g key={`tick-${t}`}>
          <line x1={X(t)} y1={RULER_H - 6} x2={X(t)} y2={lanesBottom} className="stl-gridline" />
          <text x={X(t) + 3} y={RULER_H - 8} className="stl-tick-label">
            {fmtClock(t)}
          </text>
        </g>
      ))}

      {LANE_ORDER.map((deck) => (
        <DeckLane
          key={deck}
          deck={deck}
          y={laneY(deck)}
          model={model}
          X={X}
          axis={axis}
          viewX0={viewX0}
          viewX1={viewX1}
          tView0={tView0}
          tView1={tView1}
          h={laneH}
          traces={tracesByDeck[deck]}
          showTraces={showTraces}
          showDetailMarks={showDetailMarks}
        />
      ))}

      {/* Tenure holds (collapsed ones are markers below, not rects). */}
      {model.tenures.map((sp, i) => {
        if (collapsedTenureStarts.has(sp.start)) return null;
        const x0 = X(sp.start);
        const x1 = Math.max(X(sp.end), x0 + 14);
        if (x1 < viewX0 || x0 > viewX1) return null;
        return (
          <g key={`tenure-${i}`}>
            <rect
              x={x0}
              y={lanesTop}
              width={x1 - x0}
              height={lanesBottom - lanesTop}
              className="stl-tenure"
            />
            <text
              x={(x0 + x1) / 2}
              y={lanesTop + 13}
              className="stl-tenure-label"
              textAnchor="middle"
            >
              {sp.holder} held the surface · {fmtDur(sp.end - sp.start)}
              {sp.open ? ' · unclosed' : ''}
            </text>
          </g>
        );
      })}

      {/* Collapsed gap markers — idle or tenure — click to expand. */}
      {axis.segments
        .filter((s) => s.collapsed && s.px1 >= viewX0 && s.px0 <= viewX1)
        .map((seg) => {
          const cx = (seg.px0 + seg.px1) / 2;
          const label =
            seg.kind === 'tenure'
              ? `‖ ${fmtDur(seg.end - seg.start)} ${seg.holder} held`
              : `‖ ${fmtDur(seg.end - seg.start)} idle`;
          return (
            <g
              key={`gap-${seg.start}`}
              className={`stl-idle-marker${seg.kind === 'tenure' ? ' tenure' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                if (seg.candidateIdx !== undefined) onGapToggle(seg.candidateIdx);
              }}
            >
              <rect
                x={seg.px0}
                y={RULER_H}
                width={seg.px1 - seg.px0}
                height={lanesBottom - RULER_H}
                className="stl-idle-rect"
              />
              <text
                x={cx}
                y={(RULER_H + lanesBottom) / 2}
                textAnchor="middle"
                className="stl-idle-label"
              >
                {label}
              </text>
            </g>
          );
        })}

      {/* Expanded gaps: a re-collapse pill over the (now widened) stretch. */}
      {expandedSpans.map(({ sp, idx }) => {
        const x0 = X(sp.start);
        const x1 = X(sp.end);
        if (x1 < viewX0 || x0 > viewX1) return null;
        const cx = (x0 + x1) / 2;
        const what = sp.kind === 'tenure' ? `${sp.holder} held` : 'idle';
        return (
          <g
            key={`gap-exp-${sp.start}`}
            className="stl-idle-collapse"
            onClick={(e) => {
              e.stopPropagation();
              onGapToggle(idx);
            }}
          >
            <rect x={x0} y={lanesTop} width={x1 - x0} height={12} />
            <text x={cx} y={lanesTop + 10} textAnchor="middle">
              ⇤ collapse {fmtDur(sp.end - sp.start)} {what} ⇥
            </text>
          </g>
        );
      })}

      {/* Take chips (deck-pair gradient fill; boundary whiskers are
          detail marks — hidden past the 10-min line, sessions 22). */}
      {takes.map((t, ti) => {
        const x0 = X(t.window_start_s);
        const x1 = Math.max(X(t.window_end_s), x0 + 12);
        if (x1 < viewX0 || x0 > viewX1) return null;
        const label = `${trackNames[t.a_track_id] ?? t.a_track_id} → ${
          trackNames[t.b_track_id] ?? t.b_track_id
        }`;
        const pair = takePairs[ti];
        const grad =
          pair.from !== null && pair.to !== null
            ? `url(#stl-take-grad-${pair.from}-${pair.to})`
            : null;
        const { row, rows } = chipLayout[ti];
        const chipH = (CHIP_STRIP_H - 6) / rows;
        const chipY = RULER_H + 2 + row * chipH;
        const textY = chipY + chipH / 2 + 3;
        // 2 rows: smaller text; 3-4 rows: chips too thin for text at all
        // (the hover title still carries the label).
        const sizeClass = rows >= 3 ? ' micro' : rows === 2 ? ' slim' : '';
        return (
          <g
            key={t.uuid}
            className={`stl-take-chip${selectedTakeUuid === t.uuid ? ' selected' : ''}${sizeClass}`}
            onClick={(e) => {
              e.stopPropagation();
              onTakeClick(t);
            }}
            onMouseEnter={() => onTakeHover(t)}
            onMouseLeave={() => onTakeHover(null)}
          >
            <title>{`${label} · confidence ${t.confidence.toFixed(2)}`}</title>
            <rect
              x={x0}
              y={chipY}
              width={x1 - x0}
              height={chipH}
              rx={rows === 1 ? 5 : rows === 2 ? 4 : 2}
              style={grad ? { fill: grad } : undefined}
            />
            {x1 - x0 > 90 ? (
              <text x={x0 + 5} y={textY}>
                ● {label.slice(0, Math.floor((x1 - x0) / 7))}
              </text>
            ) : (
              <text x={x0 + 4} y={textY}>
                ●
              </text>
            )}
            {showDetailMarks ? (
              <>
                <line
                  x1={x0}
                  y1={RULER_H + CHIP_STRIP_H - 4}
                  x2={x0}
                  y2={lanesBottom}
                  className="stl-take-whisker"
                  style={pair.from !== null ? { stroke: DECK_COLORS[pair.from] } : undefined}
                />
                <line
                  x1={x1}
                  y1={RULER_H + CHIP_STRIP_H - 4}
                  x2={x1}
                  y2={lanesBottom}
                  className="stl-take-whisker"
                  style={pair.to !== null ? { stroke: DECK_COLORS[pair.to] } : undefined}
                />
              </>
            ) : null}
          </g>
        );
      })}

      {/* Candidate highlights (routines 158): a translucent band down the
          lanes marks each miner-suggested Routine span; the chip in the
          strip is the click target (confirm flow). */}
      {routineCandidates.map((c, i) => {
        const x0 = X(c.window_start_s);
        const x1 = Math.max(X(c.window_end_s), x0 + 12);
        if (x1 < viewX0 || x0 > viewX1) return null;
        const chain = c.cast.map((id) => trackNames[id] ?? `#${id}`).join(' → ');
        const { row, rows } = chipLayout[candChipBase + i];
        const chipH = (CHIP_STRIP_H - 6) / rows;
        const chipY = RULER_H + 2 + row * chipH;
        const textY = chipY + chipH / 2 + 3;
        const sizeClass = rows >= 3 ? ' micro' : rows === 2 ? ' slim' : '';
        const selected = selectedCandidateUuid === c.uuid;
        return (
          <g
            key={c.uuid}
            className={`stl-cand-chip${selected ? ' selected' : ''}${sizeClass}`}
            onClick={(e) => {
              e.stopPropagation();
              onCandidateClick(c);
            }}
            onMouseEnter={() =>
              onCastHover({ cast: c.cast, start: c.window_start_s, end: c.window_end_s })
            }
            onMouseLeave={() => onCastHover(null)}
          >
            <title>{`Routine candidate · ${chain} · returns ${c.evidence.returns ?? 0}, triples ${c.evidence.triples ?? 0} — click to confirm (with trim), ✎ to open in the Routine editor`}</title>
            <rect x={x0} y={lanesTop} width={x1 - x0} height={lanesBottom - lanesTop} className="stl-cand-band" />
            <rect x={x0} y={chipY} width={x1 - x0} height={chipH} rx={rows === 1 ? 5 : rows === 2 ? 4 : 2} className="stl-cand-chip-rect" />
            {x1 - x0 > 90 ? (
              <text x={x0 + 5} y={textY}>
                ⧉ {`${c.cast.length}× ${chain}`.slice(0, Math.floor((x1 - x0) / 7))}
              </text>
            ) : (
              <text x={x0 + 4} y={textY}>
                ⧉
              </text>
            )}
            {/* Per-region editor open (gh#170 pass 2 directive 4):
                confirm-then-promote-then-open — the deliberate act. */}
            {x1 - x0 > 40 && (
              <g
                className="stl-region-edit"
                onClick={(e) => {
                  e.stopPropagation();
                  void onOpenCandidateInEditor(c);
                }}
              >
                <title>Open in the Routine editor (confirms this candidate + promotes)</title>
                <rect x={x1 - 18} y={chipY + 1} width={16} height={chipH - 2} rx={3} />
                <text x={x1 - 10} y={textY} textAnchor="middle">
                  ✎
                </text>
              </g>
            )}
          </g>
        );
      })}

      {/* Routine Take + persisted Routine regions (gh#170 follow-up):
          always-on region guides for ALL tiers, matching the pin
          picker's ladder — solid ◆ persisted > dimmed ◆ Routine Take >
          dashed ⧉ candidate. A promoted take renders as its ROUTINE
          (highest tier wins — no stacked duplicates; confirmed
          candidates are already filtered upstream the same way). */}
      {routineTakes.map((rt, i) => {
        const x0 = X(rt.window_start_s);
        const x1 = Math.max(X(rt.window_end_s), x0 + 12);
        if (x1 < viewX0 || x0 > viewX1) return null;
        const chain = rt.cast.map((id) => trackNames[id] ?? `#${id}`).join(' → ');
        const { row, rows } = chipLayout[rtakeChipBase + i];
        const chipH = (CHIP_STRIP_H - 6) / rows;
        const chipY = RULER_H + 2 + row * chipH;
        const textY = chipY + chipH / 2 + 3;
        const sizeClass = rows >= 3 ? ' micro' : rows === 2 ? ' slim' : '';
        const selected = selectedRoutineTakeUuid === rt.uuid;
        const routineUuid = rt.promoted_routine_uuid;
        const persisted = routineUuid !== null;
        const label = persisted
          ? routineNames[routineUuid!] || chain
          : chain;
        return (
          <g
            key={rt.uuid}
            className={`${persisted ? 'stl-routine-chip' : 'stl-rtake-chip'}${selected ? ' selected' : ''}${sizeClass}`}
            onClick={(e) => {
              e.stopPropagation();
              onRoutineTakeClick(rt);
            }}
            onMouseEnter={() =>
              onCastHover({ cast: rt.cast, start: rt.window_start_s, end: rt.window_end_s })
            }
            onMouseLeave={() => onCastHover(null)}
          >
            <title>
              {persisted
                ? `Routine · ${label} — ✎ opens the Routine editor`
                : `Routine Take (unpromoted) · ${chain} — ✎ promotes + opens the Routine editor`}
            </title>
            <rect
              x={x0}
              y={lanesTop}
              width={x1 - x0}
              height={lanesBottom - lanesTop}
              className={persisted ? 'stl-routine-band' : 'stl-rtake-band'}
            />
            <rect
              x={x0}
              y={chipY}
              width={x1 - x0}
              height={chipH}
              rx={rows === 1 ? 5 : rows === 2 ? 4 : 2}
              className="stl-rtake-chip-rect"
            />
            {x1 - x0 > 90 ? (
              <text x={x0 + 5} y={textY}>
                {persisted ? '◆' : '◇'} {label.slice(0, Math.floor((x1 - x0) / 7))}
              </text>
            ) : (
              <text x={x0 + 4} y={textY}>
                {persisted ? '◆' : '◇'}
              </text>
            )}
            {x1 - x0 > 40 && (
              <g
                className="stl-region-edit dark"
                onClick={(e) => {
                  e.stopPropagation();
                  if (persisted) onOpenRoutine(routineUuid!);
                  else void onOpenRoutineTakeInEditor(rt);
                }}
              >
                <title>
                  {persisted
                    ? 'Open this Routine in the Routine editor'
                    : 'Promote + open in the Routine editor (review)'}
                </title>
                <rect x={x1 - 18} y={chipY + 1} width={16} height={chipH - 2} rx={3} />
                <text x={x1 - 10} y={textY} textAnchor="middle">
                  ✎
                </text>
              </g>
            )}
          </g>
        );
      })}

      {/* Cursors, playheads, and sticky labels live in SceneOverlay: they
          move every mousemove/frame/scroll and must not drag this memoized
          scene with them (issue 13). */}
    </g>
  );
});

/** The per-frame layer: scrub cursor, selection anchor, replay playhead,
 * and viewport-sticky track labels. Everything here is a handful of nodes,
 * re-rendered freely on every scroll/mousemove/replay frame while the
 * heavy scene behind it sits still. */
function SceneOverlay({
  model,
  axis,
  laneH,
  lanesTop,
  trackNames,
  scrollX,
  viewportW,
  scrubT,
  replayT,
  replayPaused,
  selection,
  hoverTake,
  hoverCast,
  trim,
  onTrimHandleDown,
  flash,
}: {
  model: TimelineModel;
  axis: ReturnType<typeof buildTimeAxis>;
  laneH: number;
  lanesTop: number;
  trackNames: Record<number, string>;
  scrollX: number;
  viewportW: number;
  scrubT: number | null;
  replayT: number | null;
  replayPaused: boolean;
  selection: Selection;
  hoverTake: TakeRowWire | null;
  /** Hovered routine band/chip (gh#187): cast-track spotlight. */
  hoverCast: HoverCast | null;
  /** Provenance flash (gh#170): a source region pulsing once. */
  flash?: { start: number; end: number; key: number } | null;
  /** Boundary trim of the selected candidate (routines 158): the span
   * rendered with draggable edge handles; null unless a candidate is
   * selected. */
  trim: { start: number; end: number } | null;
  onTrimHandleDown(edge: 'start' | 'end', e: React.MouseEvent): void;
}) {
  const X = (t: number) => axis.tToPx(t);
  const lanesBottom = laneYOf('D', lanesTop, laneH) + laneH;
  const viewX1 = scrollX + viewportW;

  return (
    <g>
      {/* Provenance flash (gh#170 deep-link): the routine's source region
          pulses once on arrival. Keyed per request so a repeat re-runs
          the CSS animation. */}
      {flash && (
        <rect
          key={flash.key}
          className="stl-flash-region"
          x={X(flash.start)}
          y={lanesTop}
          width={Math.max(X(flash.end) - X(flash.start), 8)}
          height={lanesBottom - lanesTop}
          rx={4}
        />
      )}
      {/* Track labels: the LOAD bar itself is in the (windowed, memoized)
          lane; the label hangs here because it STICKS to the viewport's
          left edge while its span covers it — an exact-scrollX behavior.
          Only labels whose span touches the viewport render. */}
      {LANE_ORDER.map((deck) => {
        const y = laneYOf(deck, lanesTop, laneH);
        const color = DECK_COLORS[deck];
        return (
          <g key={`labels-${deck}`}>
            {model.decks[deck].trackSpans.map((sp, i) => {
              const label = trackNames[sp.trackId] ?? `#${sp.trackId}`;
              const mx = X(sp.start);
              const estW = label.length * 6.4;
              // Loads often happen DURING idle (load, then play) — snap the
              // label anchor out of the collapsed marker so the track's
              // start stays readable.
              const idleSeg = axis.segments.find(
                (g) => g.collapsed && sp.start >= g.start && sp.start <= g.end
              );
              const anchor = idleSeg ? idleSeg.px1 + 4 : mx;
              const spanEnd = X(sp.end);
              if (spanEnd < scrollX - 50 || anchor > viewX1 + 50) return null;
              // If THIS span covers the viewport's left edge, the label
              // sticks to the edge — pushed out by its own span end as the
              // next load approaches. Chronological order keeps newer
              // labels on top; the faded backing dissolves what they cover.
              const covering = anchor < scrollX && spanEnd > scrollX;
              const lx = covering
                ? Math.max(anchor, Math.min(scrollX + 6, spanEnd - estW - 8))
                : anchor;
              // A long label must not poke out behind the NEXT load's
              // label (sessions 22): truncate at the next span's start.
              const next = model.decks[deck].trackSpans[i + 1];
              const availPx = next ? X(next.start) - 8 - (lx + 3) : Infinity;
              let shown = label;
              if (estW > availPx) {
                const maxChars = Math.floor(availPx / 6.4) - 1;
                if (maxChars < 3) return null; // no room — the load bar still marks it
                shown = `${label.slice(0, maxChars)}…`;
              }
              const shownW = shown.length * 6.4;
              return (
                <g key={`trklabel-${i}`}>
                  <rect
                    x={lx - 12}
                    y={y + 3}
                    width={shownW + 18}
                    height={14}
                    fill="url(#stl-label-fade)"
                  />
                  <text x={lx + 3} y={y + 14} className="stl-track-label" fill={color}>
                    {shown}
                  </text>
                </g>
              );
            })}
          </g>
        );
      })}

      {/* Hover spotlight (sessions 22; routines gh#187): dim every lane
          stretch that is NOT the hovered chip's tracks — a Take's two, or
          a routine band's whole cast — and show boundary whiskers
          regardless of the detail-marks zoom gate. Lives here (per-frame
          layer), so hovering never re-renders the scene. */}
      {hoverTake || hoverCast
        ? (() => {
            const pair = hoverTake ? takeSpanPair(model, hoverTake) : null;
            const spans = pair
              ? [pair.from, pair.to].filter((s): s is TakeSpanRef => s !== null)
              : castSpanRefs(model, hoverCast!.cast, hoverCast!.start, hoverCast!.end);
            const dims: ReactNode[] = [];
            for (const deck of LANE_ORDER) {
              const y = laneYOf(deck, lanesTop, laneH);
              const mine = spans.filter((s) => s.deck === deck);
              if (mine.length === 0) {
                dims.push(
                  <rect key={`dim-${deck}`} x={0} y={y} width={axis.totalPx} height={laneH} className="stl-hover-dim" />
                );
              } else {
                const x0 = Math.min(...mine.map((s) => X(s.start)));
                const x1 = Math.max(...mine.map((s) => X(s.end)));
                if (x0 > 0) {
                  dims.push(
                    <rect key={`dim-${deck}-l`} x={0} y={y} width={x0} height={laneH} className="stl-hover-dim" />
                  );
                }
                if (x1 < axis.totalPx) {
                  dims.push(
                    <rect key={`dim-${deck}-r`} x={x1} y={y} width={axis.totalPx - x1} height={laneH} className="stl-hover-dim" />
                  );
                }
              }
            }
            const wx0 = X(hoverTake ? hoverTake.window_start_s : hoverCast!.start);
            const wx1 = X(hoverTake ? hoverTake.window_end_s : hoverCast!.end);
            // Take whiskers carry the deck colors; routine whiskers the
            // routine family's accent.
            const c0 = pair
              ? pair.from && { stroke: DECK_COLORS[pair.from.deck] }
              : { stroke: 'var(--routine-accent)' };
            const c1 = pair
              ? pair.to && { stroke: DECK_COLORS[pair.to.deck] }
              : { stroke: 'var(--routine-accent)' };
            return (
              <g style={{ pointerEvents: 'none' }}>
                {dims}
                <line
                  x1={wx0}
                  y1={RULER_H + CHIP_STRIP_H - 4}
                  x2={wx0}
                  y2={lanesBottom}
                  className="stl-take-whisker hover"
                  style={c0 || undefined}
                />
                <line
                  x1={wx1}
                  y1={RULER_H + CHIP_STRIP_H - 4}
                  x2={wx1}
                  y2={lanesBottom}
                  className="stl-take-whisker hover"
                  style={c1 || undefined}
                />
              </g>
            );
          })()
        : null}

      {/* Selected candidate: trimmed span + draggable boundary handles +
          per-slot entry marks (routines 158). The handles are the only
          interactive nodes in this per-frame layer. */}
      {selection.kind === 'candidate' && trim
        ? (() => {
            const c = selection.candidate;
            const x0 = X(trim.start);
            const x1 = X(trim.end);
            return (
              <g className="stl-trim">
                <rect
                  x={x0}
                  y={RULER_H}
                  width={Math.max(x1 - x0, 2)}
                  height={lanesBottom - RULER_H}
                  className="stl-trim-span"
                />
                {c.cast.map((tid, i) => {
                  const entryAbs = c.window_start_s + c.entry_offsets[i];
                  if (entryAbs >= trim.end) return null;
                  const ex = X(Math.max(entryAbs, trim.start));
                  return (
                    <g key={`entry-${i}`} className="stl-trim-entry">
                      <title>{`slot ${i} · ${trackNames[tid] ?? `#${tid}`}`}</title>
                      <line x1={ex} y1={lanesTop} x2={ex} y2={lanesTop + 10} />
                      <text x={ex + 2} y={lanesTop + 9}>{i}</text>
                    </g>
                  );
                })}
                {(['start', 'end'] as const).map((edge) => {
                  const hx = edge === 'start' ? x0 : x1;
                  return (
                    <g key={edge} className="stl-trim-handle" onMouseDown={(e) => onTrimHandleDown(edge, e)}>
                      <rect x={hx - 5} y={RULER_H} width={10} height={lanesBottom - RULER_H} />
                      <line x1={hx} y1={RULER_H} x2={hx} y2={lanesBottom} />
                      <circle cx={hx} cy={RULER_H + 8} r={5} />
                    </g>
                  );
                })}
              </g>
            );
          })()
        : null}

      {/* Selected Routine Take: static span highlight (no handles — the
          confirm already fixed the boundary). */}
      {selection.kind === 'routineTake'
        ? (() => {
            const x0 = X(selection.take.window_start_s);
            const x1 = X(selection.take.window_end_s);
            return (
              <rect
                x={x0}
                y={RULER_H}
                width={Math.max(x1 - x0, 2)}
                height={lanesBottom - RULER_H}
                className="stl-trim-span confirmed"
                style={{ pointerEvents: 'none' }}
              />
            );
          })()
        : null}

      {/* Moment selection anchor — hidden while the replay head is the
          one cursor (it follows current time; clicks seek it). */}
      {selection.kind === 'moment' && replayT === null ? (
        <g className="stl-anchor">
          <line x1={X(selection.t)} y1={RULER_H} x2={X(selection.t)} y2={lanesBottom} />
          <polygon
            points={`${X(selection.t) - 6},${RULER_H} ${X(selection.t) + 6},${RULER_H} ${X(selection.t)},${RULER_H + 9}`}
          />
        </g>
      ) : null}

      {/* Replay playhead: the moving line while the session plays back. */}
      {replayT !== null ? (
        <g className={`stl-replay-head${replayPaused ? ' paused' : ''}`}>
          <line x1={X(replayT)} y1={RULER_H} x2={X(replayT)} y2={lanesBottom} />
          <polygon
            points={`${X(replayT) - 5},${lanesBottom} ${X(replayT) + 5},${lanesBottom} ${X(replayT)},${lanesBottom - 8}`}
          />
        </g>
      ) : null}

      {/* Scrub cursor. */}
      {scrubT !== null ? (
        <line
          x1={X(scrubT)}
          y1={RULER_H}
          x2={X(scrubT)}
          y2={lanesBottom}
          className="stl-scrub-line"
        />
      ) : null}
    </g>
  );
}

function DeckLane({
  deck,
  y,
  model,
  X,
  axis,
  viewX0,
  viewX1,
  tView0,
  tView1,
  h,
  traces,
  showTraces,
  showDetailMarks,
}: {
  deck: CaptureDeck;
  y: number;
  model: TimelineModel;
  X(t: number): number;
  /** Monotonic-cursor lookups for the point-heavy paths (sessions 22). */
  axis: TimeAxis;
  /** Quantized visible px window — everything outside is culled. */
  viewX0: number;
  viewX1: number;
  /** The same window in capture time (trace slicing). */
  tView0: number;
  tView1: number;
  h: number;
  /** Zoom-bucket-decimated traces (parent memo) for the polylines. */
  traces: { t: number; playhead: number }[][];
  showTraces: boolean;
  showDetailMarks: boolean;
}) {
  const dt = model.decks[deck];
  const color = DECK_COLORS[deck];
  const maxPlayhead = dt.maxPlayhead;

  // Marker text with context: hot-cue slot (1-8, the pads' numbering),
  // beat-jump size + direction, plain glyphs for seek/cue.
  const gestureLabel = (g: { action: string; detail?: number }) => {
    if (g.action === 'hotCue') return `◆${g.detail ?? ''}`;
    if (g.action === 'jumpBeats') {
      const beats = g.detail ?? 0;
      return beats < 0 ? `↶${Math.abs(beats)}` : `↷${beats}`;
    }
    if (g.action === 'cue') return '▲';
    return '↕';
  };

  return (
    <g className="stl-lane">
      <rect x={0} y={y} width="100%" height={h} className="stl-lane-bg" />
      <text x={6} y={y + 14} className="stl-lane-letter" fill={color}>
        {deck}
      </text>

      {/* LOAD bars (the labels ride the SceneOverlay — they stick to the
          viewport edge, an exact-scrollX behavior this memoized lane must
          not re-render for). */}
      {dt.trackSpans.map((sp, i) => {
        const mx = X(sp.start);
        if (mx < viewX0 || mx > viewX1) return null;
        return (
          <line
            key={`trk-${i}`}
            x1={mx}
            y1={y}
            x2={mx}
            y2={y + h}
            stroke={color}
            className="stl-load-bar"
          />
        );
      })}

      {/* Playing-but-silent underline (audibility itself is the area fill). */}
      {dt.playingSpans.map((sp, i) => {
        const x0 = X(sp.start);
        const x1 = X(sp.end);
        if (x1 < viewX0 || x0 > viewX1) return null;
        return (
          <rect
            key={`play-${i}`}
            x={x0}
            y={y + h - 3}
            width={Math.max(x1 - x0, 2)}
            height={3}
            fill={color}
            opacity={0.4}
          />
        );
      })}

      {/* Play/pause markers at the playing-span boundaries. Detail-gated
          (this issue): past ~10 visible minutes they're overlapping glyph
          confetti, and hundreds of <text> nodes made every low-zoom scene
          render/paint expensive. */}
      {showDetailMarks
        ? dt.playingSpans.map((sp, i) => {
            const x0 = X(sp.start);
            const x1 = X(sp.end);
            if (x1 < viewX0 || x0 > viewX1) return null;
            return (
              <g key={`pp-${i}`} className="stl-transport-mark">
                <text x={x0 + 1} y={y + h - 8} fill={color}>
                  ▶
                </text>
                <text x={x1 + 1} y={y + h - 8} fill={color}>
                  ▪
                </text>
              </g>
            );
          })
        : null}

      {/* Jump/cue gesture markers (sessions 04 iteration), labels
          staggered onto rows so a cluster (stab run, repeated jumps)
          stays legible (sessions 21). Ticks keep the exact x. Past ~10
          visible minutes the markers hide entirely — labels AND ticks
          (sessions 22): unreadable at that density, and thousands of
          text/line nodes weighed the scene. */}
      {showDetailMarks
        ? (() => {
            const visible = dt.gestures
              .map((g, i) => ({ g, i }))
              .filter(({ g }) => g.t >= tView0 && g.t <= tView1);
            // Label extent estimate: 10px font ≈ 6px/char + padding.
            const items = visible.map(({ g }) => {
              const x0 = X(g.t) + 2;
              return { x0, x1: x0 + gestureLabel(g).length * 6 + 6 };
            });
            // Rows adapt to the lane height (40–84px): 2 rows at minimum
            // height, up to 4 — deeper fans would wander into the waveform.
            const maxRows = Math.max(2, Math.min(4, Math.floor((h - 24) / 10)));
            const rows = staggerRows(items, maxRows);
            return visible.map(({ g, i }, k) => (
              <g key={`ges-${i}`} className="stl-gesture">
                <title>{`${g.action}${g.detail !== undefined ? ` ${g.detail}` : ''} → ${fmtClock(g.playhead)}`}</title>
                <line x1={X(g.t)} y1={y + 16} x2={X(g.t)} y2={y + h - 4} stroke={color} className="stl-gesture-tick" />
                <text x={X(g.t) + 2} y={y + 26 + rows[k] * 10} fill={color}>
                  {gestureLabel(g)}
                </text>
              </g>
            ));
          })()
        : null}

      {/* Held loops: a bracket bar along the lane top. Detail-gated with
          the other marks — sub-4px brackets at overview zoom are noise. */}
      {showDetailMarks
        ? dt.loops.map((lp, i) => {
            const x0 = X(lp.start);
            const x1 = Math.max(X(lp.end), x0 + 4);
            if (x1 < viewX0 || x0 > viewX1) return null;
            return (
              <g key={`loop-${i}`} className="stl-loop" >
                <title>{`loop ${fmtClock(lp.region.start)}–${fmtClock(lp.region.end)}${lp.open ? ' (unreleased)' : ''}`}</title>
                <line x1={x0} y1={y + 18} x2={x1} y2={y + 18} stroke={color} />
                <line x1={x0} y1={y + 18} x2={x0} y2={y + 23} stroke={color} />
                <line x1={x1} y1={y + 18} x2={x1} y2={y + 23} stroke={color} />
              </g>
            );
          })
        : null}

      {/* Playhead traces (position-in-track reading), sliced to the
          window and decimated to pixel resolution (sessions 22) — at low
          zoom the slice is the whole trace, and full-precision per-point
          tToPx + stringification dominated the scene render. The traces
          arrive pre-thinned to the zoom bucket (this issue), so a scene
          render walks ~px-resolution points, not every raw sample. */}
      {showTraces
        ? traces.map((trace, i) => {
            const win = traceWindow(trace, tView0, tView1);
            if (!win) return null;
            return (
              <polyline
                key={`trace-${i}`}
                points={tracePolylinePoints(
                  win,
                  createMonotonicTToPx(axis),
                  (ph) => y + 18 + (1 - ph / maxPlayhead) * (h - 24)
                )}
                className="stl-trace"
                stroke={color}
              />
            );
          })
        : null}
    </g>
  );
}

/** Live servo readout (sessions 20): polls driver-owned activity at
 * 500ms (the servo updates at ~1 Hz sync cues) and lists each actively
 * nudged deck — signed nudge %% and the smoothed desync it is draining.
 * Empty (and renders nothing) while the replay is phase-locked. */
function ServoReadout() {
  const [activity, setActivity] = useState<ServoDeckActivity[]>([]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      setActivity(replayServoActivity() ?? []);
    }, 500);
    return () => window.clearInterval(timer);
  }, []);
  if (activity.length === 0) return null;
  return (
    <span className="stl-servo" title="Replay is nudging deck rates back into phase (a machine jog): signed rate nudge and the desync being drained">
      ⇄
      {activity.map((a) => (
        <span key={a.deck} className="stl-servo-deck" style={{ color: DECK_COLORS[a.deck] }}>
          {a.deck}
          <i>
            {a.biasPct > 0 ? '+' : ''}
            {a.biasPct.toFixed(1)}% · {Math.round(Math.abs(a.errS) * 1000)}ms{' '}
            {a.errS > 0 ? 'ahead' : 'behind'}
          </i>
        </span>
      ))}
    </span>
  );
}

/** One-line state readout: the cursor's (or selected moment's)
 * reconstruction, per deck in physical order — playhead + audibility.
 * The full detail lives in the lanes themselves now; this is the glance. */
function InlineReadout({
  state,
  trackNames,
}: {
  state: StateAtT | null;
  trackNames: Record<number, string>;
}) {
  if (!state) return <span className="stl-inline-readout dim">—</span>;
  return (
    <span className="stl-inline-readout" title={LANE_ORDER.map((d) => {
      const ds = state.decks[d];
      return `${d}: ${ds.trackId !== null ? trackNames[ds.trackId] ?? ds.trackId : '—'} @ ${fmtClock(ds.playhead)} ${ds.audible ? `audible ${(ds.gain * 100).toFixed(0)}%` : ds.playing ? 'playing (silent)' : 'stopped'}`;
    }).join('\n')}>
      <b>{fmtClock(state.t)}</b>
      {LANE_ORDER.map((d) => {
        const ds = state.decks[d];
        return (
          <span
            key={d}
            className={ds.audible ? 'audible' : ds.playing ? 'playing' : 'silent'}
            style={{ color: DECK_COLORS[d] }}
          >
            {d}
            <i>
              {ds.trackId !== null ? fmtClock(ds.playhead) : '—'}
              {ds.audible ? `·${(ds.gain * 100).toFixed(0)}%` : ''}
            </i>
          </span>
        );
      })}
      {state.tenureHolder ? <em>{state.tenureHolder} holds</em> : null}
    </span>
  );
}
