/**
 * Routine editor view model (gh#170) — pure math between the Routine wire
 * shape and the editor surface.
 *
 * The editor's time axis IS the Routine clock: beat 0 = window start,
 * durationBeats = window end. Rendering and audition both go through the
 * replay engine's own evaluators (routinePlan.ts — buildPlannedRoutine /
 * traceStateAt / slotLanesAt), built here with an editor context: mix
 * second 0 at beat 0, slot 0 on deck A, no external occupants. What the
 * editor shows is exactly what the Conductor would replay — the same
 * PlannedRoutine, minus the Set around it.
 *
 * Slots are entry-ordered positional roles, not decks: the C-A-B-D deck
 * color conventions deliberately do NOT apply. Slots get their own
 * scheme, anchored on THE routine accent (theme/routineColor — one token
 * for every Routine surface) and rotating bright hues from there.
 */
import type { RoutineDetailWire } from '../api/client';
import { ROUTINE_ACCENT } from '../theme/routineColor';
import { parseEdits, type RoutineEdits } from './routineDraft';
import {
  buildPlannedRoutine,
  type BuildRoutineContext,
  type PlannedRoutine,
  type RoutineBuildWarning,
  type RoutinePlanInput,
} from '../sets/routinePlan';

// ── Slot identity ────────────────────────────────────────────────────────

/** Entry-ordered slot palette (bright, fully saturated — house rule).
 * Slot 0 carries THE routine accent; hues rotate from there. */
export const SLOT_COLORS = [
  ROUTINE_ACCENT, // slot 0 — THE routine accent (entry / boundary anchor)
  '#ffb521', // amber
  '#2bff7e', // green
  '#31c8ff', // cyan
  '#b06bff', // violet
  '#ff5c39', // orange-red
  '#ff3fd4', // magenta (freed by the accent change)
  '#7dffe4', // mint
] as const;

export function slotColor(slot: number): string {
  return SLOT_COLORS[slot % SLOT_COLORS.length];
}

