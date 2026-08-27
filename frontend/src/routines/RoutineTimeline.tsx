/**
 * Routine editor timeline (gh#170, pass 2): the DAW surface, slot-aware,
 * wearing the PAIR EDITOR'S design language (human directive — reuse over
 * reinvention): flat #0e0e0e lane strips with a 3px lane-color edge and
 * terse labels, the LaneId palette doctrine extended per slot
 * (slotLaneColors), the editor's jump-marker idiom (2px pole + bottom
 * chip + popover), the V2 renderer's hotcue pole+numbered-flag idiom,
 * the pink playhead, inaudible-region dimming.
 *
 * Waveforms render the session-timeline way: each slot's replay trace
 * cuts into linear beat→track runs (routineWaveRuns) and the styled-
 * column interpreter (sets/ladderWaveStyle — the one persisted Waveform
 * style, LOD-correct averaging) draws each run, columns sampled at
 * integer timeline pixels — stable under scroll/zoom. The waveform body
 * is deliberately UNMODULATED by the mixer state — this is an editing
 * surface (the pair editor's posture): level reads on the lane strips.
 *
 * EDITING (pass 2, directive 2): lane strips flip between the recorded
 * step rendering and the pair editor's OWN LaneCanvas (structural reuse —
 * kind semantics via kind-matched LaneIds, slot identity via the color
 * override); authored envelopes live in the RoutineDraftStore (undo/
 * redo/autosave in the shell). Jumps are first-class on EVERY slot:
 * recorded ones can be removed (continuity restored), authored ones
 * added (double-click), dragged, retimed, deleted, and — backward only —
 * given a repeat count (the loop doctrine, CONTEXT.md Jump event).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Track, HotCue } from '../types';
import type { DecodedWaveform } from '../waveform/blob';
import { createStyledColumnRenderer } from '../sets/ladderWaveStyle';
import { useStyleSlot } from '../waveform/styleSlots';
import { cueCssColor } from '../hotcues/palette';
import { ROUTINE_ACCENT } from '../theme/routineColor';
import { LaneCanvas } from '../editor/LaneCanvas';
import type { LaneId, LanePoint } from '../editor/mixModel';
import {
  slotLanesAt,
  type PlannedRoutine,
  type PlannedRoutineSlot,
  type RoutineLanePoint,
} from '../sets/routinePlan';
import type { RoutinePlayer } from './RoutinePlayer';
import type { RoutineDraftStore } from './routineDraftStore';
import type { AuthoredJump, RoutineEdits } from './routineDraft';
import { traceDrawRuns, type BeatRun } from './routineWaveRuns';
import {
  rulerTicks,
  slotColor,
  slotLaneColors,
  SLOT_LANE_LABELS,
  SLOT_LANE_ORDER,
  type SlotLaneControl,
  type EditorRoutine,
  type RecordedJump,
} from './routineEditorModel';

const WAVE_H = 64;
/** Outward-trim drag allowance (beats past either boundary); the server
 * clamps the applied widen to the session slice's extent. */
const TRIM_WIDEN_CAP_BEATS = 128;
const STRIP_H = 22;
const STRIP_H_AUTHORED = 34;
const RULER_H = 24;
const PAD_BEATS = 4;
const MIN_PX_PER_BEAT = 0.05;
const MAX_PX_PER_BEAT = 64;

/** Kind-matched pseudo LaneIds: LaneCanvas keys its NEUTRAL line, fill
 * anchor, shade ramps and filter snap off the id's control prefix — the
 * slot's identity rides the color override instead. */
const CONTROL_LANE_ID: Record<SlotLaneControl, LaneId> = {
  fader: 'faderA',
  eqLow: 'eqLowA',
  eqMid: 'eqMidA',
  eqHigh: 'eqHighA',
  filter: 'filterA',
};

export interface TrimRange {
  startBeat: number;
  endBeat: number;
}

type JumpMarker =
  | { kind: 'authored'; slot: number; jump: AuthoredJump }
  | { kind: 'recorded'; slot: number; beat: number; deltaSec: number }
  | { kind: 'ghost'; slot: number; beat: number };

type PopoverState = { marker: JumpMarker; x: number } | null;

