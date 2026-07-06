/**
 * One automation lane: breakpoint polyline editor. The hit div spans the
 * whole lane window (pointer coords map 1:1 to lane values); the canvas is
 * viewport-windowed — it covers only the visible slice + margins and is
 * repositioned/redrawn imperatively when scrolling exhausts the margin
 * (full-window canvases were giant compositor surfaces).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { insertChop, nearestTime } from './mixModel';
import { indicesInRect, moveGroup, toggleIndex } from './laneSelection';
import type { SelectRect } from './laneSelection';
import { LANE_COLORS } from './laneColors';
import type { LaneId, LanePoint } from './mixModel';
/** One automation lane: breakpoint polyline editor (canvas only; the label
 * and clear button live in the lane strip). */
/** A vertical guide line inside a lane strip (normalized x within the transition). */
export interface LaneGuide {
  x: number;
  /** Downbeats and cue lines render stronger than plain beats. */
  strong: boolean;
  color?: string;
}

/** Breakpoint circle radius (uniform for all points). */
const LANE_POINT_R = 5;
/** Grab tolerance around a breakpoint (px). */
const LANE_GRAB_PX = 13;
/** Vertical inset of the VALUE range inside the lane rect: y=0/y=1
 * breakpoints sit this far from the strip boundary instead of ON it —
 * without this, bottom-edge points were half outside the hit div and hard
 * to grab (and grabbing them fought the adjacent strip). */
const LANE_VPAD = 6;
/** Lane canvas bitmap width cap (buffer px): effective DPR shrinks once a
 * window's CSS width exceeds this, keeping deep-zoom canvases inside GPU
 * limits and the compositor budget. */
const LANE_MAX_BITMAP_PX = 8192;
/** Beat-line magnet radius (px) — loose: outside it placement is free. */
const LANE_SNAP_PX = 6;
/** Canvas overhang past the editable lane rect on every side, so breakpoint
 * circles at the extremes render complete, floating over the window borders.
 * Must match the canvas inset/size in transitionEditor.css. */
const LANE_PAD = 7;
/** Pointer travel (px) below which a cmd/ctrl gesture is a CLICK (toggle
 * select) rather than a rubber-band drag. */
const MARQUEE_CLICK_PX = 4;

