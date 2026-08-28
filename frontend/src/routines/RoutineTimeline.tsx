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
 * is MODULATED by the slot's lane state (gh#190 item 11 — parity with
 * the session timeline and the set ladder): each column renders through
 * fader gain + EQ band gains via the shared ColumnModulation contract
 * (filter excluded, matching both surfaces' control-lane choice).
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
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Track, HotCue } from '../types';
import type { DecodedWaveform } from '../waveform/blob';
import { createStyledColumnRenderer, type ColumnModulation } from '../sets/ladderWaveStyle';
import { channelFaderToGain, trimToGain } from '../playback/mixerMath';
import { eqValueToGain } from '../playback/graph';
import { useStyleSlot } from '../waveform/styleSlots';
import { cueCssColor } from '../hotcues/palette';
import { ROUTINE_ACCENT } from '../theme/routineColor';
import {
  GUIDE_TIER_ALPHA,
  GUIDE_TIER_WIDTH,
  LaneCanvas,
  type LaneGuide,
} from '../editor/LaneCanvas';
import { engineIdToOpenKey } from '../utils/keyUtils';
import { getBpmColor, getKeyColor } from '../utils/displayColors';
import { Knob } from '../components/performance/MixerStrip';
import { TIER_ALPHA, TIER_WIDTH } from '../waveform/WaveformRendererV2';
import type { LaneId, LanePoint } from '../editor/mixModel';
import {
  slotLanesAt,
  traceStateAt,
  type PlannedRoutine,
  type PlannedRoutineSlot,
  type RoutineLanePoint,
} from '../sets/routinePlan';
import { AUDITION_MARGIN_BEATS, type RoutinePlayer } from './RoutinePlayer';
import type { RoutineDraftStore } from './routineDraftStore';
import type { AuthoredJump, AuthoredPause, RoutineEdits } from './routineDraft';
import { traceDrawRuns, type BeatRun } from './routineWaveRuns';
import type { EditorMode } from './editorMode';
import {
  buildGlobalLadder,
  FILTER_LPF_COLOR,
  gridTicks,
  ladderBaseTier,
  ROUTINE_TIER_BARS,
  rulerTicks,
  slotAccent,
  slotDownbeatMarks,
  slotLadderMarks,
  type SlotLadderMarks,
  type TrackMeter,
  slotLaneColors,
  SLOT_LANE_LABELS,
  SLOT_LANE_ORDER,
  type SlotLaneControl,
  type EditorRoutine,
  type RecordedJump,
  type RecordedPause,
} from './routineEditorModel';

const WAVE_H = 64;
/** Outward-trim drag allowance (beats past either boundary); the server
 * clamps the applied widen to the session slice's extent. */
const TRIM_WIDEN_CAP_BEATS = 128;
const STRIP_H = 22;
/** Editing wants room for breakpoints (gh#190 iteration: taller). */
const STRIP_H_AUTHORED = 56;
const RULER_H = 24;
const PAD_BEATS = 4;
const MIN_PX_PER_BEAT = 0.05;
const MAX_PX_PER_BEAT = 64;

/** Kind-matched pseudo LaneIds: LaneCanvas keys its NEUTRAL line, fill
 * anchor, shade ramps and filter snap off the id's control prefix — the
 * slot's identity rides the color override instead. */
/** Lanes shown before any toggling (gh#190 item 4). */
const DEFAULT_LANES: SlotLaneControl[] = ['fader', 'eqLow', 'filter'];

/** Display-normalizer twin of waveformLanes' NOMINAL_STRIP_GAIN: full
 * fader at nominal trim renders unmodified. */
const NOMINAL_SLOT_GAIN = channelFaderToGain(1) * trimToGain(0.5);