export function RoutineTimeline({
  editor,
  plannedForRuns,
  recordedJumpsBySlot,
  tracks,
  waves,
  hotcues,
  player,
  draftStore,
  edits,
  trim,
  onTrimChange,
  onSeekBeat,
}: {
  editor: EditorRoutine;
  /** The jump-edited build WITHOUT lane edits: its trace identities are
   * shared with editor.planned, so run/waveform memos survive lane drags
   * (the ~60 Hz hot path). */
  plannedForRuns: PlannedRoutine;
  /** Recorded discontinuities from the RAW build (no edits) — marker
   * provenance stays visible even once removed (ghosts). */
  recordedJumpsBySlot: RecordedJump[][];
  tracks: Map<number, Track>;
  waves: Map<number, DecodedWaveform | null>;
  hotcues: Map<number, HotCue[]>;
  player: RoutinePlayer;
  draftStore: RoutineDraftStore;
  edits: RoutineEdits;
  /** Boundary trim (tier 3) — null hides the handles (no origin take). */
  trim: TrimRange | null;
  onTrimChange: ((trim: TrimRange) => void) | null;
  onSeekBeat: (beat: number) => void;
}) {
  const { planned, input } = editor;
  const duration = input.durationBeats;
  const styleSlot = useStyleSlot('full');
  const containerRef = useRef<HTMLDivElement>(null);
  const rowsRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLCanvasElement>(null);
  const waveCanvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const laneCanvasRefs = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const playheadRef = useRef<HTMLDivElement>(null);

  const [width, setWidth] = useState(0);
  const [pxPerBeat, setPxPerBeat] = useState(0);
  const [scrollBeat, setScrollBeat] = useState(-PAD_BEATS);
  const viewRef = useRef({ pxPerBeat: 0, scrollBeat: -PAD_BEATS });
  viewRef.current = { pxPerBeat, scrollBeat };

  // Visible lane strips per slot (the pair editor's lane-toggle idiom;
  // FADER on by default — n slots × 5 strips would drown the rows).
  const [visibleLanes, setVisibleLanes] = useState<Record<number, SlotLaneControl[]>>({});
  const lanesFor = useCallback(
    (slot: number): SlotLaneControl[] => visibleLanes[slot] ?? ['fader'],
    [visibleLanes]
  );
  const toggleLane = useCallback((slot: number, control: SlotLaneControl) => {
    setVisibleLanes((prev) => {
      const cur = prev[slot] ?? ['fader'];
      const next = cur.includes(control)
        ? cur.filter((c) => c !== control)
        : SLOT_LANE_ORDER.filter((c) => cur.includes(c) || c === control);
      return { ...prev, [slot]: next };
    });
  }, []);

  // Lane node selection (the pair editor's per-lane selection, keyed by
  // slot:control).
  const [laneSel, setLaneSel] = useState<{ key: string; indices: number[] } | null>(null);

  // Jump popover (one at a time).
  const [popover, setPopover] = useState<PopoverState>(null);

  // ── Fit / resize ─────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    const w = containerRef.current?.clientWidth ?? 0;
    if (w <= 0 || duration <= 0) return;
    setPxPerBeat(Math.max(MIN_PX_PER_BEAT, w / (duration + PAD_BEATS * 2)));
    setScrollBeat(-PAD_BEATS);
  }, [duration]);
  useEffect(fit, [fit, width === 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const clampScroll = useCallback(
    (s: number, px: number): number => {
      const w = containerRef.current?.clientWidth ?? 0;
      const viewBeats = px > 0 ? w / px : 0;
      // ±TRIM_WIDEN_CAP_BEATS of slack so outward trim handles stay
      // reachable/visible past the routine boundaries.
      const lo = -PAD_BEATS - TRIM_WIDEN_CAP_BEATS;
      const max = Math.max(duration + PAD_BEATS + TRIM_WIDEN_CAP_BEATS - viewBeats, lo);
      return Math.max(lo, Math.min(s, max));
    },
    [duration]
  );

  // ── Wheel: vertical = zoom (cursor-anchored), horizontal = pan ───────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { pxPerBeat: px, scrollBeat: s } = viewRef.current;
      if (px <= 0) return;
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        setScrollBeat(clampScroll(s + e.deltaX / px, px));
      } else {
        const rect = el.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const anchorBeat = s + x / px;
        const next = Math.max(
          MIN_PX_PER_BEAT,
          Math.min(MAX_PX_PER_BEAT, px * Math.exp(-e.deltaY * 0.002))
        );
        setPxPerBeat(next);
        setScrollBeat(clampScroll(anchorBeat - x / next, next));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [clampScroll]);

  // ── LaneCanvas scroll feed (viewport-windowed canvases) ─────────────
  // Content coordinate = beat · pxPerBeat (0 at beat 0); each strip's
  // lane window sits at left = xOf(0), so windowLeftPx = 0 and the view
  // range is [scrollPx, scrollPx + width].
  const scrollFns = useRef<Map<string, (l: number, r: number) => void>>(new Map());
  const registerFns = useRef<Map<string, (id: LaneId, fn: ((l: number, r: number) => void) | null) => void>>(
    new Map()
  );
  const scrollDrawFor = useCallback((key: string) => {
    let fn = registerFns.current.get(key);
    if (!fn) {
      fn = (_id, cb) => {
        if (cb) scrollFns.current.set(key, cb);
        else scrollFns.current.delete(key);
      };
      registerFns.current.set(key, fn);
    }
    return fn;
  }, []);
  useEffect(() => {
    if (pxPerBeat <= 0) return;
    const l = scrollBeat * pxPerBeat;
    for (const fn of scrollFns.current.values()) fn(l, l + width);
  }, [scrollBeat, pxPerBeat, width]);

  // ── Seek scrub ───────────────────────────────────────────────────────
  const scrubbing = useRef(false);
  const seekAtClientX = useCallback(
    (clientX: number) => {
      const el = rowsRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const { pxPerBeat: px, scrollBeat: s } = viewRef.current;
      if (px <= 0) return;
      const beat = s + (clientX - rect.left) / px;
      onSeekBeat(Math.max(0, Math.min(beat, duration)));
    },
    [onSeekBeat, duration]
  );
  const onRowsPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (
        (e.target as HTMLElement).closest(
          '.rt-trimhandle, .rt-jump, .rt-lanetoggles, .rt-lanestrip, .rt-jump-popover, .rt-laneauthor'
        )
      )
        return;
      scrubbing.current = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      seekAtClientX(e.clientX);
      setPopover(null);
    },
    [seekAtClientX]
  );
  const onRowsPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (scrubbing.current) seekAtClientX(e.clientX);
    },
    [seekAtClientX]
  );
  const onRowsPointerUp = useCallback(() => {
    scrubbing.current = false;
  }, []);

  // ── Trim handle drag (tier 3) ────────────────────────────────────────
  const trimDrag = useRef<'start' | 'end' | null>(null);
  const trimRef = useRef(trim);
  trimRef.current = trim;
  const onTrimHandleDown = useCallback(
    (edge: 'start' | 'end') => (e: React.PointerEvent) => {
      if (!onTrimChange) return;
      e.stopPropagation();
      e.preventDefault();
      trimDrag.current = edge;
      // No text selection while dragging (gh#190 item 9).
      const prevUserSelect = document.body.style.userSelect;
      document.body.style.userSelect = 'none';
      const onMove = (ev: PointerEvent) => {
        const el = rowsRef.current;
        const t = trimRef.current;
        if (!el || !t || trimDrag.current === null) return;
        const rect = el.getBoundingClientRect();
        const { pxPerBeat: px, scrollBeat: s } = viewRef.current;
        if (px <= 0) return;
        const beat = s + (ev.clientX - rect.left) / px;
        // Inward AND outward (gh#170 follow-up — the miner under-sizes
        // dwell-shaped windows): boundaries drag past 0/duration to
        // WIDEN, up to a generous margin; the server clamps the applied
        // widen to the origin session slice's real extent. Keep ≥ 8
        // beats between the edges.
        if (trimDrag.current === 'start') {
          const v = Math.max(-TRIM_WIDEN_CAP_BEATS, Math.min(beat, t.endBeat - 8));
          onTrimChange({ ...t, startBeat: v });
        } else {
          const v = Math.min(duration + TRIM_WIDEN_CAP_BEATS, Math.max(beat, t.startBeat + 8));
          onTrimChange({ ...t, endBeat: v });
        }
      };
      const onUp = () => {
        trimDrag.current = null;
        document.body.style.userSelect = prevUserSelect;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [onTrimChange, duration]
  );

  // ── Jump gestures ────────────────────────────────────────────────────
  const jumpDrag = useRef<{ id: string; moved: boolean } | null>(null);
  const onJumpPointerDown = useCallback(
    (marker: JumpMarker) => (e: React.PointerEvent) => {
      e.stopPropagation();
      if (marker.kind !== 'authored') {
        setPopover({ marker, x: (marker.kind === 'recorded' ? marker.beat : marker.beat) });
        return;
      }
      jumpDrag.current = { id: marker.jump.id, moved: false };
      const startClientX = e.clientX;
      const onMove = (ev: PointerEvent) => {
        const el = rowsRef.current;
        const drag = jumpDrag.current;
        if (!el || !drag) return;
        if (!drag.moved && Math.abs(ev.clientX - startClientX) < 3) return;
        drag.moved = true;
        const rect = el.getBoundingClientRect();
        const { pxPerBeat: px, scrollBeat: s } = viewRef.current;
        if (px <= 0) return;
        let beat = s + (ev.clientX - rect.left) / px;
        if (!ev.shiftKey) beat = Math.round(beat); // beat magnet; shift = free
        beat = Math.max(0, Math.min(beat, duration));
        draftStore.updateJump(drag.id, { beat });
      };
      const onUp = () => {
        const drag = jumpDrag.current;
        jumpDrag.current = null;
        draftStore.endGesture();
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        if (drag && !drag.moved) setPopover({ marker, x: marker.jump.beat });
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [draftStore, duration]
  );

  // Add-jump lives on the ROWS container: the scrub's pointer capture
  // retargets the derived dblclick to the container, so a per-row
  // handler never fires — hit-test the wave row under the point instead.
  const plannedRef = useRef(planned);
  plannedRef.current = planned;
  const onRowsDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      const hit = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest('[data-slot]') as HTMLElement | null;
      if (!hit) return;
      const slotIdx = Number(hit.getAttribute('data-slot'));
      const slot = plannedRef.current.slots.find((s) => s.slot === slotIdx);
      if (!slot) return;
      const el = rowsRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const { pxPerBeat: px, scrollBeat: s } = viewRef.current;
      if (px <= 0) return;
      let beat = s + (e.clientX - rect.left) / px;
      if (!e.shiftKey) beat = Math.round(beat);
      beat = Math.max(0, Math.min(beat, duration));
      const track = tracks.get(slot.trackId);
      const trackBpm = track?.bpm ?? null;
      // Default: a 4-track-beat BACKWARD jump — loopable (the pair
      // editor's add-jump posture, loop doctrine ready).
      const deltaSec = trackBpm && trackBpm > 0 ? -4 * (60 / trackBpm) : -2;
      const jump: AuthoredJump = {
        id: `j-${Date.now()}-${slot.slot}-${Math.round(beat * 10)}`,
        slot: slot.slot,
        beat,
        deltaSec,
      };
      draftStore.addJump(jump);
      setPopover({ marker: { kind: 'authored', slot: slot.slot, jump }, x: beat });
    },
    [draftStore, duration, tracks]
  );

  // ── Playhead (rAF-driven; div transform only — the editor's pink) ────
  useEffect(() => {
    let raf = 0;
    let lastPx = NaN;
    const loop = () => {
      const { pxPerBeat: px, scrollBeat: s } = viewRef.current;
      const el = playheadRef.current;
      if (el && px > 0) {
        const x = (player.getBeat() - s) * px;
        if (x !== lastPx) {
          lastPx = x;
          el.style.transform = `translateX(${x.toFixed(1)}px)`;
          el.style.display = x < 0 || x > (containerRef.current?.clientWidth ?? 0) ? 'none' : '';
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [player]);

  // ── Derived render model ─────────────────────────────────────────────
  const gridBeats = useMemo(
    () => rulerTicks(scrollBeat, scrollBeat + (pxPerBeat > 0 ? width / pxPerBeat : 0), pxPerBeat),
    [scrollBeat, pxPerBeat, width]
  );
  // Keyed on the jump-edited base: trace identities survive lane drags.
  const slotRuns = useMemo<BeatRun[][]>(
    () => plannedForRuns.slots.map((slot) => traceDrawRuns(slot.trace, duration)),
    [plannedForRuns, duration]
  );
  const jumpMarkers = useMemo<JumpMarker[][]>(() => {
    return planned.slots.map((slot) => {
      const out: JumpMarker[] = [];
      const removed = edits.removedRecordedJumps.filter((r) => r.slot === slot.slot);
      for (const rj of recordedJumpsBySlot[slot.slot] ?? []) {
        const isRemoved = removed.some((r) => Math.abs(r.beat - rj.beat) < 0.01);
        out.push(
          isRemoved
            ? { kind: 'ghost', slot: slot.slot, beat: rj.beat }
            : { kind: 'recorded', slot: slot.slot, beat: rj.beat, deltaSec: rj.deltaSec }
        );
      }
      for (const j of edits.jumps.filter((j) => j.slot === slot.slot)) {
        out.push({ kind: 'authored', slot: slot.slot, jump: j });
      }
      return out;
    });
  }, [planned, edits, recordedJumpsBySlot]);

  // ── Canvas drawing (waveform rows + ruler) ───────────────────────────
  useEffect(() => {
    if (width <= 0 || pxPerBeat <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    const viewPx = Math.round(scrollBeat * pxPerBeat);
    const xAt = (beat: number) => beat * pxPerBeat - viewPx;

    const ruler = rulerRef.current;
    if (ruler) {
      ruler.width = width * dpr;
      ruler.height = RULER_H * dpr;
      const ctx = ruler.getContext('2d');
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = '#0b0b0b';
        ctx.fillRect(0, 0, width, RULER_H);
        ctx.font = 'bold 10px monospace';
        ctx.textBaseline = 'middle';
        for (const tick of gridBeats) {
          const x = xAt(tick.beat);
          if (x < -24 || x > width + 24) continue;
          ctx.strokeStyle = tick.major ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.12)';
          ctx.beginPath();
          ctx.moveTo(x, tick.major ? 6 : 14);
          ctx.lineTo(x, RULER_H);
          ctx.stroke();
          if (tick.major && tick.label !== undefined) {
            ctx.fillStyle = 'rgba(232,232,240,0.75)';
            ctx.fillText(tick.label, x + 4, 9);
          }
        }
        for (const b of [0, duration]) {
          const x = xAt(b);
          if (x < -2 || x > width + 2) continue;
          ctx.strokeStyle = ROUTINE_ACCENT;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, RULER_H);
          ctx.stroke();
          ctx.lineWidth = 1;
        }
      }
    }

    plannedForRuns.slots.forEach((slot, i) => {
      const canvas = waveCanvasRefs.current[i];
      if (!canvas) return;
      canvas.width = width * dpr;
      canvas.height = WAVE_H * dpr;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#0b0b0b';
      ctx.fillRect(0, 0, width, WAVE_H);
      drawGrid(ctx, gridBeats, xAt, width, WAVE_H);
      const wave = waves.get(slot.trackId) ?? null;
      if (wave) {
        drawSlotWave(ctx, wave, styleSlot.styleId, styleSlot.params, slotRuns[i], {
          xAt,
          width,
          waveH: WAVE_H,
        });
        drawHotCues(ctx, hotcues.get(slot.trackId) ?? [], slotRuns[i], xAt, width, WAVE_H);
      }
      const entryBeat = input.entryOffsetsBeats[slot.slot];
      const ex = xAt(entryBeat);
      if (ex >= -4 && ex <= width + 4) {
        ctx.strokeStyle = slotColor(slot.slot);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(ex, 0);
        ctx.lineTo(ex, WAVE_H);
        ctx.stroke();
        ctx.lineWidth = 1;
        ctx.fillStyle = slotColor(slot.slot);
        ctx.beginPath();
        ctx.moveTo(ex, 2);
        ctx.lineTo(ex + 7, 8);
        ctx.lineTo(ex, 14);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(11,11,11,0.6)';
      const preX = Math.min(width, Math.max(0, ex));
      const zeroX = Math.max(0, xAt(0));
      if (preX > zeroX) ctx.fillRect(zeroX, 0, preX - zeroX, WAVE_H);
      if (xAt(0) > 0) ctx.fillRect(0, 0, Math.min(width, xAt(0)), WAVE_H);
      if (xAt(duration) < width) {
        ctx.fillRect(Math.max(0, xAt(duration)), 0, width - Math.max(0, xAt(duration)), WAVE_H);
      }
    });
  }, [
    width,
    pxPerBeat,
    scrollBeat,
    plannedForRuns,
    input,
    waves,
    hotcues,
    gridBeats,
    duration,
    slotRuns,
    styleSlot,
  ]);

  // ── Recorded-lane strip drawing (non-authored strips only) ───────────
  useEffect(() => {
    if (width <= 0 || pxPerBeat <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    const viewPx = Math.round(scrollBeat * pxPerBeat);
    const xAt = (beat: number) => beat * pxPerBeat - viewPx;
    for (const slot of planned.slots) {
      const colors = slotLaneColors(slot.slot);
      for (const control of lanesFor(slot.slot)) {
        if (slot.lanes.authored?.[control]) continue; // LaneCanvas owns it
        const strip = laneCanvasRefs.current.get(`${slot.slot}:${control}`);
        if (!strip) continue;
        strip.width = width * dpr;
        strip.height = STRIP_H * dpr;
        const ctx = strip.getContext('2d');
        if (!ctx) continue;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = '#0e0e0e';
        ctx.fillRect(0, 0, width, STRIP_H);
        drawGrid(ctx, gridBeats, xAt, width, STRIP_H);
        drawLaneSteps(ctx, slot, control, colors[control], {
          width,
          stripH: STRIP_H,
          scrollBeat,
          pxPerBeat,
          duration,
        });
      }
    }
  }, [width, pxPerBeat, scrollBeat, planned, gridBeats, duration, lanesFor]);

  // ── DOM ──────────────────────────────────────────────────────────────
  const xOf = (beat: number) => (beat - scrollBeat) * pxPerBeat;
  const windowLeft = xOf(0);
  const windowWidth = duration * pxPerBeat;

  // LaneCanvas guides: the beat grid, normalized into the routine window.
  const laneGuides = useMemo(
    () =>
      gridBeats
        .filter((t) => t.beat >= 0 && t.beat <= duration)
        .map((t) => ({ x: duration > 0 ? t.beat / duration : 0, strong: t.major })),
    [gridBeats, duration]
  );

  const authorLane = useCallback(
    (slot: PlannedRoutineSlot, control: SlotLaneControl) => {
      // Seed the envelope FROM the recording (steps → plateau pairs) so
      // authoring starts from what already plays; an unrecorded lane
      // seeds empty (LaneCanvas's click-to-add posture).
      const recorded = slot.lanes.authored?.[control] ? [] : slot.lanes[control];
      const dflt =
        control === 'fader'
          ? slot.lanes.defaults.fader
          : control === 'filter'
            ? slot.lanes.defaults.filter
            : slot.lanes.defaults.eq;
      const env: RoutineLanePoint[] = [];
      if (recorded.length > 0) {
        let last = dflt;
        env.push({ beat: 0, value: dflt });
        for (const p of recorded) {
          if (p.value === last) continue;
          env.push({ beat: p.beat, value: last });
          env.push({ beat: p.beat, value: p.value });
          last = p.value;
        }
      }
      draftStore.setLane(slot.slot, control, env);
      draftStore.endGesture();
    },
    [draftStore]
  );

  const laneCanvasFor = (slot: PlannedRoutineSlot, control: SlotLaneControl, color: string) => {
    const key = `${slot.slot}:${control}`;
    const pts = slot.lanes[control];
    const toLanePoint = (p: RoutineLanePoint): LanePoint => ({
      x: duration > 0 ? p.beat / duration : 0,
      y: control === 'filter' ? (p.value + 1) / 2 : p.value,
    });
    const fromLanePoint = (p: LanePoint): RoutineLanePoint => ({
      beat: p.x * duration,
      value: control === 'filter' ? p.y * 2 - 1 : p.y,
    });
    return (
      <div
        className="rt-lanewindow"
        style={{ left: windowLeft, width: Math.max(windowWidth, 4) }}
        onPointerUpCapture={() => draftStore.endGesture()}
        onPointerCancelCapture={() => draftStore.endGesture()}
      >
        <LaneCanvas
          id={CONTROL_LANE_ID[control]}
          color={color}
          widthPx={Math.max(windowWidth, 4)}
          points={pts.map(toLanePoint)}
          guides={laneGuides}
          chopWall={duration > 0 ? 0.1 / duration : 0.01}
          windowLeftPx={0}
          registerScrollDraw={scrollDrawFor(key)}
          onChange={(next) => draftStore.setLane(slot.slot, control, next.map(fromLanePoint))}
          selected={laneSel?.key === key ? laneSel.indices : NO_SELECTION}
          onSelectedChange={(indices) =>
            setLaneSel(indices.length > 0 ? { key, indices } : null)
          }
        />
      </div>
    );
  };

  return (
    <div className="rt-timeline" ref={containerRef}>
      <div className="rt-toolbar-float">
        <button className="rt-fit" title="Fit the whole Routine" onClick={fit}>
          fit
        </button>
      </div>
      <canvas ref={rulerRef} className="rt-ruler" style={{ height: RULER_H }} />
      <div
        className="rt-rows"
        ref={rowsRef}
        onPointerDown={onRowsPointerDown}
        onPointerMove={onRowsPointerMove}
        onPointerUp={onRowsPointerUp}
        onPointerCancel={onRowsPointerUp}
        onDoubleClick={onRowsDoubleClick}
      >
        {planned.slots.map((slot, i) => {
          const track = tracks.get(slot.trackId);
          const trackBpm = track?.bpm ?? null;
          const colors = slotLaneColors(slot.slot);
          const reused =
            slot.deck !== null &&
            planned.slots.some((o) => o.slot < slot.slot && o.deck === slot.deck);
          return (
            <div className="rt-slotblock" key={slot.slot}>
              <div className="rt-wave-row" data-slot={slot.slot} style={{ height: WAVE_H }}>
                <canvas
                  ref={(el) => {
                    waveCanvasRefs.current[i] = el;
                  }}
                  style={{ height: WAVE_H }}
                />
                {jumpMarkers[i].map((marker, mi) => {
                  const beat = marker.kind === 'authored' ? marker.jump.beat : marker.beat;
                  const x = xOf(beat);
                  if (x < -4 || x > width + 4) return null;
                  const deltaSec =
                    marker.kind === 'authored'
                      ? marker.jump.deltaSec
                      : marker.kind === 'recorded'
                        ? marker.deltaSec
                        : 0;
                  const beats = trackBpm && trackBpm > 0 ? deltaSec / (60 / trackBpm) : null;
                  const repeat =
                    marker.kind === 'authored' && marker.jump.repeat && marker.jump.repeat > 1
                      ? marker.jump.repeat
                      : null;
                  const label =
                    marker.kind === 'ghost'
                      ? '↷ removed'
                      : `${marker.kind === 'authored' ? '✎ ' : '↷ '}${
                          beats !== null
                            ? `${beats >= 0 ? '+' : ''}${beats.toFixed(1)}b`
                            : `${deltaSec >= 0 ? '+' : ''}${deltaSec.toFixed(1)}s`
                        }${repeat ? ` ×${repeat}` : ''}`;
                  return (
                    <div
                      key={`${marker.kind}-${mi}`}
                      className={`rt-jump ${marker.kind}`}
                      style={{
                        transform: `translateX(${x}px)`,
                        borderLeftColor: slotColor(slot.slot),
                      }}
                      title={
                        marker.kind === 'recorded'
                          ? 'Recorded jump (click: inspect/remove)'
                          : marker.kind === 'authored'
                            ? 'Authored jump (drag to move, click to edit)'
                            : 'Removed recorded jump (click to restore)'
                      }
                      onPointerDown={onJumpPointerDown(marker)}
                    >
                      <span className="rt-jump-chip" style={{ background: slotColor(slot.slot) }}>
                        {label}
                      </span>
                    </div>
                  );
                })}
                <div className="rt-slotchip" style={{ borderColor: slotColor(slot.slot) }}>
                  <span className="rt-slotnum" style={{ background: slotColor(slot.slot) }}>
                    {slot.slot}
                  </span>
                  <span className="rt-slottitle">
                    {track?.title || track?.filename || `track ${slot.trackId}`}
                  </span>
                  <span
                    className="rt-slotdeck"
                    title={
                      reused
                        ? 'Deck reused: a finished slot freed it (concurrency allocation, gh#170 pass 2)'
                        : undefined
                    }
                  >
                    {slot.deck ? `deck ${slot.deck}${reused ? ' ↺' : ''}` : 'no deck (overflow)'}
                  </span>
                  {slot.slot === 0 && <span className="rt-boundary-tag">enters with</span>}
                  {slot.slot === planned.slots.length - 1 && (
                    <span className="rt-boundary-tag">exits with</span>
                  )}
                </div>
                <div className="rt-lanetoggles">
                  {SLOT_LANE_ORDER.map((control) => {
                    const on = lanesFor(slot.slot).includes(control);
                    return (
                      <button
                        key={control}
                        className={`rt-lanetoggle${on ? ' on' : ''}`}
                        style={{
                          borderColor: colors[control],
                          color: on ? '#0b0b0b' : colors[control],
                          background: on ? colors[control] : 'transparent',
                        }}
                        title={`${on ? 'Hide' : 'Show'} ${SLOT_LANE_LABELS[control]} lane`}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleLane(slot.slot, control);
                        }}
                      >
                        {SLOT_LANE_LABELS[control][0]}
                      </button>
                    );
                  })}
                </div>
                {/* Jump popover (the pair editor's idiom). */}
                {popover && popover.marker.slot === slot.slot && (
                  <JumpPopover
                    popover={popover}
                    x={xOf(popover.x)}
                    trackBpm={trackBpm}
                    draftStore={draftStore}
                    onClose={() => setPopover(null)}
                  />
                )}
              </div>
              {lanesFor(slot.slot).map((control) => {
                const authored = !!slot.lanes.authored?.[control];
                const h = authored ? STRIP_H_AUTHORED : STRIP_H;
                return (
                  <div className="rt-lanestrip" key={control} style={{ height: h }}>
                    {!authored && (
                      <canvas
                        ref={(el) => {
                          const key = `${slot.slot}:${control}`;
                          if (el) laneCanvasRefs.current.set(key, el);
                          else laneCanvasRefs.current.delete(key);
                        }}
                        style={{ height: STRIP_H }}
                      />
                    )}
                    {authored && laneCanvasFor(slot, control, colors[control])}
                    <span className="rt-laneedge" style={{ background: colors[control] }} />
                    <span className="rt-lanelabel" style={{ color: colors[control] }}>
                      {SLOT_LANE_LABELS[control]}
                      {authored ? ' ✎' : ''}
                    </span>
                    <button
                      className="rt-laneauthor"
                      title={
                        authored
                          ? 'Discard the authored envelope — the recorded lane plays again'
                          : 'Author this lane (seeded from the recording; drag breakpoints, click to add, double-click to delete)'
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        if (authored) draftStore.clearLane(slot.slot, control);
                        else authorLane(slot, control);
                      }}
                    >
                      {authored ? '↺ recorded' : '✎ author'}
                    </button>
                  </div>
                );
              })}
            </div>
          );
        })}
        {[0, duration].map((b, i) => {
          const x = xOf(b);
          if (x < -2 || x > width + 2) return null;
          return (
            <div key={i} className="rt-boundaryline" style={{ transform: `translateX(${x}px)` }}>
              <span className="rt-boundarylabel">{i === 0 ? 'ENTER' : 'EXIT'}</span>
            </div>
          );
        })}
        {trim &&
          onTrimChange &&
          (['start', 'end'] as const).map((edge) => {
            const b = edge === 'start' ? trim.startBeat : trim.endBeat;
            const x = xOf(b);
            if (x < -12 || x > width + 12) return null;
            return (
              <div
                key={edge}
                className="rt-trimhandle"
                style={{ transform: `translateX(${x}px)` }}
                onPointerDown={onTrimHandleDown(edge)}
                title={`Trim ${edge === 'start' ? 'entry' : 'exit'} boundary (drag)`}
              >
                <div className="rt-trimgrip" />
              </div>
            );
          })}
        {trim && (
          <>
            {/* Inward cuts: hatched CUT regions. */}
            {trim.startBeat > 0 && (
              <div
                className="rt-trimshade"
                style={{ left: xOf(0), width: Math.max(0, xOf(trim.startBeat) - xOf(0)) }}
              />
            )}
            {trim.endBeat < duration && (
              <div
                className="rt-trimshade"
                style={{
                  left: xOf(trim.endBeat),
                  width: Math.max(0, xOf(duration) - xOf(trim.endBeat)),
                }}
              />
            )}
            {/* Outward widens (gh#170 follow-up): EXTENSION regions — the
                re-promotion will pull this span in from the session slice
                (server-clamped to its real extent). */}
            {trim.startBeat < 0 && (
              <div
                className="rt-trimextend"
                style={{ left: xOf(trim.startBeat), width: Math.max(0, xOf(0) - xOf(trim.startBeat)) }}
              />
            )}
            {trim.endBeat > duration && (
              <div
                className="rt-trimextend"
                style={{
                  left: xOf(duration),
                  width: Math.max(0, xOf(trim.endBeat) - xOf(duration)),
                }}
              />
            )}
          </>
        )}
        <div className="rt-playhead" ref={playheadRef} />
      </div>
    </div>
  );
}

const NO_SELECTION: number[] = [];

// ── Jump popover ─────────────────────────────────────────────────────────

function JumpPopover({
  popover,
  x,
  trackBpm,
  draftStore,
  onClose,
}: {
  popover: NonNullable<PopoverState>;
  x: number;
  trackBpm: number | null;
  draftStore: RoutineDraftStore;
  onClose: () => void;
}) {
  const m = popover.marker;
  const beatLen = trackBpm && trackBpm > 0 ? 60 / trackBpm : null;
  if (m.kind === 'ghost') {
    return (
      <div className="rt-jump-popover" style={{ left: Math.max(0, x - 40) }}>
        <span>removed recorded jump</span>
        <button
          onClick={() => {
            draftStore.restoreRecordedJump(m.slot, m.beat);
            onClose();
          }}
        >
          restore
        </button>
        <button onClick={onClose}>✕</button>
      </div>
    );
  }
  if (m.kind === 'recorded') {
    const beats = beatLen ? m.deltaSec / beatLen : null;
    return (
      <div className="rt-jump-popover" style={{ left: Math.max(0, x - 40) }}>
        <span>
          recorded Δ {beats !== null ? `${beats.toFixed(1)}b` : `${m.deltaSec.toFixed(2)}s`}
        </span>
        <button
          className="rt-jump-delete"
          title="Remove this recorded discontinuity — replay restores continuity through it"
          onClick={() => {
            draftStore.removeRecordedJump(m.slot, m.beat);
            onClose();
          }}
        >
          remove
        </button>
        <button onClick={onClose}>✕</button>
      </div>
    );
  }
  const j = m.jump;
  const beats = beatLen ? j.deltaSec / beatLen : j.deltaSec;
  return (
    <div className="rt-jump-popover" style={{ left: Math.max(0, x - 60) }}>
      <label>
        Δ
        <input
          type="number"
          step={1}
          value={Number(beats.toFixed(1))}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (!Number.isFinite(v)) return;
            draftStore.updateJump(j.id, { deltaSec: beatLen ? v * beatLen : v });
          }}
          onBlur={() => draftStore.endGesture()}
        />
        {beatLen ? 'beats' : 's'}
      </label>
      {j.deltaSec < 0 && (
        <label title="Loop doctrine: a backward jump repeated k times recurs at its own displacement's period">
          ×
          <input
            type="number"
            min={1}
            max={64}
            step={1}
            value={j.repeat ?? 1}
            onChange={(e) => {
              const v = Math.floor(Number(e.target.value));
              if (!Number.isFinite(v) || v < 1) return;
              draftStore.updateJump(j.id, { repeat: v > 1 ? v : undefined });
            }}
            onBlur={() => draftStore.endGesture()}
          />
        </label>
      )}
      <button
        className="rt-jump-delete"
        onClick={() => {
          draftStore.removeJump(j.id);
          onClose();
        }}
      >
        delete
      </button>
      <button onClick={onClose}>✕</button>
    </div>
  );
}