export function LaneCanvas({
  id,
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
  id: LaneId;
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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointsRef = useRef(points);
  useEffect(() => {
    pointsRef.current = points;
  });
  const dragIndex = useRef<number | null>(null);
  /** Hovered breakpoint index (shows its value readout). */
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
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
  useEffect(() => {
    selectedRef.current = selected;
  });
  /** In-flight rubber-band gesture (cmd/ctrl+drag): anchor in RAW lane
   * coords (the band never beat-snaps) plus the client px origin for the
   * click-vs-drag threshold. Stays a click until it travels. */
  const marqueeStart = useRef<{ x: number; y: number; cx: number; cy: number; armed: boolean } | null>(
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
  useEffect(() => {
    geomRef.current = { widthPx, windowLeftPx };
  });
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
    // The editable lane rect sits inset by LANE_PAD; the pad ring stays
    // transparent except where breakpoint circles overflow into it.
    const lh = h - LANE_PAD * 2;
    const lx = (nx: number) => LANE_PAD + nx * lw - spanL;
    // Value axis inset by LANE_VPAD: extremes stay grabbable (see const).
    const ly = (ny: number) => LANE_PAD + LANE_VPAD + (1 - ny) * (lh - LANE_VPAD * 2);
    // Background/midline clipped to the lane rect ∩ this canvas.
    const bx1 = Math.max(lx(0), 0);
    const bx2 = Math.min(lx(1), w);
    if (bx2 > bx1) {
      ctx.fillStyle = 'rgba(24, 24, 37, 0.85)';
      ctx.fillRect(bx1, LANE_PAD, bx2 - bx1, lh);
      ctx.fillStyle = '#313244';
      ctx.fillRect(bx1, LANE_PAD + lh / 2, bx2 - bx1, 1);
    }

    // Beat/cue guides continue through the lanes (beatmatching alignment).
    for (const g of guides) {
      const gx = lx(g.x);
      if (gx < -2 || gx > w + 2) continue;
      if (g.color) {
        ctx.fillStyle = g.color;
        ctx.globalAlpha = 0.5;
        ctx.fillRect(gx - 0.5, LANE_PAD, 1.5, lh);
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = g.strong ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.09)';
        ctx.fillRect(gx, LANE_PAD, g.strong ? 1.5 : 1, lh);
      }
    }

    // Chop stamp preview: the beat-snapped span about to be cut.
    if (chopPreview) {
      const a = lx(Math.min(chopPreview.x0, chopPreview.x1));
      const b = lx(Math.max(chopPreview.x0, chopPreview.x1));
      ctx.fillStyle = 'rgba(255, 45, 85, 0.3)';
      ctx.fillRect(a, LANE_PAD, Math.max(b - a, 1.5), lh);
    }

    const color = LANE_COLORS[id];
    // Curve path (with flat extensions to the window edges; off-canvas
    // coordinates clip harmlessly).
    const tracePath = () => {
      ctx.beginPath();
      points.forEach((p, i) => {
        const px = lx(p.x);
        const py = ly(p.y);
        if (i === 0) {
          ctx.moveTo(lx(0), py);
          ctx.lineTo(px, py);
        }
        ctx.lineTo(px, py);
        if (i === points.length - 1) ctx.lineTo(lx(1), py);
      });
    };

    // Translucent fill under the curve (DAW-style) — makes each lane's shape
    // read at a glance even when several strips are stacked.
    tracePath();
    ctx.lineTo(lx(1), ly(0));
    ctx.lineTo(lx(0), ly(0));
    ctx.closePath();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 1;

    tracePath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Breakpoints: uniform size, centered on their true curve position —
    // circles at the extremes overflow into the pad, floating over the
    // window borders instead of getting cut off or nudged inward.
    points.forEach((p) => {
      ctx.beginPath();
      ctx.arc(lx(p.x), ly(p.y), LANE_POINT_R, 0, Math.PI * 2);
      ctx.fillStyle = color;
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

    // Rubber-band rect (cmd/ctrl+drag in flight).
    if (marquee) {
      const mx0 = lx(Math.min(marquee.x0, marquee.x1));
      const mx1 = lx(Math.max(marquee.x0, marquee.x1));
      const my0 = ly(Math.max(marquee.y0, marquee.y1)); // ly inverts
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
      ctx.fillStyle = 'rgba(17, 17, 27, 0.85)';
      ctx.fillRect(tx - 2, cy - 7, tw + 4, 14);
      ctx.fillStyle = '#cdd6f4';
      ctx.fillText(text, tx, cy);
    }
  };
  const drawRef = useRef(draw);
  useEffect(() => {
    drawRef.current = draw;
  });

  // React-triggered redraws (model/hover/zoom/height changes).
  useEffect(() => {
    drawRef.current();
  }, [points, id, guides, widthPx, hoverIndex, chopPreview, resizeTick, selected, marquee]);

  // Scroll-triggered redraws: reposition only when the view leaves the
  // drawn span (or the zoom it was drawn at changed).
  useEffect(() => {
    registerScrollDraw(id, (viewL, viewR) => {
      const { widthPx: lw, windowLeftPx: left } = geomRef.current;
      const l = Math.max(0, viewL - left);
      const r = Math.min(lw, viewR - left);
      lastViewRef.current = { l, r };
      const s = spanRef.current;
      if (!s || s.forWidth !== lw || l < s.left || r > s.left + s.width) {
        drawRef.current();
      }
    });
    return () => registerScrollDraw(id, null);
  }, [id, registerScrollDraw]);

  const pointAt = (e: React.PointerEvent | React.MouseEvent) => {
    // The hit div overhangs the lane rect by LANE_PAD on the sides (grabbing
    // the x=0/x=1 breakpoints from either half of their circle); vertically
    // it stays exact so it never steals clicks from the strips above/below.
    const rect = e.currentTarget.getBoundingClientRect();
    const lw = rect.width - LANE_PAD * 2;
    const ex = e.clientX - rect.left;
    const ey = e.clientY - rect.top;
    const rawX = Math.max(0, Math.min(1, (ex - LANE_PAD) / lw));
    let x = rawX;
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
    // Same LANE_VPAD-inset value axis as the draw effect.
    const vh = rect.height - LANE_VPAD * 2;
    return {
      x,
      /** Unsnapped x — the rubber band never beat-snaps. */
      rawX,
      y: Math.max(0, Math.min(1, 1 - (ey - LANE_VPAD) / vh)),
      nearestIndex: (() => {
        let best = -1;
        let bestDist = Infinity;
        pointsRef.current.forEach((p, i) => {
          const dx = LANE_PAD + p.x * lw - ex;
          const dy = LANE_VPAD + (1 - p.y) * vh - ey;
          const d = Math.hypot(dx, dy);
          if (d < bestDist) {
            bestDist = d;
            best = i;
          }
        });
        return bestDist < LANE_GRAB_PX ? best : -1;
      })(),
    };
  };

  const commit = (pts: LanePoint[]) => onChange([...pts].sort((a, b) => a.x - b.x));

  /** Filter lanes magnet to 0.5 (= filter off) so a curve can return to
   * exactly neutral. Shift suspends it, like every other snap. */
  const snapValue = (y: number, e: { shiftKey: boolean }) =>
    id.startsWith('filter') && !e.shiftKey && Math.abs(y - 0.5) < 0.08 ? 0.5 : y;

  // The hit div fills the lane rect exactly; the canvas (pointer-events:
  // none) pads past it so edge breakpoints render as full circles floating
  // over the window borders without stealing clicks from neighboring strips.
  return (
    <div
      className="editor-lanehit"
      onPointerDown={(e) => {
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        const hit = pointAt(e);
        if (e.metaKey || e.ctrlKey) {
          // Selection gesture (mix-editor 16): stays a click (toggle the
          // node under the pointer) until it travels — then rubber-band.
          marqueeStart.current = { x: hit.rawX, y: hit.y, cx: e.clientX, cy: e.clientY, armed: false };
        } else if (hit.nearestIndex >= 0 && selectedRef.current.includes(hit.nearestIndex)) {
          // Group drag: any selected node tows the whole selection.
          groupDrag.current = {
            orig: pointsRef.current,
            grab: pointsRef.current[hit.nearestIndex],
          };
        } else if (hit.nearestIndex >= 0) {
          // Grabbing a breakpoint wins over the chop gesture: shift+drag ON
          // a point stays the fine-drag (snap suspended) from issue 09.
          dragIndex.current = hit.nearestIndex;
        } else if (e.shiftKey) {
          // Chop stamp: shift+drag spans a cut, shift+click cuts one beat.
          chopStart.current = hit.x;
          setChopPreview({ x0: snapCutX(hit.x), x1: snapCutX(hit.x) });
        } else if (selectedRef.current.length > 0) {
          // Plain click on empty space while a selection is active:
          // deselect instead of adding (click again to add as usual).
          onSelectedChange([]);
        } else {
          const y = snapValue(hit.y, e);
          const pts = [...pointsRef.current, { x: hit.x, y }].sort((a, b) => a.x - b.x);
          dragIndex.current = pts.findIndex((p) => p.x === hit.x && p.y === y);
          commit(pts);
        }
      }}
      onPointerMove={(e) => {
        const hit = pointAt(e);
        if (marqueeStart.current) {
          const m = marqueeStart.current;
          if (!m.armed && Math.hypot(e.clientX - m.cx, e.clientY - m.cy) >= MARQUEE_CLICK_PX) {
            m.armed = true;
          }
          if (m.armed) {
            const rect: SelectRect = { x0: m.x, y0: m.y, x1: hit.rawX, y1: hit.y };
            setMarquee(rect);
            onSelectedChange(indicesInRect(pointsRef.current, rect));
          }
          return;
        }
        if (groupDrag.current) {
          const { orig, grab } = groupDrag.current;
          onChange(moveGroup(orig, selectedRef.current, hit.x - grab.x, hit.y - grab.y));
          return;
        }
        if (chopStart.current !== null) {
          setChopPreview({ x0: snapCutX(chopStart.current), x1: snapCutX(hit.x) });
          return;
        }
        if (dragIndex.current === null) {
          setHoverIndex(hit.nearestIndex >= 0 ? hit.nearestIndex : null);
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
        if (marqueeStart.current) {
          const m = marqueeStart.current;
          marqueeStart.current = null;
          setMarquee(null);
          if (!m.armed) {
            // Cmd/ctrl+CLICK: toggle the node under the pointer in/out of
            // the selection; on empty space it deselects.
            const hit = pointAt(e);
            onSelectedChange(
              hit.nearestIndex >= 0 ? toggleIndex(selectedRef.current, hit.nearestIndex) : []
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
        dragIndex.current = null;
        chopStart.current = null;
        setChopPreview(null);
        marqueeStart.current = null;
        setMarquee(null);
        groupDrag.current = null;
      }}
      onPointerLeave={() => setHoverIndex(null)}
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
    </div>
  );
}