/** TRIM is recorded-only (the knob offsets it) — no LaneCanvas id. */
type AuthorableLaneControl = Exclude<SlotLaneControl, 'trim'>;
const CONTROL_LANE_ID: Record<AuthorableLaneControl, LaneId> = {
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
  | { kind: 'authored'; slotId: string; jump: AuthoredJump }
  | { kind: 'recorded'; slotId: string; beat: number; deltaSec: number }
  | { kind: 'ghost'; slotId: string; beat: number }
  // Play/pause events (gh#190): first-class like jumps.
  | { kind: 'authored-pause'; slotId: string; pause: AuthoredPause }
  | { kind: 'recorded-pause'; slotId: string; beat: number; endBeat: number }
  | { kind: 'ghost-pause'; slotId: string; beat: number; endBeat: number };

function markerBeat(m: JumpMarker): number {
  return m.kind === 'authored' ? m.jump.beat : m.kind === 'authored-pause' ? m.pause.beat : m.beat;
}

type PopoverState = { marker: JumpMarker; x: number } | null;

export function RoutineTimeline({
  editor,
  plannedForRuns,
  recordedJumpsBySlot,
  recordedPausesBySlot,
  tracks,
  waves,
  meters,
  hotcues,
  player,
  draftStore,
  edits,
  trim,
  onTrimChange,
  onSeekBeat,
  mode,
  onModeHome,
}: {
  editor: EditorRoutine;
  /** The jump-edited build WITHOUT lane edits: its trace identities are
   * shared with editor.planned, so run/waveform memos survive lane drags
   * (the ~60 Hz hot path). */
  plannedForRuns: PlannedRoutine;
  /** Recorded discontinuities from the RAW build (no edits), keyed by
   * slotId — marker provenance stays visible even once removed
   * (ghosts). */
  recordedJumpsBySlot: Record<string, RecordedJump[]>;
  /** Recorded interior HOLDS from the RAW build (gh#190 play/pause). */
  recordedPausesBySlot: Record<string, RecordedPause[]>;
  tracks: Map<number, Track>;
  waves: Map<number, DecodedWaveform | null>;
  /** Per-track resolved Metric ladders (gh#190 iteration): each slot row
   * grids on its OWN track's ladder — Reset marks applied — projected
   * through the replay trace; null = gridless (routine-clock fallback). */
  meters: Map<number, TrackMeter | null>;
  hotcues: Map<number, HotCue[]>;
  player: RoutinePlayer;
  draftStore: RoutineDraftStore;
  edits: RoutineEdits;
  /** Boundary trim (tier 3) — null hides the handles (no origin take). */
  trim: TrimRange | null;
  onTrimChange: ((trim: TrimRange) => void) | null;
  onSeekBeat: (beat: number) => void;
  /** Modal editing (ADR 0038, gh#207): gates timeline-canvas pointer
   * gestures. Chrome (popovers, lane strips, markers) stays always-live. */
  mode: EditorMode;
  /** Two-tier Escape's second tier: snap home to select. */
  onModeHome: () => void;
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
  // FADER + LOW + FILTER on by default, gh#190 item 4 — the three lanes
  // that carry most transitions; all 5 per slot would drown the rows).
  const [visibleLanes, setVisibleLanes] = useState<Record<string, SlotLaneControl[]>>({});
  const lanesFor = useCallback(
    (slotId: string): SlotLaneControl[] => visibleLanes[slotId] ?? DEFAULT_LANES,
    [visibleLanes]
  );
  const toggleLane = useCallback((slotId: string, control: SlotLaneControl) => {
    setVisibleLanes((prev) => {
      const cur = prev[slotId] ?? DEFAULT_LANES;
      const next = cur.includes(control)
        ? cur.filter((c) => c !== control)
        : SLOT_LANE_ORDER.filter((c) => cur.includes(c) || c === control);
      return { ...prev, [slotId]: next };
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

  // ── Wheel: pinch = zoom (cursor-anchored), horizontal = pan, plain
  // vertical = NATIVE vertical scroll (gh#190 iteration — rows overflow
  // now; trackpad pinch arrives as a ctrlKey wheel). In PAN mode plain
  // vertical wheel zooms instead (gh#207 review feedback) — pan drag
  // owns vertical motion there.
  const modeRef = useRef(mode);
  modeRef.current = mode;
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const { pxPerBeat: px, scrollBeat: s } = viewRef.current;
      if (px <= 0) return;
      const panZoom =
        modeRef.current === 'pan' && Math.abs(e.deltaY) >= Math.abs(e.deltaX);
      if (e.ctrlKey || e.metaKey || panZoom) {
        // Pinch-zoom (or ctrl/cmd+wheel), anchored under the cursor.
        e.preventDefault();
        const rect = el.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const anchorBeat = s + x / px;
        const next = Math.max(
          MIN_PX_PER_BEAT,
          Math.min(MAX_PX_PER_BEAT, px * Math.exp(-e.deltaY * 0.01))
        );
        setPxPerBeat(next);
        setScrollBeat(clampScroll(anchorBeat - x / next, next));
        return;
      }
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault();
        setScrollBeat(clampScroll(s + e.deltaX / px, px));
        return;
      }
      // Plain vertical: fall through to the container's own overflow-y
      // scrolling (no preventDefault).
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
    // Snapped origin — the canvases' own geometry (scroll-lock fix).
    const l = Math.round(scrollBeat * pxPerBeat);
    for (const fn of scrollFns.current.values()) fn(l, l + width);
  }, [scrollBeat, pxPerBeat, width]);

  // ── Slot selection + beat-aligned track drag (gh#190) ────────────────
  // Cmd/ctrl-click toggles a slot; shift-click extends a range from the
  // anchor. Dragging a SELECTED wave row slides every selected slot's
  // track under the routine clock (the transition editor's clip-drag
  // feel), snapped to the smallest VISIBLE beat line — shift = fine.
  // The slide writes the same draft nudges as the chip control (one undo
  // entry per drag).
  const [selectedSlots, setSelectedSlots] = useState<string[]>([]);
  const selAnchor = useRef<string | null>(null);
  const editsRef = useRef(edits);
  editsRef.current = edits;
  // Two-tier Escape (ADR 0038): clear transient state first — popover,
  // then lane-node selection, then slot selection — and only with nothing
  // transient left, snap the mode home to select.
  const transientRef = useRef({ popover, laneSel, selectedSlots });
  transientRef.current = { popover, laneSel, selectedSlots };
  const onModeHomeRef = useRef(onModeHome);
  onModeHomeRef.current = onModeHome;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const t = transientRef.current;
      if (t.popover) setPopover(null);
      else if (t.laneSel) setLaneSel(null);
      else if (t.selectedSlots.length > 0) setSelectedSlots([]);
      else onModeHomeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /** Smallest visible beat line at this zoom (the ladder's own culling):
   * weak beats from 12 px/beat, else the lowest drawable tier's bar step. */
  const snapStepBeats = (px: number): number => {
    if (px >= 12) return 1;
    const minTier = ladderBaseTier(px, ROUTINE_TIER_BARS);
    return 4 * ROUTINE_TIER_BARS[Math.min(minTier, ROUTINE_TIER_BARS.length - 1)];
  };

  /** Baked (recorded) entry offsets by slotId — the revert target and
   * the "is this an override?" comparison for the entry-offset edits. */
  const bakedEntryBySlotId = useMemo(() => {
    const m: Record<string, number> = {};
    input.cast.forEach((_, i) => {
      m[input.slotIds?.[i] ?? String(i)] = input.entryOffsetsBeats[i];
    });
    return m;
  }, [input]);
  const bakedEntryRef = useRef(bakedEntryBySlotId);
  bakedEntryRef.current = bakedEntryBySlotId;

  /** A slot's EFFECTIVE entry beat (override included) off the live build. */
  const effectiveEntryBeat = (s: PlannedRoutineSlot): number => {
    const p = plannedRef.current;
    return (s.entryMixSec - p.mixStartSec) / p.secPerBeat;
  };

  // ── The select-mode slot drag: TWO AXES (ADR 0038, #207 slice 2).
  // Whichever axis exceeds the threshold first wins the drag:
  // horizontal = shift/slide material (the landed nudge drag), vertical
  // = REORDER — the grabbed slot swaps ENTRY OFFSETS with each crossed
  // slot (reorder is editing entry offsets; the cast re-sorts by entry,
  // ADR 0035/0039). One undo entry per gesture either way.
  const AXIS_THRESHOLD_PX = 4;
  const beginSlide = useCallback(
    (e: React.PointerEvent, slotIds: string[], grabbedId: string) => {
      const startX = e.clientX;
      const startY = e.clientY;
      const key = `slot-drag:${Date.now()}`;
      const base: Record<string, number> = {};
      for (const s of slotIds) base[s] = editsRef.current.nudges[s] ?? 0;
      const prevUserSelect = document.body.style.userSelect;
      const prevCursor = document.body.style.cursor;
      document.body.style.userSelect = 'none';
      let axis: 'x' | 'y' | null = null;
      // After a swap, hold further swaps until the rebuild reflects it
      // (draft mutation → rebuild → render lag would double-swap).
      let expectedOrder: string | null = null;
      const onMove = (ev: PointerEvent) => {
        const { pxPerBeat: px } = viewRef.current;
        if (px <= 0) return;
        if (axis === null) {
          const dx = Math.abs(ev.clientX - startX);
          const dy = Math.abs(ev.clientY - startY);
          if (dx < AXIS_THRESHOLD_PX && dy < AXIS_THRESHOLD_PX) return;
          axis = dx >= dy ? 'x' : 'y';
          if (axis === 'y') document.body.style.cursor = 'ns-resize';
        }
        if (axis === 'x') {
          const dxBeats = (ev.clientX - startX) / px;
          let d = dxBeats;
          if (!ev.shiftKey) {
            const step = snapStepBeats(px);
            d = Math.round(dxBeats / step) * step;
          }
          for (const s of slotIds) {
            const ps = plannedRef.current.slots.find((x) => x.slotId === s);
            const bpm = tracks.get(ps?.trackId ?? -1)?.bpm ?? null;
            const rate = bpm && bpm > 0 ? 60 / bpm : 0.5;
            // Content dragged RIGHT plays earlier material at a given beat:
            // the nudge (a pos offset) moves OPPOSITE the drag.
            const v = Math.round((base[s] - d * rate) * 1e4) / 1e4;
            draftStore.setNudgeLive(key, s, v);
          }
          return;
        }
        // Vertical: reorder by swapping entry offsets with the crossed
        // neighbor (v1 scope — free-form offset dragging stays on the
        // horizontal axis / chip controls).
        const slots = plannedRef.current.slots;
        const orderSig = slots.map((s) => s.slotId).join(',');
        if (expectedOrder !== null && orderSig !== expectedOrder) return; // rebuild pending
        expectedOrder = null;
        const gi = slots.findIndex((s) => s.slotId === grabbedId);
        if (gi < 0) return;
        const blocks = rowsRef.current?.querySelectorAll('.rt-slotblock');
        if (!blocks || blocks.length !== slots.length) return;
        const neighborAt = (k: number): { slot: PlannedRoutineSlot; midY: number } | null => {
          if (k < 0 || k >= slots.length) return null;
          const r = (blocks[k] as HTMLElement).getBoundingClientRect();
          return { slot: slots[k], midY: r.top + r.height / 2 };
        };
        const above = neighborAt(gi - 1);
        const below = neighborAt(gi + 1);
        const target =
          above && ev.clientY < above.midY ? above : below && ev.clientY > below.midY ? below : null;
        if (!target) return;
        const grabbed = slots[gi];
        const eG = effectiveEntryBeat(grabbed);
        const eT = effectiveEntryBeat(target.slot);
        const baked = bakedEntryRef.current;
        const override = (slotId: string, beat: number): number | null =>
          Math.abs(beat - (baked[slotId] ?? NaN)) < 1e-9 ? null : beat;
        draftStore.setEntryOffsetsLive(key, {
          [grabbed.slotId]: override(grabbed.slotId, eT),
          [target.slot.slotId]: override(target.slot.slotId, eG),
        });
        expectedOrder = slots
          .map((s) => (s === grabbed ? target.slot.slotId : s === target.slot ? grabbed.slotId : s.slotId))
          .join(',');
      };
      const onUp = () => {
        document.body.style.userSelect = prevUserSelect;
        document.body.style.cursor = prevCursor;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        draftStore.endGesture();
        // A no-drag click was the SELECT itself (ADR 0038: click = focus
        // slot; seeks live on the background/ruler, not slot rows).
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [draftStore, tracks]
  );

  // ── Pan drag (pan mode / hold-H quasimode): BOTH axes — horizontal
  // rides the beat scroll, vertical rides the timeline's own overflow-y
  // scroller (gh#207 review feedback). ─────────────────────────────────
  const beginPan = useCallback(
    (e: React.PointerEvent) => {
      const startX = e.clientX;
      const startY = e.clientY;
      const s0 = viewRef.current.scrollBeat;
      const st0 = containerRef.current?.scrollTop ?? 0;
      let moved = false;
      const prevUserSelect = document.body.style.userSelect;
      document.body.style.userSelect = 'none';
      const onMove = (ev: PointerEvent) => {
        const { pxPerBeat: px } = viewRef.current;
        if (px <= 0) return;
        if (
          !moved &&
          Math.abs(ev.clientX - startX) < 3 &&
          Math.abs(ev.clientY - startY) < 3
        )
          return;
        moved = true;
        setScrollBeat(clampScroll(s0 - (ev.clientX - startX) / px, px));
        const el = containerRef.current;
        if (el) el.scrollTop = st0 - (ev.clientY - startY);
      };
      const onUp = (ev: PointerEvent) => {
        document.body.style.userSelect = prevUserSelect;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        // A no-drag click stays a seek — seeking is modeless (ADR 0038).
        if (!moved) seekAtClientXRef.current?.(ev.clientX);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [clampScroll]
  );

  // ── Seek scrub ───────────────────────────────────────────────────────
  const scrubbing = useRef(false);
  const seekAtClientXRef = useRef<((x: number) => void) | null>(null);
  const seekAtClientX = useCallback(
    (clientX: number) => {
      const el = rowsRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const { pxPerBeat: px, scrollBeat: s } = viewRef.current;
      if (px <= 0) return;
      const beat = s + (clientX - rect.left) / px;
      // Seeks roam one audition margin beyond either boundary (gh#190
      // item 5) — the player clamps to the same range.
      onSeekBeat(
        Math.max(-AUDITION_MARGIN_BEATS, Math.min(beat, duration + AUDITION_MARGIN_BEATS))
      );
    },
    [onSeekBeat, duration]
  );
  seekAtClientXRef.current = seekAtClientX;

  const plannedRef = useRef(planned);
  plannedRef.current = planned;

  // ── Jump insertion (jump mode: SINGLE click — ADR 0038; replaces the
  // dblclick/alt+dblclick overloads that kept colliding with UI clicks).
  // The popup carries jump⇄pause and displacement, so a plain insert +
  // popover covers pause authoring too.
  const insertJumpAt = useCallback(
    (clientX: number, shiftKey: boolean, slotId: string) => {
      const slot = plannedRef.current.slots.find((s) => s.slotId === slotId);
      if (!slot) return;
      const el = rowsRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const { pxPerBeat: px, scrollBeat: s } = viewRef.current;
      if (px <= 0) return;
      let beat = s + (clientX - rect.left) / px;
      if (!shiftKey) beat = Math.round(beat); // beat magnet; shift = free
      beat = Math.max(0, Math.min(beat, duration));
      const track = tracks.get(slot.trackId);
      const trackBpm = track?.bpm ?? null;
      // Default: a 4-track-beat BACKWARD jump — loopable (the pair
      // editor's add-jump posture, loop doctrine ready).
      const deltaSec = trackBpm && trackBpm > 0 ? -4 * (60 / trackBpm) : -2;
      const jump: AuthoredJump = {
        id: `j-${Date.now()}-${slot.slotId}-${Math.round(beat * 10)}`,
        slotId: slot.slotId,
        beat,
        deltaSec,
      };
      draftStore.addJump(jump);
      setPopover({ marker: { kind: 'authored', slotId: slot.slotId, jump }, x: beat });
    },
    [draftStore, duration, tracks]
  );

  // ── Mode-dispatched canvas gestures (ADR 0038) ───────────────────────
  // Chrome (markers, popovers, lane strips, panels) is exempt: it stays
  // always-live in every mode. Background clicks seek in every mode.
  const onRowsPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (
        (e.target as HTMLElement).closest(
          '.rt-trimhandle, .rt-jump, .rt-lanetoggles, .rt-lanestrip, .rt-jump-popover, .rt-laneauthor, .rt-slotpanel, .rt-panelcol'
        )
      )
        return;
      const slotEl = (e.target as HTMLElement).closest('[data-slot]');
      const slotId = slotEl ? slotEl.getAttribute('data-slot') : null;
      if (mode === 'jump') {
        if (slotId !== null) {
          setPopover(null);
          insertJumpAt(e.clientX, e.shiftKey, slotId);
          return;
        }
        // Background falls through to the modeless seek below.
      } else {
        // Select mode. Selection gestures (gh#190 track drag): cmd/ctrl
        // toggles, shift extends a range from the anchor; a plain click
        // selects the slot and a drag slides the selection.
        if (slotId !== null && (e.metaKey || e.ctrlKey)) {
          setSelectedSlots((prev) =>
            prev.includes(slotId) ? prev.filter((s) => s !== slotId) : [...prev, slotId]
          );
          selAnchor.current = slotId;
          setPopover(null);
          return;
        }
        if (slotId !== null && e.shiftKey) {
          // Range extension runs on the DERIVED index (entry order).
          const slots = plannedRef.current.slots;
          const idxOf = (id: string) => slots.findIndex((x) => x.slotId === id);
          const a = idxOf(selAnchor.current ?? slotId);
          const b = idxOf(slotId);
          if (a >= 0 && b >= 0) {
            const [lo, hi] = a <= b ? [a, b] : [b, a];
            setSelectedSlots(slots.slice(lo, hi + 1).map((x) => x.slotId));
          }
          setPopover(null);
          return;
        }
        if (slotId !== null) {
          setPopover(null);
          if (selectedSlots.includes(slotId)) {
            beginSlide(e, selectedSlots, slotId);
          } else {
            setSelectedSlots([slotId]);
            selAnchor.current = slotId;
            beginSlide(e, [slotId], slotId);
          }
          return;
        }
      }
      // Timeline background: the modeless seek-scrub.
      scrubbing.current = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      seekAtClientX(e.clientX);
      setPopover(null);
    },
    [mode, seekAtClientX, selectedSlots, beginSlide, insertJumpAt]
  );

  // Pan mode grabs EVERYTHING at the capture phase (gh#207 review
  // feedback: pan must work anywhere — panels, lane strips, markers),
  // except the popover, which stays interactive. A no-drag click still
  // seeks (modeless seek).
  const onRowsPointerDownCapture = useCallback(
    (e: React.PointerEvent) => {
      if (mode !== 'pan') return;
      if ((e.target as HTMLElement).closest('.rt-jump-popover')) return;
      e.stopPropagation();
      setPopover(null);
      beginPan(e);
    },
    [mode, beginPan]
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
      if (marker.kind !== 'authored' && marker.kind !== 'authored-pause') {
        setPopover({ marker, x: markerBeat(marker) });
        return;
      }
      const id = marker.kind === 'authored' ? marker.jump.id : marker.pause.id;
      jumpDrag.current = { id, moved: false };
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
        if (marker.kind === 'authored') draftStore.updateJump(drag.id, { beat });
        else draftStore.updatePause(drag.id, { beat });
      };
      const onUp = () => {
        const drag = jumpDrag.current;
        jumpDrag.current = null;
        draftStore.endGesture();
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        if (drag && !drag.moved) setPopover({ marker, x: markerBeat(marker) });
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [draftStore, duration]
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
  // Canvas gridlines, routine-clock duple inference — the RULER's grid
  // and the gridless-track fallback only (gh#190 iteration: slot rows
  // grid on their track's real ladder below).
  const gridLines = useMemo(
    () => gridTicks(scrollBeat, scrollBeat + (pxPerBeat > 0 ? width / pxPerBeat : 0), pxPerBeat),
    [scrollBeat, pxPerBeat, width]
  );

  // Keyed on the jump-edited base: trace identities survive lane drags.
  const slotRuns = useMemo<BeatRun[][]>(
    () => plannedForRuns.slots.map((slot) => traceDrawRuns(slot.trace, duration)),
    [plannedForRuns, duration]
  );
  // Per-slot REAL ladders (gh#190 iteration): the track's beat/downbeat
  // lattice + tiers + Reset marks, projected through the slot's draw runs
  // onto the routine clock. Keyed on the jump-edited base like the runs
  // (identities survive lane drags); view-independent (beats, not px), so
  // scroll doesn't rebuild — only zoom (density decisions) does.
  const slotLadders = useMemo<(SlotLadderMarks | null)[]>(
    () =>
      plannedForRuns.slots.map((slot, i) => {
        const meter = meters.get(slot.trackId) ?? null;
        return meter ? slotLadderMarks(meter, slotRuns[i], pxPerBeat) : null;
      }),
    [plannedForRuns, slotRuns, meters, pxPerBeat]
  );
  // The GLOBAL ladder (gh#190 iteration): the mix's own hypermeter on the
  // ruler — anchored on slot 0, governed by the audible slot (ties by
  // first entry), with DERIVED reset guides where a handoff breaks the
  // running phrase count. Zoom-independent; culling happens at draw.
  const globalLadder = useMemo(() => {
    const { mixStartSec, secPerBeat } = plannedForRuns;
    const toBeat = (sec: number) => (sec - mixStartSec) / secPerBeat;
    const downsBySlot: (ReturnType<typeof slotDownbeatMarks> | null)[] =
      plannedForRuns.slots.map((slot, i) => {
        const meter = meters.get(slot.trackId) ?? null;
        return meter ? slotDownbeatMarks(meter, slotRuns[i]) : null;
      });
    return buildGlobalLadder(
      plannedForRuns.slots.map((slot) => ({
        slot: slot.slot,
        entryBeat: toBeat(slot.entryMixSec),
        releaseBeat: toBeat(slot.releaseMixSec),
      })),
      downsBySlot.map((d) => d?.downs ?? null),
      downsBySlot.map((d) => d?.resets ?? null),
      plannedForRuns.slots.map(
        (slot) => meters.get(slot.trackId)?.topBars ?? null
      ),
      duration
    );
  }, [plannedForRuns, slotRuns, meters, duration]);
  const jumpMarkers = useMemo<JumpMarker[][]>(() => {
    return planned.slots.map((slot) => {
      const out: JumpMarker[] = [];
      const removed = edits.removedRecordedJumps.filter((r) => r.slotId === slot.slotId);
      const authoredJ = edits.jumps.filter((j) => j.slotId === slot.slotId);
      for (const rj of recordedJumpsBySlot[slot.slotId] ?? []) {
        const isRemoved = removed.some((r) => Math.abs(r.beat - rj.beat) < 0.01);
        // A CONVERSION (removed + authored at the same beat) shows only
        // the authored marker; the ghost reappears if the edited jump is
        // dragged away (still restorable).
        const converted =
          isRemoved && authoredJ.some((j) => Math.abs(j.beat - rj.beat) < 0.01);
        if (converted) continue;
        out.push(
          isRemoved
            ? { kind: 'ghost', slotId: slot.slotId, beat: rj.beat }
            : { kind: 'recorded', slotId: slot.slotId, beat: rj.beat, deltaSec: rj.deltaSec }
        );
      }
      for (const j of authoredJ) {
        out.push({ kind: 'authored', slotId: slot.slotId, jump: j });
      }
      // Play/pause events (gh#190): recorded holds + authored pauses.
      const removedP = edits.removedRecordedPauses.filter((r) => r.slotId === slot.slotId);
      const authoredP = edits.pauses.filter((p) => p.slotId === slot.slotId);
      for (const rp of recordedPausesBySlot[slot.slotId] ?? []) {
        const isRemoved = removedP.some((r) => Math.abs(r.beat - rp.beat) < 0.01);
        // A conversion (removed + authored at the same beat) shows only
        // the authored marker — no ghost under it.
        const converted =
          isRemoved && authoredP.some((p) => Math.abs(p.beat - rp.beat) < 0.01);
        if (converted) continue;
        out.push(
          isRemoved
            ? { kind: 'ghost-pause', slotId: slot.slotId, beat: rp.beat, endBeat: rp.endBeat }
            : { kind: 'recorded-pause', slotId: slot.slotId, beat: rp.beat, endBeat: rp.endBeat }
        );
      }
      for (const p of authoredP) {
        out.push({ kind: 'authored-pause', slotId: slot.slotId, pause: p });
      }
      return out;
    });
  }, [planned, edits, recordedJumpsBySlot, recordedPausesBySlot]);

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
        const globalMode = globalLadder.marks.length > 0;
        for (const tick of gridBeats) {
          const x = xAt(tick.beat);
          if (x < -24 || x > width + 24) continue;
          if (globalMode) {
            // The GLOBAL ladder carries the structure below; routine-clock
            // ticks stay label-weight only.
            if (tick.major) {
              ctx.strokeStyle = 'rgba(255,255,255,0.15)';
              ctx.beginPath();
              ctx.moveTo(x, 14);
              ctx.lineTo(x, RULER_H);
              ctx.stroke();
            }
          } else {
            // No meters anywhere: the routine-clock tier lines, RELATIVE
            // to the lowest visible level (gh#190 item 7 iteration).
            const pos = tick.tier - gridLines.baseTier;
            const alpha =
              pos <= 0 ? 0.15 : TIER_ALPHA[Math.min(pos - 1, TIER_ALPHA.length - 1)];
            const top = pos >= 3 ? 2 : pos >= 1 ? 8 : 14;
            ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
            ctx.lineWidth =
              pos <= 0 ? 1 : TIER_WIDTH[Math.min(pos - 1, TIER_WIDTH.length - 1)];
            ctx.beginPath();
            ctx.moveTo(x, top);
            ctx.lineTo(x, RULER_H);
            ctx.stroke();
            ctx.lineWidth = 1;
          }
          if (tick.major && tick.label !== undefined) {
            ctx.fillStyle = 'rgba(232,232,240,0.75)';
            ctx.fillText(tick.label, x + 4, 9);
          }
        }
        if (globalMode) {
          // The mix's own hypermeter (gh#190): governed downbeats at the
          // shared weights (relative thinning), parenthetical bars gold,
          // reset guides (source AND derived) as gold pole + pennant.
          const minTier = ladderBaseTier(pxPerBeat, ROUTINE_TIER_BARS);
          const baseTier = pxPerBeat >= 12 ? -1 : minTier;
          for (const m of globalLadder.marks) {
            const x = xAt(m.beatR);
            if (x < -24 || x > width + 24) continue;
            // Parenthetical bars ALWAYS draw (they are the finding).
            if (m.tier < minTier && !m.parenthetical) continue;
            const pos = m.tier - baseTier;
            const alpha =
              pos <= 0 ? 0.2 : TIER_ALPHA[Math.min(pos - 1, TIER_ALPHA.length - 1)];
            const w = pos <= 0 ? 1 : TIER_WIDTH[Math.min(pos - 1, TIER_WIDTH.length - 1)];
            ctx.fillStyle = m.parenthetical
              ? `rgba(255,209,102,${Math.min(1, alpha + 0.25)})`
              : `rgba(255,255,255,${alpha})`;
            ctx.fillRect(x, m.tier >= 2 ? 4 : 10, Math.max(w, m.parenthetical ? 2 : 1), RULER_H);
          }
          for (const r of globalLadder.resets) {
            const x = xAt(r);
            if (x < -24 || x > width + 24) continue;
            // Left edge = the quantum (gridline geometry).
            ctx.fillStyle = 'rgba(255,209,102,0.95)';
            ctx.fillRect(x, 0, 2, RULER_H);
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, 10);
            ctx.lineTo(x - 6, 5);
            ctx.closePath();
            ctx.fill();
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
      const ladder = slotLadders[i];
      if (ladder) drawLadder(ctx, ladder, xAt, width, WAVE_H, 'wave');
      else drawGrid(ctx, gridLines, xAt, width, WAVE_H);
      const wave = waves.get(slot.trackId) ?? null;
      if (wave) {
        // Modulation reads the LIVE build (lane edits included) — runs
        // stay keyed on the jump-edited base (identity survives drags).
        const liveSlot = planned.slots[i] ?? slot;
        drawSlotWave(ctx, wave, styleSlot.styleId, styleSlot.params, slotRuns[i], liveSlot, {
          xAt,
          beatAt: (px: number) => (px + viewPx) / pxPerBeat,
          width,
          waveH: WAVE_H,
        });
        drawHotCues(ctx, hotcues.get(slot.trackId) ?? [], slotRuns[i], xAt, width, WAVE_H);
      }
      // EFFECTIVE entry (edits-layer override included, ADR 0039) — the
      // baked input array is indexed by the recording's slot address,
      // not the derived order.
      const entryBeat =
        (slot.entryMixSec - plannedForRuns.mixStartSec) / plannedForRuns.secPerBeat;
      const ex = xAt(entryBeat);
      if (ex >= -4 && ex <= width + 4) {
        ctx.strokeStyle = slotAccent(slot.deck);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(ex, 0);
        ctx.lineTo(ex, WAVE_H);
        ctx.stroke();
        ctx.lineWidth = 1;
        ctx.fillStyle = slotAccent(slot.deck);
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
      // Expansion preview (gh#190 item 10): an outward-dragged trim
      // handle projects the boundary slot's material into the extension
      // region — the same extrapolation the re-promotion will pull in
      // (approximate: the true retrim replays the session slice; this
      // shows the boundary track's own continuation).
      if (wave && trim) {
        const ext: BeatRun[] = [];
        if (slot.slot === 0 && trim.startBeat < 0) {
          const s = traceStateAt(slot.trace, 1e-3);
          const rate = s.moving ? s.ratePerBeat : 0;
          ext.push({
            b0: trim.startBeat,
            b1: 0,
            ph0: s.pos + trim.startBeat * rate,
            ph1: s.pos,
          });
        }
        if (slot.slot === plannedForRuns.slots.length - 1 && trim.endBeat > duration) {
          const s = traceStateAt(slot.trace, duration);
          const rate = s.moving ? s.ratePerBeat : 0;
          ext.push({
            b0: duration,
            b1: trim.endBeat,
            ph0: s.pos,
            ph1: s.pos + (trim.endBeat - duration) * rate,
          });
        }
        if (ext.length > 0) {
          ctx.globalAlpha = 0.7;
          const liveSlot = planned.slots[i] ?? slot;
          drawSlotWave(ctx, wave, styleSlot.styleId, styleSlot.params, ext, liveSlot, {
            xAt,
            beatAt: (px: number) => (px + viewPx) / pxPerBeat,
            width,
            waveH: WAVE_H,
          });
          ctx.globalAlpha = 1;
        }
      }
    });
  }, [
    width,
    pxPerBeat,
    scrollBeat,
    plannedForRuns,
    planned,
    input,
    waves,
    hotcues,
    gridBeats,
    gridLines,
    slotLadders,
    globalLadder,
    duration,
    slotRuns,
    styleSlot,
    trim,
  ]);

  // ── Recorded-lane strip drawing (non-authored strips only) ───────────
  useEffect(() => {
    if (width <= 0 || pxPerBeat <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    const viewPx = Math.round(scrollBeat * pxPerBeat);
    const xAt = (beat: number) => beat * pxPerBeat - viewPx;
    for (const slot of planned.slots) {
      const colors = slotLaneColors(slot.deck);
      for (const control of lanesFor(slot.slotId)) {
        if (slot.lanes.authored?.[control]) continue; // LaneCanvas owns it
        const strip = laneCanvasRefs.current.get(`${slot.slotId}:${control}`);
        if (!strip) continue;
        strip.width = width * dpr;
        strip.height = STRIP_H * dpr;
        const ctx = strip.getContext('2d');
        if (!ctx) continue;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = '#0e0e0e';
        ctx.fillRect(0, 0, width, STRIP_H);
        const ladder = slotLadders[slot.slot];
        if (ladder) drawLadder(ctx, ladder, xAt, width, STRIP_H, 'strip');
        else drawGrid(ctx, gridLines, xAt, width, STRIP_H, 'strip');
        drawLaneSteps(ctx, slot, control, colors[control], {
          width,
          stripH: STRIP_H,
          scrollBeat,
          pxPerBeat,
          duration,
        });
      }
    }
  }, [width, pxPerBeat, scrollBeat, planned, gridLines, slotLadders, duration, lanesFor]);

  // ── DOM ──────────────────────────────────────────────────────────────
  // The SAME snapped view origin the canvases use (gh#190 scroll-lock
  // fix): DOM positions off the unrounded origin wiggled ±0.5px against
  // the canvas grid every scroll step — the authored lanes read as not
  // locked to the rest of the UI.
  const viewOriginPx = Math.round(scrollBeat * pxPerBeat);
  const xOf = (beat: number) => beat * pxPerBeat - viewOriginPx;
  const windowLeft = xOf(0);
  const windowWidth = duration * pxPerBeat;

  // LaneCanvas guides, PER SLOT (gh#190 iteration): the slot's real track
  // ladder normalized into the routine window, tiers RELATIVE to the
  // lowest visible level so authored lanes wear the pair editor's exact
  // GUIDE_TIER weights and thin in step with the rows. Gridless slots
  // fall back to the routine-clock grid.
  const laneGuidesBySlot = useMemo(() => {
    const norm = (beat: number) => (duration > 0 ? beat / duration : 0);
    const fallback = gridLines.ticks
      .filter((t) => t.beat >= 0 && t.beat <= duration)
      .map((t) => {
        const pos = t.tier - gridLines.baseTier;
        return {
          x: norm(t.beat),
          strong: pos > 0,
          tier: pos > 0 ? pos - 1 : undefined,
        };
      });
    return planned.slots.map((slot) => {
      const ladder = slotLadders[slot.slot];
      if (!ladder) return fallback;
      return ladder.marks
        .filter((m) => m.beatR >= 0 && m.beatR <= duration)
        .map((m) => {
          const pos = m.tier - ladder.baseTier;
          return {
            x: norm(m.beatR),
            strong: pos > 0,
            tier: pos > 0 ? pos - 1 : undefined,
            parenthetical: m.parenthetical || undefined,
          };
        });
    });
  }, [gridLines, slotLadders, planned, duration]);

  const authorLane = useCallback(
    (slot: PlannedRoutineSlot, control: AuthorableLaneControl) => {
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
      draftStore.setLane(slot.slotId, control, env);
      draftStore.endGesture();
    },
    [draftStore]
  );

  const laneCanvasFor = (slot: PlannedRoutineSlot, control: AuthorableLaneControl, color: string) => {
    const key = `${slot.slotId}:${control}`;
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
          guides={laneGuidesBySlot[slot.slot] ?? EMPTY_GUIDES}
          chopWall={duration > 0 ? 0.1 / duration : 0.01}
          windowLeftPx={0}
          registerScrollDraw={scrollDrawFor(key)}
          onChange={(next) => draftStore.setLane(slot.slotId, control, next.map(fromLanePoint))}
          selected={laneSel?.key === key ? laneSel.indices : NO_SELECTION}
          onSelectedChange={(indices) =>
            setLaneSel(indices.length > 0 ? { key, indices } : null)
          }
        />
      </div>
    );
  };

  return (
    <div className="rt-timeline" ref={containerRef} data-mode={mode}>
      <div className="rt-toolbar-float">
        <button className="rt-fit" title="Fit the whole Routine" onClick={fit}>
          fit
        </button>
      </div>
      {/* The ruler is a modeless seek surface in every mode (ADR 0038). */}
      <canvas
        ref={rulerRef}
        className="rt-ruler"
        style={{ height: RULER_H }}
        onPointerDown={(e) => {
          scrubbing.current = true;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          seekAtClientX(e.clientX);
        }}
        onPointerMove={onRowsPointerMove}
        onPointerUp={onRowsPointerUp}
        onPointerCancel={onRowsPointerUp}
      />
      <div
        className="rt-rows"
        ref={rowsRef}
        onPointerDownCapture={onRowsPointerDownCapture}
        onPointerDown={onRowsPointerDown}
        onPointerMove={onRowsPointerMove}
        onPointerUp={onRowsPointerUp}
        onPointerCancel={onRowsPointerUp}
      >
        {/* Continuous panel COLUMN (gh#190 iteration): one unbroken tint +
            right border down the whole timeline — the per-slot panels are
            transparent content over it, so block gaps don't cut it. */}
        <div className="rt-panelcol" />
        {planned.slots.map((slot, i) => {
          const track = tracks.get(slot.trackId);
          const trackBpm = track?.bpm ?? null;
          const colors = slotLaneColors(slot.deck);
          const reused =
            slot.deck !== null &&
            planned.slots.some((o) => o.slot < slot.slot && o.deck === slot.deck);
          return (
            <div className="rt-slotblock" key={slot.slotId}>
              {/* Fixed-width DIM PANEL (gh#190 iteration): spans the whole
                  slot block behind the left-side controls — track data in
                  three rows (title / artist / deck·bpm·key·extra), titles
                  truncating. No temporal-offset controls: dragging owns
                  that. */}
              <div className="rt-slotpanel">
                <div className="rt-sp-title">
                  <span className="rt-slotnum" style={{ background: slotAccent(slot.deck) }}>
                    {slot.slot}
                  </span>
                  <span className="rt-sp-trunc">
                    {track?.title || track?.filename || `track ${slot.trackId}`}
                  </span>
                </div>
                <div className="rt-sp-artist rt-sp-trunc">{track?.artist ?? '—'}</div>
                <div className="rt-sp-meta">
                  <span
                    style={{ color: slotAccent(slot.deck) }}
                    title={
                      reused
                        ? 'Deck reused: a finished slot freed it (concurrency allocation)'
                        : undefined
                    }
                  >
                    {slot.deck ? `deck ${slot.deck}${reused ? ' ↺' : ''}` : 'no deck'}
                  </span>
                  {trackBpm ? (
                    <span style={{ color: getBpmColor(trackBpm) ?? undefined }}>
                      {Math.round(trackBpm * 10) / 10}
                      {Math.abs(slot.basePitchPercent) > 0.05
                        ? ` (${slot.basePitchPercent > 0 ? '+' : ''}${slot.basePitchPercent.toFixed(1)}%)`
                        : ''}
                    </span>
                  ) : null}
                  {track?.key !== undefined && track?.key !== null ? (
                    <span
                      style={{
                        color: getKeyColor(engineIdToOpenKey(track.key)) ?? undefined,
                      }}
                    >
                      {engineIdToOpenKey(track.key)}
                    </span>
                  ) : null}
                  {slot.slot === 0 && <span className="rt-boundary-tag">enters with</span>}
                  {slot.slot === planned.slots.length - 1 && (
                    <span className="rt-boundary-tag">exits with</span>
                  )}
                  {edits.entryOffsets[slot.slotId] !== undefined && (
                    <button
                      className="rt-entrybadge"
                      title={`Entry offset edited: recorded ${(
                        bakedEntryBySlotId[slot.slotId] ?? 0
                      ).toFixed(1)}b → ${edits.entryOffsets[slot.slotId].toFixed(
                        1
                      )}b (the edits layer — the recording never changes). Click to revert to recorded.`}
                      onClick={(e) => {
                        e.stopPropagation();
                        draftStore.clearEntryOffset(slot.slotId);
                      }}
                    >
                      ✎ entry {edits.entryOffsets[slot.slotId].toFixed(0)}b ↺
                    </button>
                  )}
                </div>
                {/* Channel trim (gh#190): the mixer's own knob idiom, PINNED
                    bottom-right of the panel (out of the text rows). */}
                <span
                  className={`rt-sp-trim${slot.trim !== 0.5 ? ' on' : ''}`}
                  title="Channel trim (replayed through the real gain curve; double-click resets)"
                  onPointerUp={() => draftStore.endGesture()}
                >
                  <Knob
                    label={
                      Math.abs(slot.trim - 0.5) < 1e-6
                        ? 'TRIM'
                        : `${slot.trim > 0.5 ? '+' : ''}${(
                            20 * Math.log10(trimToGain(slot.trim) / trimToGain(0.5))
                          ).toFixed(1)}dB`
                    }
                    min={0}
                    max={1}
                    defaultValue={0.5}
                    value={slot.trim}
                    onChange={(v) => draftStore.setTrim(slot.slotId, v)}
                  />
                </span>
              </div>
              <div
                className={`rt-wave-row${selectedSlots.includes(slot.slotId) ? ' rt-selected' : ''}`}
                data-slot={slot.slotId}
                style={{
                  height: WAVE_H,
                  ...(selectedSlots.includes(slot.slotId)
                    ? { outlineColor: slotAccent(slot.deck) }
                    : {}),
                }}
                title={
                  selectedSlots.includes(slot.slotId)
                    ? 'Selected — drag horizontally to slide the track (snaps to the smallest visible beat line; shift = fine); drag vertically to reorder (swaps entry offsets — the cast re-sorts by entry). Cmd-click to deselect, Esc clears.'
                    : undefined
                }
              >
                <canvas
                  ref={(el) => {
                    waveCanvasRefs.current[i] = el;
                  }}
                  style={{ height: WAVE_H }}
                />
                {jumpMarkers[i].map((marker, mi) => {
                  const beat = markerBeat(marker);
                  const x = xOf(beat);
                  if (x < -4 || x > width + 4) return null;
                  let label: string;
                  let title: string;
                  switch (marker.kind) {
                    case 'ghost':
                      label = '↷ removed';
                      title = 'Removed recorded jump (click to restore)';
                      break;
                    case 'ghost-pause':
                      label = '⏸ removed';
                      title = 'Removed recorded pause (click to restore — the hold plays again)';
                      break;
                    case 'recorded-pause':
                      label = `⏸ ${(marker.endBeat - marker.beat).toFixed(1)}b`;
                      title = 'Recorded pause (click: inspect/remove — removal plays through)';
                      break;
                    case 'authored-pause':
                      label = `✎⏸ ${marker.pause.durBeats.toFixed(1)}b`;
                      title = 'Authored pause (drag to move, click to edit)';
                      break;
                    default: {
                      const deltaSec =
                        marker.kind === 'authored' ? marker.jump.deltaSec : marker.deltaSec;
                      const beats =
                        trackBpm && trackBpm > 0 ? deltaSec / (60 / trackBpm) : null;
                      const repeat =
                        marker.kind === 'authored' && marker.jump.repeat && marker.jump.repeat > 1
                          ? marker.jump.repeat
                          : null;
                      label = `${marker.kind === 'authored' ? '✎ ' : '↷ '}${
                        beats !== null
                          ? `${beats >= 0 ? '+' : ''}${beats.toFixed(1)}b`
                          : `${deltaSec >= 0 ? '+' : ''}${deltaSec.toFixed(1)}s`
                      }${repeat ? ` ×${repeat}` : ''}`;
                      title =
                        marker.kind === 'recorded'
                          ? 'Recorded jump (click: inspect/remove)'
                          : 'Authored jump (drag to move, click to edit)';
                    }
                  }
                  // Pauses show their RESUME (play) point too (gh#190
                  // iteration): a paired ▶ marker at the hold's end.
                  const resumeBeat =
                    marker.kind === 'recorded-pause'
                      ? marker.endBeat
                      : marker.kind === 'authored-pause'
                        ? marker.pause.beat + marker.pause.durBeats
                        : null;
                  const rx = resumeBeat !== null ? xOf(resumeBeat) : null;
                  return (
                    <Fragment key={`${marker.kind}-${mi}`}>
                      <div
                        className={`rt-jump ${marker.kind}`}
                        style={{
                          transform: `translateX(${x}px)`,
                          borderLeftColor: slotAccent(slot.deck),
                        }}
                        title={title}
                        onPointerDown={onJumpPointerDown(marker)}
                      >
                        <span
                          className="rt-jump-chip"
                          style={{ background: slotAccent(slot.deck) }}
                        >
                          {label}
                        </span>
                      </div>
                      {rx !== null && rx >= -4 && rx <= width + 4 && (
                        <div
                          className={`rt-jump rt-pause-resume ${marker.kind}`}
                          style={{
                            transform: `translateX(${rx}px)`,
                            borderLeftColor: slotAccent(slot.deck),
                          }}
                          title="Playback resumes here"
                          onPointerDown={onJumpPointerDown(marker)}
                        >
                          <span
                            className="rt-jump-chip"
                            style={{ background: slotAccent(slot.deck) }}
                          >
                            ▶
                          </span>
                        </div>
                      )}
                    </Fragment>
                  );
                })}

                <div className="rt-lanetoggles">
                  {SLOT_LANE_ORDER.map((control) => {
                    const on = lanesFor(slot.slotId).includes(control);
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
                          toggleLane(slot.slotId, control);
                        }}
                      >
                        {SLOT_LANE_LABELS[control][0]}
                      </button>
                    );
                  })}
                </div>
                {/* Jump popover (the pair editor's idiom). */}
                {popover && popover.marker.slotId === slot.slotId && (
                  <JumpPopover
                    popover={popover}
                    x={xOf(popover.x)}
                    trackBpm={trackBpm}
                    secPerBeat={planned.secPerBeat}
                    draftStore={draftStore}
                    onSwap={(marker) => setPopover({ marker, x: markerBeat(marker) })}
                    onClose={() => setPopover(null)}
                  />
                )}
              </div>
              {lanesFor(slot.slotId).map((control) => {
                const authored = !!slot.lanes.authored?.[control];
                const h = authored ? STRIP_H_AUTHORED : STRIP_H;
                // TRIM is recorded-only: the panel knob offsets the whole
                // slot; no envelope authoring (gh#190).
                const editable = control !== 'trim';
                return (
                  <div className="rt-lanestrip" key={control} style={{ height: h }}>
                    {!authored && (
                      <canvas
                        ref={(el) => {
                          const key = `${slot.slotId}:${control}`;
                          if (el) laneCanvasRefs.current.set(key, el);
                          else laneCanvasRefs.current.delete(key);
                        }}
                        style={{ height: STRIP_H }}
                      />
                    )}
                    {authored &&
                      editable &&
                      laneCanvasFor(slot, control as AuthorableLaneControl, colors[control])}
                    <span className="rt-laneedge" style={{ background: colors[control] }} />
                    <span className="rt-lanelabel" style={{ color: colors[control] }}>
                      {SLOT_LANE_LABELS[control]}
                      {authored ? ' ✎' : ''}
                    </span>
                    {editable && (
                      <button
                        className="rt-laneauthor"
                        title={
                          authored
                            ? 'Discard the edited envelope — the recorded lane plays again'
                            : 'Edit this lane (seeded from the recording; drag breakpoints, click to add, double-click to delete)'
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          if (authored) draftStore.clearLane(slot.slotId, control);
                          else authorLane(slot, control as AuthorableLaneControl);
                        }}
                      >
                        {authored ? '↺' : '✎'}
                      </button>
                    )}
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
        {/* Trim handles are select-mode canvas edits (ADR 0038) — the
            shaded trim REGIONS below stay visible in every mode. */}
        {mode === 'select' &&
          trim &&
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
const EMPTY_GUIDES: LaneGuide[] = [];

// ── Jump popover ─────────────────────────────────────────────────────────

function JumpPopover({
  popover,
  x,
  trackBpm,
  secPerBeat,
  draftStore,
  onSwap,
  onClose,
}: {
  popover: NonNullable<PopoverState>;
  x: number;
  trackBpm: number | null;
  /** Routine seconds per beat (pause durations live on the routine clock). */
  secPerBeat: number;
  draftStore: RoutineDraftStore;
  /** Swap the open popover to a converted marker (jump ⇄ pause). */
  onSwap: (marker: JumpMarker) => void;
  onClose: () => void;
}) {
  const m = popover.marker;
  const beatLen = trackBpm && trackBpm > 0 ? 60 / trackBpm : null;
  if (m.kind === 'ghost-pause') {
    return (
      <div className="rt-jump-popover" style={{ left: Math.max(0, x - 40) }}>
        <span>removed recorded pause</span>
        <button
          onClick={() => {
            draftStore.restoreRecordedPause(m.slotId, m.beat);
            onClose();
          }}
        >
          restore
        </button>
        <button onClick={onClose}>✕</button>
      </div>
    );
  }
  if (m.kind === 'recorded-pause') {
    return (
      <div className="rt-jump-popover" style={{ left: Math.max(0, x - 40) }}>
        <span>recorded ⏸ {(m.endBeat - m.beat).toFixed(1)}b</span>
        <button
          title="Convert to an edited pause — length-editable, movable (the recorded hold is suppressed; one undo restores it)"
          onClick={() => {
            const pause = draftStore.convertRecordedPause(m.slotId, m.beat, m.endBeat - m.beat);
            onSwap({ kind: 'authored-pause', slotId: m.slotId, pause });
          }}
        >
          ✎ edit
        </button>
        <button
          className="rt-jump-delete"
          title="Remove this recorded hold — replay plays through it"
          onClick={() => {
            draftStore.removeRecordedPause(m.slotId, m.beat);
            onClose();
          }}
        >
          remove
        </button>
        <button onClick={onClose}>✕</button>
      </div>
    );
  }
  if (m.kind === 'ghost') {
    return (
      <div className="rt-jump-popover" style={{ left: Math.max(0, x - 40) }}>
        <span>removed recorded jump</span>
        <button
          onClick={() => {
            draftStore.restoreRecordedJump(m.slotId, m.beat);
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
          title="Convert to an edited jump — movable/resizable; the recorded one stays restorable (one undo)"
          onClick={() => {
            const jump = draftStore.convertRecordedJump(m.slotId, m.beat, m.deltaSec);
            onSwap({ kind: 'authored', slotId: m.slotId, jump });
          }}
        >
          ✎ edit
        </button>
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
  // ── Unified displacement editor (gh#190 redesign) ─────────────────────
  // One authored event, three directions: ◀ backward jump, ⏸ pause,
  // ▶ forward jump. Value defaults to powers of two — ½/×2 buttons carry
  // the common gestures; the two fine inputs (beats/seconds) stay linked.
  // LIVE lookup by id: the old snapshot-captured marker made the inputs
  // read stale values ("the beat jump editor is broken").
  const isPause = m.kind === 'authored-pause';
  const snap = draftStore.getSnapshot().edits;
  const j = !isPause ? snap.jumps.find((x) => x.id === m.jump.id) : undefined;
  const p = isPause ? snap.pauses.find((x) => x.id === m.pause.id) : undefined;
  if (!j && !p) return null;
  const dir: 'back' | 'pause' | 'fwd' = p ? 'pause' : j!.deltaSec <= 0 ? 'back' : 'fwd';
  const valueBeats = p
    ? p.durBeats
    : beatLen
      ? Math.abs(j!.deltaSec) / beatLen
      : Math.abs(j!.deltaSec) / secPerBeat;
  const valueSecs = p ? p.durBeats * secPerBeat : Math.abs(j!.deltaSec);
  const setBeats = (b: number, seal = false) => {
    if (!Number.isFinite(b) || b <= 0) return;
    if (p) draftStore.updatePause(p.id, { durBeats: b });
    else {
      const len = beatLen ?? secPerBeat;
      draftStore.updateJump(j!.id, { deltaSec: (dir === 'back' ? -1 : 1) * b * len });
    }
    if (seal) draftStore.endGesture();
  };
  const setSecs = (s: number) => {
    if (!Number.isFinite(s) || s <= 0) return;
    if (p) draftStore.updatePause(p.id, { durBeats: s / secPerBeat });
    else draftStore.updateJump(j!.id, { deltaSec: (dir === 'back' ? -1 : 1) * s });
  };
  const setDir = (d: 'back' | 'pause' | 'fwd') => {
    if (d === dir) return;
    if (d === 'pause') {
      const pause = draftStore.replaceJumpWithPause(j!.id, valueBeats || 4);
      if (pause) onSwap({ kind: 'authored-pause', slotId: m.slotId, pause });
    } else if (p) {
      const len = beatLen ?? secPerBeat;
      const jump = draftStore.replacePauseWithJump(
        p.id,
        (d === 'back' ? -1 : 1) * valueBeats * len
      );
      if (jump) onSwap({ kind: 'authored', slotId: m.slotId, jump });
    } else {
      draftStore.updateJump(j!.id, { deltaSec: -j!.deltaSec });
      draftStore.endGesture();
    }
  };
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return (
    <div className="rt-jump-popover rt-displacement" style={{ left: Math.max(0, x - 100) }}>
      <span className="rt-dir">
        {(
          [
            ['back', '◀', 'Backward jump (replays material — loopable)'],
            ['pause', '⏸', 'Pause: hold the deck, resume from the same spot'],
            ['fwd', '▶', 'Forward jump (skips material)'],
          ] as const
        ).map(([d, glyph, title]) => (
          <button
            key={d}
            className={dir === d ? 'on' : ''}
            title={title}
            onClick={() => setDir(d)}
          >
            {glyph}
          </button>
        ))}
      </span>
      <button title="Half" onClick={() => setBeats(valueBeats / 2, true)}>
        ½
      </button>
      <button title="Double" onClick={() => setBeats(valueBeats * 2, true)}>
        ×2
      </button>
      <label>
        <input
          type="number"
          step={1}
          min={0}
          value={r2(valueBeats)}
          onChange={(e) => setBeats(Number(e.target.value))}
          onBlur={() => draftStore.endGesture()}
        />
        b
      </label>
      <label>
        <input
          type="number"
          step={0.05}
          min={0}
          value={r2(valueSecs)}
          onChange={(e) => setSecs(Number(e.target.value))}
          onBlur={() => draftStore.endGesture()}
        />
        s
      </label>
      {dir === 'back' && j && (
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
          if (p) draftStore.removePause(p.id);
          else draftStore.removeJump(j!.id);
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

/** Metric-ladder gridlines at the SHARED weights (gh#190 item 7,
 * walkthrough round 2 — "consistent weight"): wave rows use
 * WaveformRendererV2's TIER_WIDTH/TIER_ALPHA (weak beats 1px @ 0.15,
 * their look on every waveform surface); lane strips use LaneCanvas's
 * dimmer GUIDE_TIER_* (guides sit under automation). Left-aligned rects,
 * the renderer's own geometry. Styling is RELATIVE to the lowest visible
 * level (`baseTier`, gh#190 iteration): the thinnest visible tier wears
 * the weak-beat style and the rest escalate from there, so zooming out
 * re-thins the surviving lines instead of leaving a wall of thick ones. */
/** Style for a ladder line at style position `pos` (relative to the
 * lowest visible level: 0 = weak/thinnest, k > 0 = TIER_*[k−1]). */
function ladderLineStyle(
  pos: number,
  flavor: 'wave' | 'strip'
): { w: number; alpha: number } {
  const tierWidth = flavor === 'wave' ? TIER_WIDTH : GUIDE_TIER_WIDTH;
  const tierAlpha = flavor === 'wave' ? TIER_ALPHA : GUIDE_TIER_ALPHA;
  const weakAlpha = flavor === 'wave' ? 0.15 : 0.09;
  if (pos <= 0) return { w: 1, alpha: weakAlpha };
  return {
    w: tierWidth[Math.min(pos - 1, tierWidth.length - 1)],
    alpha: tierAlpha[Math.min(pos - 1, tierAlpha.length - 1)],
  };
}

/** The Metric-ladder authoring gold (Reset pennants, parenthetical bars). */
const LADDER_GOLD = '255,209,102';

function drawGrid(
  ctx: CanvasRenderingContext2D,
  grid: { ticks: { beat: number; tier: number }[]; baseTier: number },
  xAt: (beat: number) => number,
  width: number,
  height: number,
  flavor: 'wave' | 'strip' = 'wave'
): void {
  for (const tick of grid.ticks) {
    const x = xAt(tick.beat);
    if (x < -4 || x > width) continue;
    const { w, alpha } = ladderLineStyle(tick.tier - grid.baseTier, flavor);
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    ctx.fillRect(x, 0, w, height);
  }
}

/** A slot's REAL track ladder (gh#190 iteration): projected marks at the
 * shared weights, parenthetical bars tinted gold (metric-ladder 03), gold
 * Reset poles (the renderer's mark language, sans pennant at row scale). */
function drawLadder(
  ctx: CanvasRenderingContext2D,
  ladder: SlotLadderMarks,
  xAt: (beat: number) => number,
  width: number,
  height: number,
  flavor: 'wave' | 'strip'
): void {
  for (const m of ladder.marks) {
    const x = xAt(m.beatR);
    if (x < -4 || x > width) continue;
    const { w, alpha } = ladderLineStyle(m.tier - ladder.baseTier, flavor);
    ctx.fillStyle = m.parenthetical
      ? `rgba(${LADDER_GOLD},${Math.min(1, alpha + 0.12)})`
      : `rgba(255,255,255,${alpha})`;
    ctx.fillRect(x, 0, w, height);
  }
  for (const beatR of ladder.resets) {
    const x = xAt(beatR);
    if (x < -4 || x > width) continue;
    // Left edge = the quantum (the gridline geometry, gh#190 iteration).
    ctx.fillStyle = `rgba(${LADDER_GOLD},0.9)`;
    ctx.fillRect(x, 0, 2, height);
    if (flavor === 'wave') {
      // LEFT-flying pennant at the top edge (cue flags fly right).
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 12);
      ctx.lineTo(x - 7, 6);
      ctx.closePath();
      ctx.fill();
    }
  }
}

/** Styled-run waveform pass (the session timeline's drawStyledRuns,
 * beat-axis flavor): per run, columns sample the run's LINEAR beat→track
 * mapping at integer timeline pixels — LOD-correct and scroll-stable.
 * Columns modulate through the slot's lane state (gh#190 item 11):
 * fader gain scales the body, EQ gains scale their band groups — the
 * session timeline / set ladder's exact ColumnModulation contract
 * (filter excluded, both surfaces' choice). */
function drawSlotWave(
  ctx: CanvasRenderingContext2D,
  wave: DecodedWaveform,
  styleId: string,
  params: import('../waveform/styles').StyleParams,
  runs: BeatRun[],
  modSlot: PlannedRoutineSlot,
  geo: {
    xAt: (beat: number) => number;
    beatAt: (px: number) => number;
    width: number;
    waveH: number;
  }
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
    const xStart = Math.round(cx0);
    const cols = Math.round(cx1) - xStart;
    if (cols <= 0) continue;
    // A HELD span (pause/park — gh#190 iteration two: NO waveform
    // content at all): the deck emits nothing while paused, so the span
    // stays blank — never a stretch-smear or a tiled frame.
    if (run.held) continue;
    const phA = run.ph0 + ((cx0 - rx0) / (rx1 - rx0)) * (run.ph1 - run.ph0);
    const phB = run.ph0 + ((cx1 - rx0) / (rx1 - rx0)) * (run.ph1 - run.ph0);
    const modulate = (x: number): ColumnModulation => {
      const lanes = slotLanesAt(modSlot, geo.beatAt(xStart + x + 0.5));
      return {
        eq: [
          eqValueToGain(lanes.eq.low),
          eqValueToGain(lanes.eq.mid),
          eqValueToGain(lanes.eq.high),
        ],
        scale: Math.min(
          2,
          (channelFaderToGain(lanes.fader) * trimToGain(lanes.trim)) / NOMINAL_SLOT_GAIN
        ),
      };
    };
    const columns = renderer.render(phA, phB, cols, 1, modulate);
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
    if (run.held) continue; // a held frame has no meaningful cue x
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
      // LEFT-ALIGNED pole (gh#190 iteration): the pole's LEFT edge is the
      // quantum, exactly like the gridlines' left-aligned rects — a cue
      // on a beat sits flush on its gridline, not a pixel astride it.
      ctx.fillRect(x, 0, 2, waveH);
      ctx.fillRect(x + 2, 0, flag, flag);
      ctx.fillStyle = 'rgb(17,17,17)';
      ctx.fillText(String(cue.slot_number), x + 2 + flag / 2, flag / 2 + 0.5);
    }
  }
  ctx.textAlign = 'left';
}

/** Recorded lane steps in the editor's strip geometry (gh#190 items 1-3):
 * a step polyline + AREA FILL in the lane's color over the flat strip —
 * fader/EQ fill from the bottom (energy present, the LaneCanvas
 * doctrine), FILTER fills from its CENTER (bipolar) with the hi/lo hue
 * split (HPF above = base, LPF below = warm). EQ/filter strips carry a
 * neutral center guide. The default renders dim when nothing was
 * recorded (the lane plays its default). */
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
  const yOf = (v: number) => geo.stripH - 2 - v * (geo.stripH - 4);
  const bipolar = control === 'filter';
  const centerY = yOf(0.5);

  // Neutral center guide (gh#190 item 1) — EQ/filter rest at center.
  if (control !== 'fader') {
    ctx.fillStyle = 'rgba(255,255,255,0.13)';
    ctx.fillRect(0, centerY, geo.width, 1);
  }

  // Sample the lane per pixel into contiguous spans (pen breaks outside
  // the routine window).
  const spans: { x0: number; ys: number[] }[] = [];
  let cur: { x0: number; ys: number[] } | null = null;
  for (let x = 0; x < geo.width; x++) {
    const beat = geo.scrollBeat + (x + 0.5) / geo.pxPerBeat;
    if (beat < 0 || beat > geo.duration) {
      cur = null;
      continue;
    }
    const lanes = slotLanesAt(slot, beat);
    const v =
      control === 'fader'
        ? lanes.fader
        : control === 'trim'
          ? lanes.trim
          : control === 'filter'
            ? (lanes.filter + 1) / 2
            : lanes.eq[control === 'eqLow' ? 'low' : control === 'eqMid' ? 'mid' : 'high'];
    if (!cur) {
      cur = { x0: x, ys: [] };
      spans.push(cur);
    }
    cur.ys.push(yOf(v));
  }

  const fillAlpha = recorded ? 0.2 : 0.07;
  const strokeAlpha = recorded ? 0.95 : 0.28;
  // Filter hi/lo: the curve/fill above center wears the base color, the
  // below-center (LPF) side the warm one — clip-rect per side.
  const sides: { color: string; clip: [number, number] | null }[] = bipolar
    ? [
        { color, clip: [0, centerY + 0.5] },
        { color: FILTER_LPF_COLOR, clip: [centerY + 0.5, geo.stripH] },
      ]
    : [{ color, clip: null }];

  for (const side of sides) {
    ctx.save();
    if (side.clip) {
      ctx.beginPath();
      ctx.rect(0, side.clip[0], geo.width, side.clip[1] - side.clip[0]);
      ctx.clip();
    }
    // Area fill (gh#190 item 2): to the bottom for fader/EQ, to the
    // center for filter.
    const baseY = bipolar ? centerY + 0.5 : geo.stripH - 1;
    ctx.fillStyle = side.color;
    ctx.globalAlpha = fillAlpha;
    for (const span of spans) {
      ctx.beginPath();
      ctx.moveTo(span.x0, baseY);
      span.ys.forEach((y, i) => ctx.lineTo(span.x0 + i, y));
      ctx.lineTo(span.x0 + span.ys.length - 1, baseY);
      ctx.closePath();
      ctx.fill();
    }
    // Step polyline.
    ctx.strokeStyle = side.color;
    ctx.globalAlpha = strokeAlpha;
    ctx.lineWidth = 1.4;
    for (const span of spans) {
      ctx.beginPath();
      span.ys.forEach((y, i) => {
        if (i === 0) ctx.moveTo(span.x0, y);
        else ctx.lineTo(span.x0 + i, y);
      });
      ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}