// ── Canvas helpers (module-local; pure drawing) ──────────────────────────

function drawGrid(
  ctx: CanvasRenderingContext2D,
  ticks: { beat: number; major: boolean }[],
  xAt: (beat: number) => number,
  width: number,
  height: number
): void {
  for (const tick of ticks) {
    const x = xAt(tick.beat);
    if (x < 0 || x > width) continue;
    ctx.strokeStyle = tick.major ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.04)';
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
}

/** Styled-run waveform pass (the session timeline's drawStyledRuns,
 * beat-axis flavor): per run, columns sample the run's LINEAR beat→track
 * mapping at integer timeline pixels — LOD-correct and scroll-stable. */
function drawSlotWave(
  ctx: CanvasRenderingContext2D,
  wave: DecodedWaveform,
  styleId: string,
  params: import('../waveform/styles').StyleParams,
  runs: BeatRun[],
  geo: { xAt: (beat: number) => number; width: number; waveH: number }
): void {
  const midY = geo.waveH / 2;
  const halfH = geo.waveH / 2 - 2;
  const renderer = createStyledColumnRenderer(wave, styleId, params);
  for (const run of runs) {
    const rx0 = geo.xAt(run.b0);
    const rx1 = geo.xAt(run.b1);
    if (rx1 <= rx0) continue;
    const cx0 = Math.max(rx0, 0);
    const cx1 = Math.min(rx1, geo.width);
    if (cx1 <= cx0) continue;
    const phA = run.ph0 + ((cx0 - rx0) / (rx1 - rx0)) * (run.ph1 - run.ph0);
    const phB = run.ph0 + ((cx1 - rx0) / (rx1 - rx0)) * (run.ph1 - run.ph0);
    const xStart = Math.round(cx0);
    const cols = Math.round(cx1) - xStart;
    if (cols <= 0) continue;
    const columns = renderer.render(phA, phB, cols, 1);
    for (let x = 0; x < cols; x++) {
      const col = columns[x];
      if (col.outOfTrack) continue;
      for (const seg of col.segments) {
        ctx.fillStyle = seg.css;
        const y0 = seg.y0 * halfH;
        const y1 = seg.y1 * halfH;
        ctx.fillRect(xStart + x, midY - y1, 1, y1 - y0);
        ctx.fillRect(xStart + x, midY + y0, 1, y1 - y0);
      }
    }
  }
}

