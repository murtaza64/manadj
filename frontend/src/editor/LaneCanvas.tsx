/**
 * One automation lane: breakpoint polyline editor. The hit div spans the
 * whole lane window, including its value-axis grab gutters; the canvas is
 * viewport-windowed — it covers only the visible slice + margins and is
 * repositioned/redrawn imperatively when scrolling exhausts the margin
 * (full-window canvases were giant compositor surfaces).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { insertChop, nearestTime } from './mixModel';
import { indicesInRect, moveGroup, toggleIndex } from './laneSelection';
import { hitLane, lanePolyline, laneValueY, laneYValue, LANE_SNAP_PX } from './laneHit';
import type { SelectRect } from './laneSelection';
import { LANE_COLORS } from './laneColors';
import { BEAT_TIER_DIM, LADDER_GOLD_RGB } from '../theme/markers';
import {
  emptyLaneShade,
  laneDeviation,
  laneFillAnchor,
  laneNeutral,
  pointStroke,
  segmentShade,
  type LaneControlKind,
} from './laneShade';
import type { LaneId, LanePoint } from './mixModel';
/** One automation lane: breakpoint polyline editor (canvas only; the label
 * and clear button live in the lane strip). */
/** A vertical guide line inside a lane strip (normalized x within the transition). */
export interface LaneGuide {
  x: number;
  /** Downbeats and cue lines render stronger than plain beats. */
  strong: boolean;
  /** Metric-ladder tier of a downbeat guide (0 = bar … 4 = 16-bar
   * boundary, metric-ladder 01); undefined on weak beats and cues. */
  tier?: number;
  /** This downbeat's bar is parenthetical ("extra" — metric-ladder 03):
   * the guide tints gold, continuing the waveform rows' band language. */
  parenthetical?: boolean;
  color?: string;
}

/** Lane-guide styling per Metric-ladder tier (bar … 16-bar). Dimmer than
 * the waveform gridlines — guides sit under automation breakpoints. Data
 * lives in theme/markers.ts (BEAT_TIER_DIM, gh#201). */
const GUIDE_TIER_ALPHA = BEAT_TIER_DIM.alpha;
const GUIDE_TIER_WIDTH = BEAT_TIER_DIM.width;

/** Breakpoint circle radius (uniform for all points). */
const LANE_POINT_R = 5;

/** Lane canvas bitmap width cap (buffer px): effective DPR shrinks once a
 * window's CSS width exceeds this, keeping deep-zoom canvases inside GPU
 * limits and the compositor budget. */
const LANE_MAX_BITMAP_PX = 8192;
/** Canvas render padding; horizontal endpoint circles may overhang the plot.
 * Must match the canvas inset/size in transitionEditor.css. */
const LANE_PAD = 7;
/** Pointer travel (px) below which a cmd/ctrl gesture is a CLICK (toggle
 * select) rather than a rubber-band drag. */
const MARQUEE_CLICK_PX = 4;

