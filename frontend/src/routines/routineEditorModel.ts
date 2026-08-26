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

// ── Slot lane color families (gh#190 items 1/3: accent = FADER only) ────
//
// The pair editor's laneColors doctrine (mix-editor 32/39, #59) gave
// every lane a per-identity hue. The routine editor walkthrough (gh#190)
// tightened it: the slot ACCENT is reserved for the FADER lane alone —
// slot identity rides the fader strip and the slot chip. EQ bands wear
// the plain RGB triad (LOW red, MID green, HIGH blue — no per-slot
// tilt: with n slots the tilts read as noise, not identity), and FILTER
// wears ONE consistent color everywhere, with a hi/lo (HPF above
// center / LPF below) hue distinction at draw time.

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
 * MID green, HIGH blue) — plain, no per-slot tilt (gh#190 item 3). */
const EQ_TRIAD: Record<'eqLow' | 'eqMid' | 'eqHigh', string> = {
  eqLow: '#ff2d2d',
  eqMid: '#2dff6a',
  eqHigh: '#3d6aff',
};

/** THE filter color — one hue on every slot (gh#190 item 3): labels,
 * edges, toggles, and the HPF (above-center) side of the curve. */
export const FILTER_COLOR = '#00ffc4';
/** The LPF (below-center) side of the filter curve — warm against the
 * cool base, so hi/lo reads at a glance. */
export const FILTER_LPF_COLOR = '#ff8a00';

export function slotLaneColors(slot: number): Record<SlotLaneControl, string> {
  return {
    fader: slotColor(slot), // the slot accent — fader ONLY (gh#190)
    eqLow: EQ_TRIAD.eqLow,
    eqMid: EQ_TRIAD.eqMid,
    eqHigh: EQ_TRIAD.eqHigh,
    filter: FILTER_COLOR,
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
  /** Metric-ladder tier of the beat (gh#190 item 7, walkthrough round 2:
   * CONSISTENT WEIGHT with every other view): −1 = weak beat, 0 = bar …
   * 4 = 16-bar boundary — the duple default ladder anchored on beat 0
   * (the routine clock has no persisted ladder; the window opens on a
   * downbeat by the promotion contract). */
  tier: number;
}

const LABEL_STEPS = [1, 2, 4, 8, 16, 32, 64, 128, 256];

/** Bars per tier-k group under the duple default (meter/ladder's
 * tierBars): [bar, 2-bar, 4-bar, 8-bar, 16-bar]. */
export const ROUTINE_TIER_BARS: readonly number[] = [1, 2, 4, 8, 16];
const BEATS_PER_BAR = 4;

/** Metric-ladder tier of a routine beat (beat 0 anchors the ladder):
 * −1 = weak beat; else the highest tier whose group the bar opens. */
export function ladderTier(beat: number): number {
  if (beat % BEATS_PER_BAR !== 0) return -1;
  const bar = beat / BEATS_PER_BAR;
  let tier = 0;
  for (let k = ROUTINE_TIER_BARS.length - 1; k > 0; k--) {
    if (bar % ROUTINE_TIER_BARS[k] === 0) {
      tier = k;
      break;
    }
  }
  return tier;
}

export interface GridTick {
  beat: number;
  /** −1 = weak beat, 0…4 = bar tier (ladderTier). */
  tier: number;
}

export interface GridTicksResult {
  ticks: GridTick[];
  /** The lowest VISIBLE level at this zoom: −1 when weak beats show,
   * else the lowest drawable tier. Styling is RELATIVE to it (gh#190
   * iteration): the lowest visible level always wears the weak-beat
   * (thinnest) style and tiers above escalate from there — zooming out
   * hides lower tiers AND re-thins the survivors, so a zoomed-out view
   * never reads as a wall of thick lines. */
  baseTier: number;
}

/** Gridline ticks for the timeline canvases — WaveformRendererV2's
 * density RULES at the routine editor's own threshold (gh#190 iteration:
 * hide lower tiers as the view zooms out, transition-editor feel): weak
 * beats show from 12 px/beat; each ladder tier draws only when its OWN
 * spacing clears `minSpacingPx` — and that includes tier 0, so BARS drop
 * out too once a whole routine is squeezed into the view (the renderer's
 * 2.5px cutoff suits second-scale windows; a 500-beat fit needs breathing
 * room, not a line forest). Weights stay the shared TIER_* scheme,
 * indexed relative to `baseTier`.
 * May extend past [0, duration] (the audition margin shows). */
export function gridTicks(
  viewStartBeat: number,
  viewEndBeat: number,
  pxPerBeat: number,
  minSpacingPx = 24
): GridTicksResult {
  if (pxPerBeat <= 0) return { ticks: [], baseTier: -1 };
  const showWeak = pxPerBeat >= 12;
  const pxPerBar = pxPerBeat * BEATS_PER_BAR;
  let minTier = ROUTINE_TIER_BARS.length;
  for (let k = 0; k < ROUTINE_TIER_BARS.length; k++) {
    if (pxPerBar * ROUTINE_TIER_BARS[k] >= minSpacingPx) {
      minTier = k;
      break;
    }
  }
  const baseTier = showWeak ? -1 : minTier;
  const out: GridTick[] = [];
  if (minTier >= ROUTINE_TIER_BARS.length && !showWeak) {
    return { ticks: out, baseTier };
  }
  const step = showWeak ? 1 : BEATS_PER_BAR * ROUTINE_TIER_BARS[Math.min(minTier, 4)];
  const first = Math.floor(viewStartBeat / step) * step;
  for (let b = first; b <= viewEndBeat; b += step) {
    const tier = ladderTier(b);
    if (tier < 0 && !showWeak) continue;
    if (tier >= 0 && tier < minTier) continue;
    out.push({ beat: b, tier });
  }
  return { ticks: out, baseTier };
}

/** Beat-domain ruler ticks for a view window. Major (labelled) ticks land
 * on the smallest power-of-two-ish beat step whose spacing clears
 * `minLabelPx`; minors quarter it (floor 1 beat). Every tick also carries
 * its ladder tier (gh#190 item 7). */
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
    ticks.push({
      beat: b,
      major,
      label: major ? String(b) : undefined,
      tier: ladderTier(b),
    });
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