/** Hotcue poles + numbered flags — the V2 renderer's exact idiom (2px
 * full-height pole, numbered square flag off the pole's right at the top
 * edge). A cue draws once per run whose track range contains it. */
function drawHotCues(
  ctx: CanvasRenderingContext2D,
  cues: HotCue[],
  runs: BeatRun[],
  xAt: (beat: number) => number,
  width: number,
  waveH: number
): void {
  if (cues.length === 0) return;
  ctx.font = 'bold 10px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const flag = 13;
  for (const run of runs) {
    const lo = Math.min(run.ph0, run.ph1);
    const hi = Math.max(run.ph0, run.ph1);
    if (hi <= lo) continue;
    const rx0 = xAt(run.b0);
    const rx1 = xAt(run.b1);
    for (const cue of cues) {
      const t = cue.time_seconds;
      if (t < lo || t > hi) continue;
      const f = (t - run.ph0) / (run.ph1 - run.ph0);
      const x = rx0 + f * (rx1 - rx0);
      if (x < -2 || x > width + 2) continue;
      const color = cueCssColor(cue.slot_number, cue.color);
      ctx.fillStyle = color;
      ctx.fillRect(x - 1, 0, 2, waveH);
      ctx.fillRect(x + 1, 0, flag, flag);
      ctx.fillStyle = 'rgb(17,17,17)';
      ctx.fillText(String(cue.slot_number), x + 1 + flag / 2, flag / 2 + 0.5);
    }
  }
  ctx.textAlign = 'left';
}