export function LaneCanvas({
  id,
  kind,
  color: colorProp,
  widthPx,
  points,
  guides,
  chopWall,
  windowLeftPx,
  registerScrollDraw,
  onChange,
  selected,
  onSelectedChange,
}: {
  /** Lane identity: kind semantics (neutral line, fill anchor, shade
   * ramps, filter snap) key off the id's control prefix. The Routine
   * editor passes kind-matched ids for its slot lanes (gh#170 pass 2 —
   * a pair is the 2-slot special case; this canvas is the shared lane
   * editor) with a `color` override carrying slot identity. */
  id: LaneId;
  /** Override renderer semantics without expanding the pair artifact model. */
  kind?: LaneControlKind;
  /** Stroke/fill color; defaults to the pair palette (LANE_COLORS[id]). */
  color?: string;
  /** Rendered width — a draw-effect dependency so zoom resizes redraw in
   * place (this used to be a `key`, remounting the canvas per zoom step). */
  widthPx: number;
  points: LanePoint[];
  guides: LaneGuide[];
  /** Chop wall width, normalized — fixed TIME upstream (steep at any
   * window length; a duration-proportional wall audibly ramped on long
   * transitions). */
  chopWall: number;
  /** The lane window's left edge in content px (for view→window mapping). */
  windowLeftPx: number;
  /** Scroll hookup: the rAF tick feeds the visible content range so the
   * canvas can reposition/redraw when the view leaves its drawn span. */
  registerScrollDraw: (id: LaneId, fn: ((viewL: number, viewR: number) => void) | null) => void;
  onChange: (points: LanePoint[]) => void;
  /** Selected node indices in THIS lane (mix-editor 16). The owner keys
   * selection state by lane id, so this is [] for every other lane. */
  selected: number[];
  onSelectedChange: (indices: number[]) => void;
}) {
  const styleId = kind ?? id;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointsRef = useRef(points);
  useLayoutEffect(() => { pointsRef.current = points; }, [points]);
  const dragIndex = useRef<number | null>(null);
  const dragOffset = useRef<LanePoint>({ x: 0, y: 0 });
  /** Alt-drag lane translation (redirect 2026-09-02). */
  const laneShift = useRef<{ orig: LanePoint[]; startX: number } | null>(null);
  /** Hovered breakpoint index (shows its value readout). */
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [hoverInsertion, setInsertPreview] = useState<{
    point: LanePoint; height: number; points: LanePoint[]; guides: LaneGuide[]; width: number; id: LaneId; kind?: LaneControlKind;
  } | null>(null);
  const insertPreview = hoverInsertion?.points === points && hoverInsertion.guides === guides &&
    hoverInsertion.width === widthPx && hoverInsertion.id === id && hoverInsertion.kind === kind ? hoverInsertion : null;
  useEffect(() => {
    const clearForModifier = (e: KeyboardEvent) => {
      if (['Alt', 'Control', 'Meta', 'Shift'].includes(e.key)) setInsertPreview(null);
    };
    window.addEventListener('keydown', clearForModifier);
    return () => window.removeEventListener('keydown', clearForModifier);
  }, []);
  /** Redraw on HEIGHT changes only: strips flex-share the timeline height,
   * so adding/removing ANY lane resizes this one (a stale bitmap would
   * stretch). Width changes are already covered by the `widthPx` draw dep —
   * reacting to them here doubled the per-frame work during zoom gestures
   * (a second React commit + redraw of every lane, v24 regression hunt). */
  const [resizeTick, setResizeTick] = useState(0);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let lastH = canvas.clientHeight;
    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height ?? 0;
      if (h !== lastH) {
        lastH = h;
        setInsertPreview(null);
        setResizeTick((n) => n + 1);
      }
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);
  /** In-flight chop stamp gesture (shift+drag on empty lane space). */
  const chopStart = useRef<number | null>(null);
  const [chopPreview, setChopPreview] = useState<{ x0: number; x1: number } | null>(null);

  // ── Group selection (mix-editor 16) ──
  const selectedRef = useRef(selected);
  useLayoutEffect(() => { selectedRef.current = selected; }, [selected]);
  /** In-flight rectangle or cmd/ctrl time-span gesture: anchor in RAW lane
   * coords (the band never beat-snaps) plus the client px origin for the
   * click-vs-drag threshold. Stays a click until it travels. */
  const marqueeStart = useRef<{ x: number; y: number; cx: number; cy: number; armed: boolean; timeRange: boolean } | null>(
    null
  );
  const [marquee, setMarquee] = useState<SelectRect | null>(null);
  /** In-flight group drag: the points snapshot at pointer-down plus the
   * grabbed node's original position. Every move applies ONE delta to the
   * snapshot (shape preserved exactly — no per-node re-snapping). */
  const groupDrag = useRef<{ orig: LanePoint[]; grab: LanePoint } | null>(null);
  /** Structural changes from outside this component (crop remaps, template
   * stamps, lane clear) can strand indices past the end — drop them. */
  useEffect(() => {
    if (selected.length > 0 && selected.some((i) => i >= points.length)) onSelectedChange([]);
  });

  /** Beat guide positions (cue markers excluded), ascending. */
  const beatXs = useMemo(() => guides.filter((g) => !g.color).map((g) => g.x), [guides]);
  /** Chop edges snap to the beat lines themselves; `insertChop` centers
   * each wall on its line, so the cut-out opens just before the beat. */
  const snapCutX = (x: number) => (beatXs.length ? (nearestTime(beatXs, x) ?? x) : x);
  /** The visible beat interval containing x (for the 1-beat click cut). */
  const beatIntervalAt = (x: number): [number, number] | null => {
    let lo: number | null = null;
    for (const b of beatXs) {
      if (b <= x) lo = b;
      else return lo !== null ? [lo, b] : null;
    }
    return null;
  };

  // ── Viewport-windowed canvas (scroll-jitter fix) ──
  // The canvas covers only the visible slice of the lane window plus a
  // half-viewport margin each side — full-window canvases at deep zoom were
  // giant compositor surfaces that hitched when scrolled into/out of frame.
  // Scrolling inside the margin just translates (with the content layer);
  // leaving it repositions + redraws imperatively via the rAF tick.
  const geomRef = useRef({ widthPx, windowLeftPx });
  // Mirror before the redraw layout effect: passive updates draw one
  // frame at the previous zoom scale (#221).
  useLayoutEffect(() => { geomRef.current = { widthPx, windowLeftPx }; }, [widthPx, windowLeftPx]);
  /** Last visible range in window-local CSS px (fed by the tick). */
  const lastViewRef = useRef<{ l: number; r: number } | null>(null);
  /** The span currently drawn (window-local), and the window width it was
   * computed against (zoom changes invalidate it). */
  const spanRef = useRef<{ left: number; width: number; forWidth: number } | null>(null);

  const draw = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const lw = geomRef.current.widthPx; // full window width = value-axis x scale
    const view = lastViewRef.current ?? { l: 0, r: Math.min(lw, 1600) };
    const margin = Math.max((view.r - view.l) / 2, 200);
    const spanL = Math.max(0, view.l - margin);
    const spanR = Math.min(lw, view.r + margin);
    const spanW = Math.max(spanR - spanL, 4);
    spanRef.current = { left: spanL, width: spanW, forWidth: lw };
    canvas.style.left = `${spanL}px`;
    canvas.style.width = `${spanW + LANE_PAD * 2}px`;
    const w = spanW + LANE_PAD * 2;
    const h = canvas.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, LANE_MAX_BITMAP_PX / Math.max(w, 1));
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    // Canvas padding is outside the hit rect; the value-axis gutter is inside it.
    const lh = h - LANE_PAD * 2;
    const lx = (nx: number) => LANE_PAD + nx * lw - spanL;
    // Keep boundary nodes inside their own pointer target. The surrounding
    // gutter is clickable without overlapping the next automation strip.
    const ly = (ny: number) => LANE_PAD + laneValueY(ny, lh);
    const plotTop = ly(1);
    const plotHeight = ly(0) - plotTop;
    // Background + NEUTRAL guide clipped to the lane rect ∩ this canvas.
    // The guide sits at the lane's neutral (mix-editor 39): center for
    // EQ/filter, EMPTY (bottom) for faders. Filters fill from this line;
    // faders and EQ fill from MIN (energy present — laneFillAnchor). The
    // fader guide coincides with the plot's bottom edge.
    const neutralY = ly(laneNeutral(styleId));
    const bx1 = Math.max(lx(0), 0);
    const bx2 = Math.min(lx(1), w);
    if (bx2 > bx1) {
      ctx.fillStyle = 'rgba(24, 24, 24, 0.85)';
      ctx.fillRect(bx1, plotTop, bx2 - bx1, plotHeight);
      ctx.fillStyle = 'rgba(255,255,255,0.13)';
      ctx.fillRect(bx1, neutralY, bx2 - bx1, 1);
    }

    // Beat/cue guides continue through the lanes (beatmatching alignment).
    for (const g of guides) {
      const gx = lx(g.x);
      if (gx < -2 || gx > w + 2) continue;
      if (g.color) {
        ctx.fillStyle = g.color;
        ctx.globalAlpha = 0.5;
        ctx.fillRect(gx - 0.5, plotTop, 1.5, plotHeight);
        ctx.globalAlpha = 1;
      } else if (g.tier !== undefined) {
        const t = Math.min(g.tier, GUIDE_TIER_ALPHA.length - 1);
        // Parenthetical bars tint gold (metric-ladder 03), matching the
        // waveform rows' band treatment.
        ctx.fillStyle = g.parenthetical
          ? `rgba(${LADDER_GOLD_RGB},${GUIDE_TIER_ALPHA[t] + 0.12})`
          : `rgba(255,255,255,${GUIDE_TIER_ALPHA[t]})`;
        ctx.fillRect(gx, plotTop, GUIDE_TIER_WIDTH[t], plotHeight);
      } else {
        ctx.fillStyle = g.strong ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.09)';
        ctx.fillRect(gx, plotTop, g.strong ? 1.5 : 1, plotHeight);
      }
    }

    // Chop stamp preview: the beat-snapped span about to be cut.
    if (chopPreview) {
      const a = lx(Math.min(chopPreview.x0, chopPreview.x1));
      const b = lx(Math.max(chopPreview.x0, chopPreview.x1));
      ctx.fillStyle = 'rgba(255, 45, 85, 0.3)';
      ctx.fillRect(a, plotTop, Math.max(b - a, 1.5), plotHeight);
    }

    const color = colorProp ?? LANE_COLORS[id];
    // DEVIATION rendering (mix-editor 39): the curve renders per straight
    // segment — grey at/near neutral ramping to the deck color with
    // deviation, with the area between curve and NEUTRAL AXIS filled as a
    // horizontal gradient whose alpha tracks the INTERPOLATED value (the
    // stops come from segmentShade; a flat segment degenerates to a flat
    // fill). Flat extensions to the window edges get the same treatment
    // (off-canvas coordinates clip harmlessly). Filter segments hue-split
    // by side (LPF dark / HPF light) inside segmentShade.
    if (points.length > 0) {
      const fillY = ly(laneFillAnchor(styleId));
      const ext = lanePolyline(points, emptyLaneShade(styleId).y);
      for (let i = 0; i < ext.length - 1; i++) {
        const a = ext[i];
        const b = ext[i + 1];
        const shade = segmentShade(styleId, color, a.y, b.y);
        if (shade.fill !== null) {
          const x0 = lx(a.x);
          const x1 = lx(b.x);
          ctx.beginPath();
          ctx.moveTo(x0, ly(a.y));
          ctx.lineTo(x1, ly(b.y));
          ctx.lineTo(x1, fillY);
          ctx.lineTo(x0, fillY);
          ctx.closePath();
          if (x1 - x0 > 0.5) {
            const grad = ctx.createLinearGradient(x0, 0, x1, 0);
            for (const s of shade.fill) grad.addColorStop(s.offset, s.color);
            ctx.fillStyle = grad;
          } else {
            // Degenerate span (vertical slam): no visible area to grade.
            ctx.fillStyle = shade.fill[shade.fill.length - 1].color;
          }
          ctx.fill();
        }
        {
          // Stroke: same per-value gradient as the fill. Degenerate spans
          // (vertical slams) take the strongest endpoint so a slam still
          // reads at full strength.
          const x0 = lx(a.x);
          const x1 = lx(b.x);
          ctx.beginPath();
          ctx.moveTo(x0, ly(a.y));
          ctx.lineTo(x1, ly(b.y));
          if (x1 - x0 > 0.5) {
            const grad = ctx.createLinearGradient(x0, 0, x1, 0);
            for (const s of shade.stroke) grad.addColorStop(s.offset, s.color);
            ctx.strokeStyle = grad;
          } else {
            const deeper = laneDeviation(styleId, a.y) >= laneDeviation(styleId, b.y) ? a.y : b.y;
            ctx.strokeStyle = pointStroke(styleId, color, deeper);
          }
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
    } else if (bx2 > bx1) {
      // EMPTY lane: a flat neutral-grey line at the resting default with a
      // grey fill down to the anchor — present but untouched, instead of a
      // bare background (walkthrough feedback).
      const es = emptyLaneShade(styleId);
      const yPx = ly(es.y);
      const fillY = ly(laneFillAnchor(styleId));
      if (Math.abs(fillY - yPx) > 0.5) {
        ctx.fillStyle = es.fill;
        ctx.fillRect(bx1, Math.min(yPx, fillY), bx2 - bx1, Math.abs(fillY - yPx));
      }
      ctx.beginPath();
      ctx.moveTo(bx1, yPx);
      ctx.lineTo(bx2, yPx);
      ctx.strokeStyle = es.stroke;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Breakpoints: uniform size, centered on their true curve position. Dots
    // follow the deviation ramp too: a breakpoint parked at neutral is
    // quiet grey, a working one carries the lane color.
    points.forEach((p) => {
      ctx.beginPath();
      ctx.arc(lx(p.x), ly(p.y), LANE_POINT_R, 0, Math.PI * 2);
      ctx.fillStyle = pointStroke(styleId, color, p.y);
      ctx.fill();
    });

    // Selected nodes: filled ring — a white halo around the lane-colored
    // fill reads against both the lane fill and the waveforms.
    for (const i of selected) {
      const p = points[i];
      if (!p) continue;
      ctx.beginPath();
      ctx.arc(lx(p.x), ly(p.y), LANE_POINT_R + 2.5, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Plain rectangle or modifier time-span selection.
    if (marquee) {
      const mx0 = lx(Math.min(marquee.x0, marquee.x1));
      const mx1 = lx(Math.max(marquee.x0, marquee.x1));
      const my0 = ly(Math.max(marquee.y0, marquee.y1));
      const my1 = ly(Math.min(marquee.y0, marquee.y1));
      ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.fillRect(mx0, my0, mx1 - mx0, my1 - my0);
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.lineWidth = 1;
      ctx.strokeRect(mx0, my0, mx1 - mx0, my1 - my0);
      ctx.setLineDash([]);
    }

    // Value readout: hovered breakpoint only.
    if (hoverIndex !== null && points[hoverIndex]) {
      const p = points[hoverIndex];
      const text = p.y.toFixed(2);
      ctx.font = 'bold 10px monospace';
      ctx.textBaseline = 'middle';
      const cx = lx(p.x);
      const cy = Math.max(LANE_PAD + 7, Math.min(LANE_PAD + lh - 7, ly(p.y)));
      const tw = ctx.measureText(text).width;
      // Label to whichever side has room.
      const rightward = cx + 14 + tw < w;
      const tx = rightward ? cx + 12 : cx - 12 - tw;
      ctx.fillStyle = 'rgba(17, 17, 17, 0.85)';
      ctx.fillRect(tx - 2, cy - 7, tw + 4, 14);
      ctx.fillStyle = '#cdd6f4';
      ctx.fillText(text, tx, cy);
    }
  };
  const drawRef = useRef(draw);
  useLayoutEffect(() => { drawRef.current = draw; });

  // React-triggered redraws (model/hover/zoom/height changes). LAYOUT
  // effect (#221 desync): on zoom the lane window rescales during the
  // commit — a post-paint redraw showed the OLD envelope at the NEW
  // geometry for a frame (the "automation jumping around while zooming").
  useLayoutEffect(() => {
    drawRef.current();
  }, [points, id, kind, colorProp, guides, widthPx, hoverIndex, chopPreview, resizeTick, selected, marquee]);

  // Scroll-triggered redraws: reposition only when the view leaves the
  // drawn span (or the zoom it was drawn at changed). LAYOUT effect: the
  // owner feeds the current view synchronously at registration (#221
  // blank-on-open bug) — that first feed must land before paint.
  useLayoutEffect(() => {
    registerScrollDraw(id, (viewL, viewR) => {
      const { widthPx: lw, windowLeftPx: left } = geomRef.current;
      const l = Math.max(0, viewL - left);
      const r = Math.min(lw, viewR - left);
      if (lastViewRef.current && (lastViewRef.current.l !== l || lastViewRef.current.r !== r)) {
        setInsertPreview(null);
      }
      lastViewRef.current = { l, r };
      const s = spanRef.current;
      if (!s || s.forWidth !== lw || l < s.left || r > s.left + s.width) {
        drawRef.current();
      }
    });
    return () => registerScrollDraw(id, null);
  }, [id, registerScrollDraw]);

  const pointAt = (e: React.PointerEvent | React.MouseEvent, offset: LanePoint = { x: 0, y: 0 }) => {
    // The hit div overhangs the lane rect by LANE_PAD on the sides (grabbing
    // the x=0/x=1 breakpoints from either half of their circle); vertically
    // it stays exact so it never steals clicks from the strips above/below.
    const rect = e.currentTarget.getBoundingClientRect();
    const lw = rect.width - LANE_PAD * 2;
    const ex = e.clientX - rect.left;
    const ey = e.clientY - rect.top;
    // Keep the pointer unbounded for rectangles and grab offsets. Clamp
    // only the final node position after the offset has been applied.
    const rawX = (ex - LANE_PAD) / lw;
    const rawY = laneYValue(ey, rect.height);
    let x = Math.max(0, Math.min(1, rawX + offset.x));
    // Loose beat-line magnet: within a few px the point snaps onto the
    // guide; beyond that placement is free (fine control between beats).
    // Shift suspends it, like every other snap.
    if (!e.shiftKey) {
      let bestD = LANE_SNAP_PX / lw;
      let bestX: number | null = null;
      for (const g of guides) {
        if (g.color) continue; // beat lines only, not cue markers
        const d = Math.abs(g.x - x);
        if (d < bestD) {
          bestD = d;
          bestX = g.x;
        }
      }
      if (bestX !== null) x = bestX;
    }
    const plain = !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
    const hit = hitLane(pointsRef.current, ex - LANE_PAD, ey, lw, rect.height,
      emptyLaneShade(styleId).y, plain ? beatXs : []);
    const insertion = hit.insertion && plain
      ? { ...hit.insertion, y: snapValue(hit.insertion.y, e) } : null;
    const coincident = insertion ? pointsRef.current.findIndex(p =>
      Math.abs(p.x - insertion.x) < 1e-9 && Math.abs(p.y - insertion.y) < 1e-9) : -1;
    return {
      x,
      /** Unsnapped x — the rubber band never beat-snaps. */
      rawX,
      rawY,
      y: Math.max(0, Math.min(1, rawY + offset.y)),
      nearestIndex: coincident >= 0 ? coincident : hit.nearestIndex,
      insertion: coincident >= 0 ? null : insertion,
      insertionIndex: hit.insertionIndex,
      height: rect.height,
    };
  };

  const commit = (pts: LanePoint[]) => onChange([...pts].sort((a, b) => a.x - b.x));

  /** Non-fader controls magnet to their neutral 0.5. Shift suspends snapping. */
  const snapValue = (y: number, e: { shiftKey: boolean }) =>
    !styleId.startsWith('fader') && !e.shiftKey && Math.abs(y - 0.5) < 0.08 ? 0.5 : y;

  // Vertical gutters belong to this lane; neighboring hit areas never overlap.
  return (
    <div
      className="editor-lanehit"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        setInsertPreview(null);
        const hit = pointAt(e);
        if (e.altKey) {
          // Redirect 2026-09-02: alt-drag TRANSLATES the whole envelope
          // horizontally (move an automation lane on its own).
          laneShift.current = { orig: pointsRef.current, startX: hit.rawX };
        } else if (e.metaKey || e.ctrlKey) {
          // Selection gesture (mix-editor 16): stays a click (toggle the
          // node under the pointer) until it travels — then rubber-band.
          marqueeStart.current = { x: hit.rawX, y: hit.rawY, cx: e.clientX, cy: e.clientY, armed: false, timeRange: true };
        } else if (hit.nearestIndex >= 0 && selectedRef.current.includes(hit.nearestIndex)) {
          // Group drag: any selected node tows the whole selection.
          groupDrag.current = {
            orig: pointsRef.current,
            grab: pointsRef.current[hit.nearestIndex],
          };
          dragOffset.current = { x: groupDrag.current.grab.x - hit.rawX, y: groupDrag.current.grab.y - hit.rawY };
        } else if (hit.nearestIndex >= 0) {
          // Grabbing a breakpoint wins over the chop gesture: shift+drag ON
          // a point stays the fine-drag (snap suspended) from issue 09.
          dragIndex.current = hit.nearestIndex;
          const p = pointsRef.current[hit.nearestIndex];
          dragOffset.current = { x: p.x - hit.rawX, y: p.y - hit.rawY };
          onSelectedChange([]);
        } else if (e.shiftKey) {
          // Chop stamp: shift+drag spans a cut, shift+click cuts one beat.
          chopStart.current = hit.x;
          setChopPreview({ x0: snapCutX(hit.x), x1: snapCutX(hit.x) });
        } else if (hit.insertion) {
          const point = hit.insertion;
          const pts = [...pointsRef.current];
          pts.splice(hit.insertionIndex, 0, point);
          pts.sort((a, b) => a.x - b.x);
          dragIndex.current = pts.indexOf(point);
          dragOffset.current = { x: point.x - hit.rawX, y: point.y - hit.rawY };
          onSelectedChange([]);
          commit(pts);
        } else {
          onSelectedChange([]);
          marqueeStart.current = { x: hit.rawX, y: hit.rawY, cx: e.clientX, cy: e.clientY, armed: false, timeRange: false };
        }
      }}
      onPointerMove={(e) => {
        const hit = pointAt(e, dragIndex.current !== null || groupDrag.current ? dragOffset.current : undefined);
        if (laneShift.current) {
          const dx = hit.rawX - laneShift.current.startX;
          onChange(laneShift.current.orig.map((p) => ({ ...p, x: p.x + dx })));
          return;
        }
        if (marqueeStart.current) {
          const m = marqueeStart.current;
          if (!m.armed && Math.hypot(e.clientX - m.cx, e.clientY - m.cy) >= MARQUEE_CLICK_PX) {
            m.armed = true;
          }
          if (m.armed) {
            const rect: SelectRect = { x0: m.x, y0: m.timeRange ? 0 : m.y,
              x1: hit.rawX, y1: m.timeRange ? 1 : hit.rawY };
            setMarquee(rect);
            onSelectedChange(indicesInRect(pointsRef.current, rect));
          }
          return;
        }
        if (groupDrag.current) {
          const { orig, grab } = groupDrag.current;
          onChange(moveGroup(orig, selectedRef.current, hit.x - grab.x, snapValue(hit.y, e) - grab.y));
          return;
        }
        if (chopStart.current !== null) {
          setChopPreview({ x0: snapCutX(chopStart.current), x1: snapCutX(hit.x) });
          return;
        }
        if (dragIndex.current === null) {
          setHoverIndex(hit.nearestIndex >= 0 ? hit.nearestIndex : null);
          setInsertPreview(hit.insertion ? { point: hit.insertion, height: hit.height,
            points: pointsRef.current, guides, width: widthPx, id, kind } : null);
          return;
        }
        const pts = [...pointsRef.current];
        pts[dragIndex.current] = { x: hit.x, y: snapValue(hit.y, e) };
        const i = dragIndex.current;
        if (i > 0) pts[i].x = Math.max(pts[i].x, pts[i - 1].x);
        if (i < pts.length - 1) pts[i].x = Math.min(pts[i].x, pts[i + 1].x);
        onChange(pts);
      }}
      onPointerUp={(e) => {
        dragOffset.current = { x: 0, y: 0 };
        if (laneShift.current) {
          laneShift.current = null;
          return;
        }
        if (marqueeStart.current) {
          const m = marqueeStart.current;
          marqueeStart.current = null;
          setMarquee(null);
          if (!m.armed) {
            // Cmd/ctrl+CLICK: toggle the node under the pointer in/out of
            // the selection; on empty space it deselects.
            const hit = pointAt(e);
            onSelectedChange(
              m.timeRange && hit.nearestIndex >= 0 ? toggleIndex(selectedRef.current, hit.nearestIndex) : []
            );
          }
          return;
        }
        if (groupDrag.current) {
          groupDrag.current = null;
          return;
        }
        dragIndex.current = null;
        const x0 = chopStart.current;
        chopStart.current = null;
        setChopPreview(null);
        if (x0 === null) return;
        const hit = pointAt(e);
        const rect = e.currentTarget.getBoundingClientRect();
        const dragPx = Math.abs(hit.x - x0) * (rect.width - LANE_PAD * 2);
        const lo = snapCutX(x0);
        const hi = snapCutX(hit.x);
        // A click (or a drag whose edges snap to the same beat) cuts the
        // single beat interval under the pointer.
        const span = dragPx < 4 || lo === hi ? beatIntervalAt(hit.x) : ([lo, hi] as const);
        if (span) {
          commit(insertChop(pointsRef.current, span[0], span[1], chopWall));
          // The stamp restructures the array — stale indices would select
          // the wrong nodes.
          if (selectedRef.current.length > 0) onSelectedChange([]);
        }
      }}
      onPointerCancel={() => {
        setInsertPreview(null);
        dragOffset.current = { x: 0, y: 0 };
        laneShift.current = null;
        dragIndex.current = null;
        chopStart.current = null;
        setChopPreview(null);
        marqueeStart.current = null;
        setMarquee(null);
        groupDrag.current = null;
      }}
      onPointerLeave={() => { setHoverIndex(null); setInsertPreview(null); }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        const hit = pointAt(e);
        if (hit.nearestIndex >= 0 && pointsRef.current.length > 1) {
          const pts = pointsRef.current.filter((_, i) => i !== hit.nearestIndex);
          commit(pts);
          // Indices shift past the removed node — drop the selection.
          if (selectedRef.current.length > 0) onSelectedChange([]);
        }
      }}
    >
      <canvas ref={canvasRef} />
      {insertPreview && (
        <span className="editor-lane-insert-preview" aria-hidden="true" style={{
          left: LANE_PAD + insertPreview.point.x * widthPx,
          top: laneValueY(insertPreview.point.y, insertPreview.height),
          background: pointStroke(styleId, colorProp ?? LANE_COLORS[id], insertPreview.point.y),
        }} />
      )}
    </div>
  );
}
