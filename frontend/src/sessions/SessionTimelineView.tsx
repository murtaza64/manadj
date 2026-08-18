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
import { flushSync } from 'react-dom';
import { useQueries, useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { SessionRowWire, TakeRowWire } from '../api/client';
import { DECK_COLORS } from '../theme/deckColors';
import { requestTakeReview } from '../capture/takeReview';
import { useDecks } from '../hooks/useDeck';
import { useMixer } from '../hooks/useMixer';
import { useToast } from '../components/Toast';
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
  collapseCandidates,
  createStateIndex,
  deriveTimeline,
  traceWindow,
} from './timelineModel';
import type { CollapseCandidate, StateAtT, TimelineModel } from './timelineModel';
import { drawAudibilityArea, drawGridlines, drawStyledRuns, traceRuns } from './waveformLanes';
import type { TraceRun } from './waveformLanes';
import { planReplay } from './replayPlanner';
import {
  replayNowT,
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
/** Canvas draws this much beyond the viewport each side, so native
 * scrolling never outruns the painted window between re-centers. */
const CANVAS_MARGIN = 400;

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
  | { kind: 'take'; take: TakeRowWire };

interface Props {
  session: SessionRowWire;
  /** Deep-link: center on this capture-clock moment on open (history jump). */
  focusS?: number | null;
  /** Standalone-mode back affordance; embedded in the Library the sidebar
   * IS the navigation (Sets parity) and this is omitted. */
  onBack?: () => void;
}

export function SessionTimelineView({ session, focusS, onBack }: Props) {
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

  const [collapseIdle, setCollapseIdle] = useState(true);
  const [thresholdS, setThresholdS] = useState(45);
  const [expandedGaps, setExpandedGaps] = useState<Set<number>>(new Set());
  const [showTraces, setShowTraces] = useState(true);
  const [scrubT, setScrubT] = useState<number | null>(null);
  const [selection, setSelection] = useState<Selection>({ kind: 'none' });
  const [pxPerSec, setPxPerSec] = useState<number | null>(null); // null = fit

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

  const events = detail?.events as CaptureEvent[] | undefined;
  const takes = useMemo(
    () => (allTakes ?? []).filter((t) => t.session_uuid === session.uuid),
    [allTakes, session.uuid]
  );

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
  }, [model, takes]);

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
    const onScroll = () => setScrollX(el.scrollLeft);
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

  const zoomCtxRef = useRef({ model, axis, fitPx, viewportW, collapseIdle, thresholdS, expandedGaps });
  zoomCtxRef.current = { model, axis, fitPx, viewportW, collapseIdle, thresholdS, expandedGaps };
  const pendingZoomRef = useRef<{ factor: number; clientX: number } | null>(null);
  const wheelGestureRef = useRef<{ axis: 'pan' | 'zoom'; last: number } | null>(null);
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
      el.scrollLeft = newScroll;
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
      if (!raf) raf = requestAnimationFrame(applyZoom);
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => {
      el.removeEventListener('wheel', handler);
      if (raf) cancelAnimationFrame(raf);
    };
     
  }, [hasModel]);

  // Deep-link focus: drop the cursor + moment once, and scroll it into view.
  const focusedRef = useRef(false);
  useEffect(() => {
    if (focusedRef.current || focusS == null || !model || !axis) return;
    focusedRef.current = true;
    setScrubT(focusS);
    setSelection({ kind: 'moment', t: focusS });
    const el = scrollRef.current;
    if (el) el.scrollLeft = Math.max(0, axis.tToPx(focusS) - el.clientWidth / 2);
  }, [focusS, model, axis, width]);

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
  useEffect(() => {
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
  }, [replayHere]);

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

  const runsByDeck = useMemo(() => {
    const out = {} as Record<CaptureDeck, TraceRun[]>;
    for (const d of ALL_DECKS) out[d] = model ? traceRuns(model.decks[d]) : [];
    return out;
  }, [model]);

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
    for (const deck of LANE_ORDER) {
      const geo = { width, yOffset: laneY(deck), height: laneH, x0, x1 };
      const dt = model.decks[deck];
      // 1. Audibility area chart (behind).
      drawAudibilityArea(ctx, dt.gainSteps, axis, DECK_COLORS[deck], geo);
      // 2. Full-color styled waveform per track span's runs.
      for (const span of dt.trackSpans) {
        const wave = wavesByTrack[span.trackId];
        const spanRuns = runsByDeck[deck].filter((r) => r.t0 >= span.start && r.t1 <= span.end);
        if (wave) {
          drawStyledRuns(ctx, wave, slot.styleId, slot.params, spanRuns, axis, geo);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, axis, width, svgH, canvasWinStart, viewportW, wavesByTrack, gridsByTrack, runsByDeck, slot]);

  // Stable scene callbacks (the scene is memoized — inline closures would
  // defeat it every render).
  const onTakeClick = useCallback((take: TakeRowWire) => setSelection({ kind: 'take', take }), []);
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

  const onTimelineClick = (clientX: number) => {
    if (!axis || !events) return;
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

        {/* Inline state readout: cursor (or selected moment) reconstruction. */}
        <InlineReadout state={scrubState ?? momentState} trackNames={trackNames} />

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
                  trackNames={trackNames}
                  selectedTakeUuid={selection.kind === 'take' ? selection.take.uuid : null}
                  showTraces={showTraces}
                  candidates={candidates}
                  collapseIdle={collapseIdle}
                  thresholdS={thresholdS}
                  expandedGaps={expandedGaps}
                  onTakeClick={onTakeClick}
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
  trackNames: Record<number, string>;
  selectedTakeUuid: string | null;
  showTraces: boolean;
  /** Collapse candidates (idle + tenure, sessions 14) — indices key the
   * expanded set. */
  candidates: CollapseCandidate[];
  collapseIdle: boolean;
  thresholdS: number;
  expandedGaps: ReadonlySet<number>;
  onTakeClick(take: TakeRowWire): void;
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
  trackNames,
  selectedTakeUuid,
  showTraces,
  candidates,
  collapseIdle,
  thresholdS,
  expandedGaps,
  onTakeClick,
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
          viewX0={viewX0}
          viewX1={viewX1}
          tView0={tView0}
          tView1={tView1}
          h={laneH}
          showTraces={showTraces}
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

      {/* Suspended (>2 audible). */}
      {model.suspended.map((sp, i) => {
        const x0 = X(sp.start);
        const x1 = X(sp.end);
        if (x1 < viewX0 || x0 > viewX1) return null;
        return (
          <rect
            key={`susp-${i}`}
            x={x0}
            y={lanesTop}
            width={Math.max(x1 - x0, 3)}
            height={lanesBottom - lanesTop}
            className="stl-suspended"
          />
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

      {/* Take chips. */}
      {takes.map((t) => {
        const x0 = X(t.window_start_s);
        const x1 = Math.max(X(t.window_end_s), x0 + 12);
        if (x1 < viewX0 || x0 > viewX1) return null;
        const label = `${trackNames[t.a_track_id] ?? t.a_track_id} → ${
          trackNames[t.b_track_id] ?? t.b_track_id
        }`;
        return (
          <g
            key={t.uuid}
            className={`stl-take-chip${selectedTakeUuid === t.uuid ? ' selected' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              onTakeClick(t);
            }}
          >
            <title>{`${label} · confidence ${t.confidence.toFixed(2)}`}</title>
            <rect x={x0} y={RULER_H + 2} width={x1 - x0} height={CHIP_STRIP_H - 6} rx={5} />
            {x1 - x0 > 90 ? (
              <text x={x0 + 5} y={RULER_H + 17}>
                ● {label.slice(0, Math.floor((x1 - x0) / 7))}
              </text>
            ) : (
              <text x={x0 + 4} y={RULER_H + 17}>
                ●
              </text>
            )}
            <line
              x1={x0}
              y1={RULER_H + CHIP_STRIP_H - 4}
              x2={x0}
              y2={lanesBottom}
              className="stl-take-whisker"
            />
            <line
              x1={x1}
              y1={RULER_H + CHIP_STRIP_H - 4}
              x2={x1}
              y2={lanesBottom}
              className="stl-take-whisker"
            />
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
}) {
  const X = (t: number) => axis.tToPx(t);
  const lanesBottom = laneYOf('D', lanesTop, laneH) + laneH;
  const viewX1 = scrollX + viewportW;

  return (
    <g>
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
              return (
                <g key={`trklabel-${i}`}>
                  <rect
                    x={lx - 12}
                    y={y + 3}
                    width={estW + 18}
                    height={14}
                    fill="url(#stl-label-fade)"
                  />
                  <text x={lx + 3} y={y + 14} className="stl-track-label" fill={color}>
                    {label}
                  </text>
                </g>
              );
            })}
          </g>
        );
      })}

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
  viewX0,
  viewX1,
  tView0,
  tView1,
  h,
  showTraces,
}: {
  deck: CaptureDeck;
  y: number;
  model: TimelineModel;
  X(t: number): number;
  /** Quantized visible px window — everything outside is culled. */
  viewX0: number;
  viewX1: number;
  /** The same window in capture time (trace slicing). */
  tView0: number;
  tView1: number;
  h: number;
  showTraces: boolean;
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

      {/* Play/pause markers at the playing-span boundaries. */}
      {dt.playingSpans.map((sp, i) => {
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
      })}

      {/* Jump/cue gesture markers (sessions 04 iteration). */}
      {dt.gestures.map((g, i) => {
        if (g.t < tView0 || g.t > tView1) return null;
        return (
          <g key={`ges-${i}`} className="stl-gesture">
            <title>{`${g.action}${g.detail !== undefined ? ` ${g.detail}` : ''} → ${fmtClock(g.playhead)}`}</title>
            <line x1={X(g.t)} y1={y + 16} x2={X(g.t)} y2={y + h - 4} stroke={color} className="stl-gesture-tick" />
            <text x={X(g.t) + 2} y={y + 26} fill={color}>
              {gestureLabel(g)}
            </text>
          </g>
        );
      })}

      {/* Held loops: a bracket bar along the lane top. */}
      {dt.loops.map((lp, i) => {
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
      })}

      {/* Playhead traces (position-in-track reading), sliced to the
          window — a multi-hour trace is thousands of points, and the
          polyline string was rebuilt whole per render. */}
      {showTraces
        ? dt.traces.map((trace, i) => {
            const win = traceWindow(trace, tView0, tView1);
            if (!win) return null;
            return (
              <polyline
                key={`trace-${i}`}
                points={win
                  .map((p) => `${X(p.t)},${y + 18 + (1 - p.playhead / maxPlayhead) * (h - 24)}`)
                  .join(' ')}
                className="stl-trace"
                stroke={color}
              />
            );
          })
        : null}
    </g>
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