/** Recorded lane steps in the editor's strip geometry: a step polyline in
 * the lane's color over the flat strip; the default renders dim when
 * nothing was recorded (the lane plays its default). */
function drawLaneSteps(
  ctx: CanvasRenderingContext2D,
  slot: PlannedRoutineSlot,
  control: SlotLaneControl,
  color: string,
  geo: {
    width: number;
    stripH: number;
    scrollBeat: number;
    pxPerBeat: number;
    duration: number;
  }
): void {
  const points = control === 'filter' ? slot.lanes.filter : slot.lanes[control];
  const recorded = points.length > 0;
  ctx.strokeStyle = color;
  ctx.globalAlpha = recorded ? 0.95 : 0.28;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  let pen = false;
  for (let x = 0; x < geo.width; x++) {
    const beat = geo.scrollBeat + (x + 0.5) / geo.pxPerBeat;
    if (beat < 0 || beat > geo.duration) {
      pen = false;
      continue;
    }
    const lanes = slotLanesAt(slot, beat);
    const v =
      control === 'fader'
        ? lanes.fader
        : control === 'filter'
          ? (lanes.filter + 1) / 2
          : lanes.eq[control === 'eqLow' ? 'low' : control === 'eqMid' ? 'mid' : 'high'];
    const y = geo.stripH - 2 - v * (geo.stripH - 4);
    if (!pen) {
      ctx.moveTo(x, y);
      pen = true;
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}
