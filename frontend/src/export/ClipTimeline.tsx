/**
 * Clip editor timeline (#377 r3): the whole source on one canvas — per-deck
 * presence envelopes (post-fader level), drops, 16-bar phrase ticks of the
 * dominant track, the visualizer cues as flags, the clip's in/out handles
 * and the preview playhead. Drag a handle to trim, drag a flag to move a
 * cue, click/drag anywhere else to scrub. Wheel / pinch zooms around the
 * pointer, horizontal wheel or shift+wheel pans, double-click shows all.
 */
import { useEffect, useRef, useState } from 'react';
import type { PlannedRoutine, RoutineDeck } from '../sets/routinePlan';
import { DECK_COLORS } from '../theme/deckColors';
import { ROUTINE_ACCENT } from '../theme/routineColor';
import { CRUST, DANGER, FONT_MONO, OVERLAY0, PLAYHEAD, SUBTEXT0, SURFACE0, TEXT, VOID } from '../theme/tokens';
import type { ClipMetric } from './clipMetric';
import { holdSpan, transitionBadge, type VizCue } from './clipSpec';
import { EXPORT_PRESETS } from './offlineVisualizer';
import { sceneDecks } from './routineVideoScene';

interface Props {
  routine: PlannedRoutine;
  full: { startSec: number; endSec: number };
  range: { startSec: number; endSec: number };
  t: number;
  metric: ClipMetric | null;
  /** Progressive render: mix second rendered so far (null = complete). */
  readyUntil?: number | null;
  /** Clip-relative cue seconds. */
  cues: VizCue[];
  /** Default crossfade length (cues without their own). */
  crossfadeSec: number;
  selectedCue: number | null;
  onSeek: (t: number) => void;
  onRange: (range: { startSec: number; endSec: number }) => void;
  onCueMove: (index: number, atSec: number) => void;
  onCueSelect: (index: number | null) => void;
}

const RULER_H = 18;
const FLAG_H = 26;
const LANE_H = 16;
const PAD_X = 12;
const HANDLE_HIT = 8;
const MIN_VIEW_SEC = 6;
/** Ruler step: the smallest of these leaving ≥ 60 px between labels. */
const RULER_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300];

const presetName = (id: string): string => EXPORT_PRESETS.find((p) => p.id === id)?.name ?? id;

/** Held-segment colors per transition kind. */
const HOLD_COLORS: Record<string, string> = { blackout: '#ffffff', solo: '#00e5ff', blast: '#ff00ff', vfx: '#ffea00' };