/** rgba() of a slot color at an alpha (colors above are #rrggbb). */
export function slotColorRgba(slot: number, alpha: number): string {
  const hex = slotColor(slot);
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ── Slot lane color families (pass 2: EXTEND the pair editor's palette) ──
//
// The pair editor's laneColors doctrine (mix-editor 32/39, #59): the
// FADER lane IS the identity anchor; FILTER wears the anchor rotated
// −20° ("the deck's own color, shifted"); the EQ bands are one RGB triad
// hue-tilted a small per-identity amount so identities stay tellable
// apart. Slots inherit exactly that rule with the slot color as anchor
// and a per-slot triad tilt — no invented scheme.

function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return [h, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  const to = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

function rotateHue(hex: string, deg: number): string {
  const [h, s, l] = hexToHsl(hex);
  return hslToHex(h + deg, s, l);
}

export type SlotLaneControl = 'fader' | 'eqLow' | 'eqMid' | 'eqHigh' | 'filter';
export const SLOT_LANE_ORDER: SlotLaneControl[] = [
  // The pair editor's away-from-the-wave order (deck B's stack): FADER at
  // the wave seam, FILTER at the outer edge.
  'fader',
  'eqLow',
  'eqMid',
  'eqHigh',
  'filter',
];

/** Terse strip labels — the pair editor's LANE_LABELS vocabulary. */
export const SLOT_LANE_LABELS: Record<SlotLaneControl, string> = {
  fader: 'FADER',
  eqLow: 'LOW',
  eqMid: 'MID',
  eqHigh: 'HIGH',
  filter: 'FILTER',
};

/** The RGB triad the pair editor's EQ lanes share (laneColors: LOW red,
 * MID green, HIGH blue), before the per-identity tilt. */
const EQ_TRIAD: Record<'eqLow' | 'eqMid' | 'eqHigh', string> = {
  eqLow: '#ff2d2d',
  eqMid: '#2dff6a',
  eqHigh: '#3d6aff',
};

export function slotLaneColors(slot: number): Record<SlotLaneControl, string> {
  const anchor = slotColor(slot);
  // Small per-slot triad tilt (A/B use ∓25°): spread slots across
  // −18°…+30° so neighboring slots' EQ hues stay tellable apart.
  const tilt = (slot % 5) * 12 - 18;
  return {
    fader: anchor,
    eqLow: rotateHue(EQ_TRIAD.eqLow, tilt),
    eqMid: rotateHue(EQ_TRIAD.eqMid, tilt),
    eqHigh: rotateHue(EQ_TRIAD.eqHigh, tilt),
    filter: rotateHue(anchor, -20),
  };
}

// ── Recorded jump list (view + future edit surface) ─────────────────────

export interface RecordedJump {
  /** Routine beat of the discontinuity (the landing instant). */
  beat: number;
  /** Track-seconds displacement: landing pos − ridden-out pos. */
  deltaSec: number;
}

/** A slot's recorded discontinuities with their displacements — the jump
 * markers' model (the pair editor's jump idiom, recorded flavor). */
export function recordedJumps(trace: {
  beat: number;
  pos: number;
  jump: boolean;
  moving: boolean;
  ratePerBeat: number;
}[]): RecordedJump[] {
  const out: RecordedJump[] = [];
  for (let i = 1; i < trace.length; i++) {
    const q = trace[i];
    if (!q.jump) continue;
    const p = trace[i - 1];
    const ride = p.pos + (p.moving ? p.ratePerBeat * (q.beat - p.beat) : 0);
    out.push({ beat: q.beat, deltaSec: q.pos - ride });
  }
  return out;
}

// ── Wire → replay input ──────────────────────────────────────────────────

/** Snake→camel into THE replay seam (the same mapping useSetPlan feeds
 * the planner — one wire shape, one seam). `editsOverride` lets the
 * editor feed its LIVE draft instead of the persisted layer. */
export function wireRoutineToPlanInput(
  detail: {
    cast: number[];
    entry_offsets_beats: number[];
    entry_positions: number[];
    duration_beats: number;
    events: Record<string, unknown>[];
    edits?: Record<string, unknown> | null;
  },
  editsOverride?: RoutineEdits | null
): RoutinePlanInput {
  return {
    cast: detail.cast,
    entryOffsetsBeats: detail.entry_offsets_beats,
    entryPositions: detail.entry_positions,
    durationBeats: detail.duration_beats,
    events: detail.events,
    edits: editsOverride !== undefined ? editsOverride : detail.edits ? parseEdits(detail.edits) : null,
  };
}

// ── The editor build ─────────────────────────────────────────────────────

export interface EditorRoutine {
  planned: PlannedRoutine;
  warnings: RoutineBuildWarning[];
  input: RoutinePlanInput;
  detail: RoutineDetailWire;
}

/**
 * Build the editor's PlannedRoutine: beat 0 ≡ mix second 0, slot 0 adopts
 * deck A (there is no upstream Set here — the editor IS the context), no
 * busy decks. `targetBpm` defaults to slot 0's native BPM (the Riding
 * policy's choice — the recording at its own feel); the tempo control
 * re-builds at any rate and everything re-anchors, beat-domain doctrine.
 */
export function buildEditorRoutine(
  detail: RoutineDetailWire,
  trackBpms: number[],
  targetBpm: number,
  editsOverride?: RoutineEdits | null
): EditorRoutine {
  const input = wireRoutineToPlanInput(detail, editsOverride);
  const ctx: BuildRoutineContext = {
    startEntryIndex: 0,
    mixStartSec: 0,
    targetBpm,
    adoptedDeck: 'A',
    busy: [],
    trackBpms,
  };
  const { routine, warnings } = buildPlannedRoutine(input, ctx);
  return { planned: routine, warnings, input, detail };
}

// ── Beat ruler ───────────────────────────────────────────────────────────

export interface RulerTick {
  beat: number;
  /** Major ticks carry a label; minor ticks are grid only. */
  major: boolean;
  label?: string;
}

const LABEL_STEPS = [1, 2, 4, 8, 16, 32, 64, 128, 256];

/** Beat-domain ruler ticks for a view window. Major (labelled) ticks land
 * on the smallest power-of-two-ish beat step whose spacing clears
 * `minLabelPx`; minors quarter it (floor 1 beat). */
export function rulerTicks(
  viewStartBeat: number,
  viewEndBeat: number,
  pxPerBeat: number,
  minLabelPx = 56
): RulerTick[] {
  const step = LABEL_STEPS.find((s) => s * pxPerBeat >= minLabelPx) ?? 256;
  const minor = Math.max(1, step / 4);
  const ticks: RulerTick[] = [];
  const first = Math.max(0, Math.floor(viewStartBeat / minor) * minor);
  for (let b = first; b <= viewEndBeat; b += minor) {
    const major = b % step === 0;
    ticks.push({ beat: b, major, label: major ? String(b) : undefined });
  }
  return ticks;
}

/** "12.3" — beats with one decimal, for transport readouts. */
export function beatLabel(beat: number): string {
  return beat.toFixed(1);
}

/** "1:23.4" from seconds, for the secondary time readout. */
export function secondsLabel(sec: number): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest < 10 ? '0' : ''}${rest.toFixed(1)}`;
}