export function ClipTimeline(props: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef(props);
  useEffect(() => { propsRef.current = props; });
  const decks = sceneDecks(props.routine);
  const height = RULER_H + FLAG_H + decks.length * (LANE_H + 4) + 14;
  const dragRef = useRef<{ kind: 'in' | 'out' | 'cue' | 'seek'; cue?: number } | null>(null);
  // Visible window (null = the whole source).
  const [view, setView] = useState<{ startSec: number; endSec: number } | null>(null);
  const viewRef = useRef(view);
  useEffect(() => { viewRef.current = view; });
  const clampView = (v: { startSec: number; endSec: number }, full = propsRef.current.full) => {
    const fullSpan = full.endSec - full.startSec;
    const span = Math.max(MIN_VIEW_SEC, Math.min(fullSpan, v.endSec - v.startSec));
    if (span >= fullSpan - 1e-3) return null;
    const start = Math.max(full.startSec, Math.min(full.endSec - span, v.startSec));
    return { startSec: start, endSec: start + span };
  };

  // Geometry helpers bound to the current width and view.
  const geom = (w: number) => {
    const { full } = propsRef.current;
    const v = viewRef.current ?? full;
    const span = Math.max(1, v.endSec - v.startSec);
    const xOf = (sec: number) => PAD_X + ((sec - v.startSec) / span) * (w - PAD_X * 2);
    const secOf = (x: number) => v.startSec + ((x - PAD_X) / (w - PAD_X * 2)) * span;
    return { xOf, secOf };
  };

  // Keep the playhead in view: page forward when it runs off the edge
  // (adjusted during render when t changes, not in an effect).
  const [followT, setFollowT] = useState(props.t);
  if (props.t !== followT) {
    setFollowT(props.t);
    if (view && (props.t > view.endSec || props.t < view.startSec)) {
      const span = view.endSec - view.startSec;
      setView(clampView({ startSec: props.t - span * 0.1, endSec: props.t + span * 0.9 }, props.full));
    }
  }

  // Wheel: zoom (vertical / pinch) around the pointer, pan (horizontal / shift).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { full } = propsRef.current;
      const v = viewRef.current ?? full;
      const span = v.endSec - v.startSec;
      const w = canvas.clientWidth;
      const pan = e.shiftKey ? e.deltaY || e.deltaX : Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : 0;
      if (pan) {
        setView(clampView({ startSec: v.startSec + (pan / w) * span, endSec: v.endSec + (pan / w) * span }));
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const k = Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.002));
      const at = v.startSec + ((e.clientX - rect.left - PAD_X) / (w - PAD_X * 2)) * span;
      setView(clampView({ startSec: at - (at - v.startSec) * k, endSec: at + (v.endSec - at) * k }));
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  // Paint
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(height * dpr);
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const { routine, full, range, t, metric, cues, selectedCue } = props;
    const { xOf, secOf } = geom(w);
    const v = view ?? full;
    ctx.fillStyle = CRUST;
    ctx.fillRect(0, 0, w, height);
    ctx.font = `11px ${FONT_MONO}`;
    ctx.textBaseline = 'middle';
    // Ruler
    ctx.fillStyle = OVERLAY0;
    const pxPerSec = (w - PAD_X * 2) / Math.max(1, v.endSec - v.startSec);
    const step = RULER_STEPS.find((x) => x * pxPerSec >= 60) ?? 600;
    const s0 = full.startSec + Math.ceil((v.startSec - full.startSec) / step) * step;
    for (let s = s0; s <= v.endSec; s += step) {
      const x = Math.round(xOf(s));
      ctx.fillRect(x, RULER_H - 6, 1, 6);
      const rel = s - full.startSec;
      ctx.fillText(`${Math.floor(rel / 60)}:${String(Math.round(rel % 60)).padStart(2, '0')}`, x + 3, RULER_H / 2);
    }
    // Deck presence lanes
    const lanesY = RULER_H + FLAG_H;
    decks.forEach((deck: RoutineDeck, di) => {
      const y = lanesY + di * (LANE_H + 4);
      ctx.fillStyle = VOID;
      ctx.fillRect(PAD_X, y, w - PAD_X * 2, LANE_H);
      ctx.fillStyle = DECK_COLORS[deck];
      for (let x = PAD_X; x < w - PAD_X; x++) {
        const sec = secOf(x);
        let lv = 0;
        routine.slots.forEach((s, i) => {
          if (s.deck !== deck || sec < s.occupyFromMixSec) return;
          lv = Math.max(lv, metric ? metric.levelAt(i, sec) : 0);
        });
        if (lv <= 0.02) continue;
        const hh = Math.max(1, lv * LANE_H);
        ctx.globalAlpha = 0.35 + 0.65 * lv;
        ctx.fillRect(x, y + (LANE_H - hh) / 2, 1, hh);
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = SUBTEXT0;
      ctx.fillText(deck, 1, y + LANE_H / 2);
    });
    const lanesBottom = lanesY + decks.length * (LANE_H + 4);
    ctx.save();
    ctx.beginPath();
    ctx.rect(PAD_X - 6, 0, w - PAD_X * 2 + 12, height);
    ctx.clip();
    // Hypermeter: dominant 16-bar phrases (faint), drops (danger)
    for (const e of metric?.events ?? []) {
      const x = Math.round(xOf(e.t));
      if (e.drop) {
        ctx.fillStyle = DANGER;
        ctx.fillRect(x, RULER_H, 2, lanesBottom - RULER_H);
        ctx.beginPath();
        ctx.moveTo(x - 5, RULER_H);
        ctx.lineTo(x + 6, RULER_H);
        ctx.lineTo(x + 1, RULER_H + 7);
        ctx.fill();
      } else if (e.dominant && e.tier >= 4) {
        ctx.fillStyle = SURFACE0;
        ctx.fillRect(x, lanesY - 4, 1, lanesBottom - lanesY + 4);
      }
    }
    // Out-of-clip shade
    ctx.fillStyle = CRUST;
    ctx.globalAlpha = 0.7;
    ctx.fillRect(0, RULER_H, xOf(range.startSec), height - RULER_H);
    ctx.fillRect(xOf(range.endSec), RULER_H, w - xOf(range.endSec), height - RULER_H);
    ctx.globalAlpha = 1;
    // In/out handles
    for (const sec of [range.startSec, range.endSec]) {
      const x = Math.round(xOf(sec));
      ctx.fillStyle = ROUTINE_ACCENT;
      ctx.fillRect(x - 1, RULER_H, 3, height - RULER_H);
      ctx.fillRect(x - 4, height - 12, 9, 12);
    }
    // Transitions: crossfade ramps and held segments under the flags
    const segY = RULER_H + 17;
    const segH = FLAG_H - 19;
    cues.forEach((c, i) => {
      if (i === 0) return;
      const x0 = xOf(range.startSec + c.atSec);
      const tr = c.transition;
      if (!tr || tr.kind === 'crossfade') {
        const fade = tr?.durationSec ?? props.crossfadeSec;
        if (fade <= 0 || cues[i - 1]?.presetId === c.presetId) return;
        const x1 = xOf(range.startSec + c.atSec + fade);
        ctx.fillStyle = ROUTINE_ACCENT;
        ctx.globalAlpha = 0.45;
        ctx.beginPath();
        ctx.moveTo(x0, segY + segH);
        ctx.lineTo(x1, segY);
        ctx.lineTo(x1, segY + segH);
        ctx.fill();
        ctx.globalAlpha = 1;
        return;
      }
      const h = holdSpan(c);
      if (!h) return;
      const hx0 = xOf(range.startSec + h.startSec);
      const hx1 = xOf(range.startSec + h.endSec);
      const color = tr.kind === 'solo' && tr.deck ? DECK_COLORS[tr.deck] : HOLD_COLORS[tr.kind];
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(hx0, segY, Math.max(2, hx1 - hx0), segH);
      ctx.globalAlpha = 1;
      const label = transitionBadge(tr);
      if (hx1 - hx0 > ctx.measureText(label).width + 4) {
        ctx.fillStyle = CRUST;
        ctx.font = `9px ${FONT_MONO}`;
        ctx.fillText(label, hx0 + 2, segY + segH / 2);
        ctx.font = `11px ${FONT_MONO}`;
      }
    });
    // Cue flags
    cues.forEach((c, i) => {
      const x = Math.round(xOf(range.startSec + c.atSec));
      const sel = i === selectedCue;
      const impactOnly = i > 0 && cues[i - 1]?.presetId === c.presetId;
      ctx.fillStyle = sel ? TEXT : impactOnly ? OVERLAY0 : ROUTINE_ACCENT;
      ctx.fillRect(x, RULER_H + 2, 1, FLAG_H - 2 + (lanesBottom - lanesY));
      if (impactOnly && !(c.look && Object.keys(c.look).length > 0)) {
        ctx.beginPath();
        ctx.arc(x, RULER_H + 8, 3, 0, Math.PI * 2);
        ctx.fill();
        return;
      }
      const hasLook = !!c.look && Object.keys(c.look).length > 0;
      const label = `${hasLook ? '◆ ' : ''}${presetName(c.presetId)}`;
      const lw = ctx.measureText(label).width + 8;
      ctx.fillRect(x, RULER_H + 2, lw, 14);
      ctx.fillStyle = CRUST;
      ctx.fillText(label, x + 4, RULER_H + 9);
    });
    // Not yet rendered (progressive preview)
    if (props.readyUntil != null && props.readyUntil < full.endSec) {
      const rx = Math.max(PAD_X, xOf(props.readyUntil));
      ctx.fillStyle = CRUST;
      ctx.globalAlpha = 0.55;
      ctx.fillRect(rx, RULER_H, w - rx, height - RULER_H);
      ctx.globalAlpha = 1;
      ctx.fillStyle = OVERLAY0;
      ctx.fillText('rendering…', rx + 6, RULER_H + FLAG_H + 8);
    }
    // Playhead
    ctx.fillStyle = PLAYHEAD;
    ctx.fillRect(Math.round(xOf(t)) - 1, 0, 2, height);
    ctx.restore();
    // Zoomed: where the view sits in the source.
    if (view) {
      const span = full.endSec - full.startSec;
      const bx = PAD_X + ((view.startSec - full.startSec) / span) * (w - PAD_X * 2);
      const bw = Math.max(6, ((view.endSec - view.startSec) / span) * (w - PAD_X * 2));
      ctx.fillStyle = SURFACE0;
      ctx.fillRect(PAD_X, height - 3, w - PAD_X * 2, 3);
      ctx.fillStyle = ROUTINE_ACCENT;
      ctx.fillRect(bx, height - 3, bw, 3);
    }
  });

  const hit = (x: number, y: number) => {
    const canvas = canvasRef.current!;
    const { xOf } = geom(canvas.clientWidth);
    const { range, cues } = propsRef.current;
    if (Math.abs(x - xOf(range.startSec)) <= HANDLE_HIT) return { kind: 'in' as const };
    if (Math.abs(x - xOf(range.endSec)) <= HANDLE_HIT) return { kind: 'out' as const };
    if (y >= RULER_H && y <= RULER_H + FLAG_H) {
      for (let i = cues.length - 1; i >= 0; i--) {
        const cx = xOf(range.startSec + cues[i].atSec);
        if (x >= cx - 4 && x <= cx + 60) return { kind: 'cue' as const, cue: i };
      }
    }
    return { kind: 'seek' as const };
  };

  const onPointer = (e: React.PointerEvent<HTMLCanvasElement>, phase: 'down' | 'move' | 'up') => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const { secOf } = geom(canvas.clientWidth);
    const p = propsRef.current;
    const sec = Math.max(p.full.startSec, Math.min(p.full.endSec, secOf(x)));
    if (phase === 'down') {
      canvas.setPointerCapture(e.pointerId);
      const h = hit(x, y);
      dragRef.current = h;
      if (h.kind === 'cue') p.onCueSelect(h.cue ?? null);
      if (h.kind === 'seek') p.onSeek(Math.max(p.range.startSec, Math.min(p.range.endSec, sec)));
      return;
    }
    if (phase === 'up') {
      dragRef.current = null;
      return;
    }
    const d = dragRef.current;
    if (!d) {
      const h = hit(x, y);
      canvas.style.cursor = h.kind === 'in' || h.kind === 'out' ? 'ew-resize' : h.kind === 'cue' ? 'grab' : 'pointer';
      return;
    }
    if (d.kind === 'in') p.onRange({ startSec: Math.min(sec, p.range.endSec - 2), endSec: p.range.endSec });
    else if (d.kind === 'out') p.onRange({ startSec: p.range.startSec, endSec: Math.max(sec, p.range.startSec + 2) });
    else if (d.kind === 'cue' && d.cue !== undefined && d.cue > 0) p.onCueMove(d.cue, Math.max(0.1, sec - p.range.startSec));
    else if (d.kind === 'seek') p.onSeek(Math.max(p.range.startSec, Math.min(p.range.endSec, sec)));
  };

  return (
    <canvas
      ref={canvasRef}
      className="ce-timeline"
      style={{ height }}
      onPointerDown={(e) => onPointer(e, 'down')}
      onPointerMove={(e) => onPointer(e, 'move')}
      onPointerUp={(e) => onPointer(e, 'up')}
      onDoubleClick={() => setView(null)}
      title="wheel / pinch: zoom · shift+wheel: pan · double-click: show all"
    />
  );
}
