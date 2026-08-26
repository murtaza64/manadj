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
 * Slots are entry-ordered positional roles; their DISPLAY identity is
 * the allocated DECK's accent color (gh#190 iteration — deckColors, the
 * identity every performance surface speaks). THE routine accent
 * (theme/routineColor) stays the boundary/trim token.
 */
import type { RoutineDetailWire } from '../api/client';
import { DECK_COLORS } from '../theme/deckColors';
import { resolveLadder, resolvedMarkTimes, type PersistedLadder } from '../meter/ladder';
import type { BeatgridData } from '../types';
import type { BeatRun } from './routineWaveRuns';
import { parseEdits, type RoutineEdits } from './routineDraft';
import {
  buildPlannedRoutine,
  type BuildRoutineContext,
  type PlannedRoutine,
  type RoutineBuildWarning,
  type RoutinePlanInput,
} from '../sets/routinePlan';

// ── Slot identity: DECK accent colors (gh#190 iteration) ────────────────
//
// The original doctrine gave slots their own rotating palette ("slots are
// roles, not decks"). Walkthrough verdict: the DECK accents (A/B/C/D —
// theme/deckColors, the identity every performance surface speaks) read
// better — a slot wears its ALLOCATED deck's color; reused decks share
// one color on purpose. Overflow (no deck) wears neutral grey.

const NO_DECK_COLOR = '#8a8a96';

export function slotAccent(deck: 'A' | 'B' | 'C' | 'D' | null | undefined): string {
  return deck ? DECK_COLORS[deck] : NO_DECK_COLOR;
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

export type SlotLaneControl = 'fader' | 'trim' | 'eqLow' | 'eqMid' | 'eqHigh' | 'filter';
export const SLOT_LANE_ORDER: SlotLaneControl[] = [
  // The pair editor's away-from-the-wave order (deck B's stack): FADER at
  // the wave seam, FILTER at the outer edge.
  'fader',
  'trim',
  'eqLow',
  'eqMid',
  'eqHigh',
  'filter',
];

/** Terse strip labels — the pair editor's LANE_LABELS vocabulary. */
export const SLOT_LANE_LABELS: Record<SlotLaneControl, string> = {
  fader: 'FADER',
  trim: 'TRIM',
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

export function slotLaneColors(
  deck: 'A' | 'B' | 'C' | 'D' | null | undefined
): Record<SlotLaneControl, string> {
  return {
    fader: slotAccent(deck), // the deck accent — fader ONLY (gh#190)
    trim: '#c9c9d4', // neutral silver — gain plumbing, not identity
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

// ── Recorded pause list (gh#190: play/pause events, jump idiom) ─────────

export interface RecordedPause {
  /** Routine beat the hold starts. */
  beat: number;
  /** Routine beat motion resumes. */
  endBeat: number;
}

/** A slot's recorded INTERIOR holds — spans where the deck paused between
 * motion (the pre-entry park and a trailing stop are boundaries, not
 * pauses). A SEEK during a hold (a jump point inside the span, gh#190
 * design pass) SPLITS it: hold + jump + hold — each piece is its own
 * marker, independently removable, and the seek keeps its own jump
 * marker; the two sides of the pause stay independently editable. The
 * pause markers' model, raw-trace provenance (ghosts keep their place
 * once removed, like recorded jumps). */
export function recordedPauses(trace: {
  beat: number;
  moving: boolean;
  jump: boolean;
}[]): RecordedPause[] {
  const out: RecordedPause[] = [];
  let seenMotion = false;
  for (let i = 0; i < trace.length; i++) {
    const p = trace[i];
    if (p.moving) {
      seenMotion = true;
      continue;
    }
    if (!seenMotion) continue; // pre-entry park
    // The hold runs until motion resumes OR a seek splits it.
    let k = i + 1;
    while (k < trace.length && !trace[k].moving && !trace[k].jump) k++;
    if (k >= trace.length) break; // trailing stop
    if (trace[k].beat - p.beat > 1e-6) {
      out.push({ beat: p.beat, endBeat: trace[k].beat });
    }
    i = k - 1;
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
  const minTier = ladderBaseTier(pxPerBeat, ROUTINE_TIER_BARS, minSpacingPx);
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

// ── Per-track Metric ladders on the slot rows (gh#190 iteration) ─────────
//
// The routine-clock duple grid above is an INFERENCE (beat 0 = a
// downbeat, straight 4/4 forever) — kept only for the ruler and as the
// gridless fallback. The slot rows render each track's REAL Metric
// ladder (meter/ladder.ts — persisted arities + Reset marks applied),
// projected from track time onto the routine clock through the slot's
// replay trace runs: the same mapping the waveform columns use, so a
// gridline always sits on the audio it grids.

/** One cast track's resolved meter, ready to project through runs. */
export interface TrackMeter {
  /** beat_times (downbeats are exact members — the grid contract). */
  beats: number[];
  /** Downbeat time → ladder tier + parenthetical flag + bar ordinal
   * within its governing segment (Reset-aware). */
  downs: Map<number, { tier: number; parenthetical: boolean; barIndex: number }>;
  /** Downbeat times, ascending (the lattice the map is keyed on). */
  downbeats: number[];
  /** Reset marks resolved onto the downbeat lattice (track seconds). */
  resetMarks: number[];
  /** Bars per tier-k group, from the projection (arity-aware). */
  tierBars: readonly number[];
  /** Bars per TOP-tier group (the phrase the global count runs on). */
  topBars: number;
}

/** Resolve a track's meter for the editor; null = gridless (the routine-
 * clock fallback grid draws instead). */
export function buildTrackMeter(
  grid: BeatgridData | null,
  ladder: PersistedLadder | null
): TrackMeter | null {
  const proj = resolveLadder(grid, ladder);
  if (!proj || !grid || grid.beat_times.length === 0) return null;
  const downs = new Map<number, { tier: number; parenthetical: boolean; barIndex: number }>();
  grid.downbeat_times.forEach((t, i) => {
    downs.set(t, {
      tier: proj.tiers[i] ?? 0,
      parenthetical: proj.parentheticals[i] ?? false,
      barIndex: proj.barIndexes[i] ?? 0,
    });
  });
  return {
    beats: grid.beat_times,
    downs,
    downbeats: grid.downbeat_times,
    resetMarks: resolvedMarkTimes(grid, ladder),
    tierBars: proj.tierBars,
    topBars: proj.tierBars[proj.tierBars.length - 1] ?? 16,
  };
}

export interface LadderMark {
  /** Routine beat (the timeline's axis). */
  beatR: number;
  /** −1 = weak beat; else the downbeat's ladder tier. */
  tier: number;
  /** "Extra" bar (metric-ladder 03) — tints gold. */
  parenthetical: boolean;
}

export interface SlotLadderMarks {
  marks: LadderMark[];
  /** Reset marks, in routine beats. */
  resets: number[];
  /** Lowest visible level (relative-thinning base — see GridTicksResult). */
  baseTier: number;
}

function lowerBound(arr: readonly number[], t: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The lowest DRAWABLE tier at a zoom (the culling loop shared by the
 * routine-clock grid, the slot ladders, and the global ladder). */
export function ladderBaseTier(
  pxPerBeat: number,
  tierBars: readonly number[],
  minSpacingPx = 24
): number {
  const pxPerBar = pxPerBeat * BEATS_PER_BAR;
  for (let k = 0; k < tierBars.length; k++) {
    if (pxPerBar * tierBars[k] >= minSpacingPx) return k;
  }
  return tierBars.length;
}

/**
 * Project a slot's track meter through its draw runs onto the routine
 * clock. Density/thinning decisions ride the ROUTINE-clock pxPerBeat
 * (replay is beatmatched, so one track beat ≈ one routine beat): weak
 * beats from 12 px/beat, each tier needs `minSpacingPx` of its own
 * spacing (bars drop out too — gh#190), styling relative to `baseTier`.
 * Frozen runs (paused frame) carry no gridlines.
 */
export function slotLadderMarks(
  meter: TrackMeter,
  runs: BeatRun[],
  pxPerBeat: number,
  minSpacingPx = 24
): SlotLadderMarks {
  const showWeak = pxPerBeat >= 12;
  const minTier = ladderBaseTier(pxPerBeat, meter.tierBars, minSpacingPx);
  const baseTier = showWeak ? -1 : minTier;
  const out: SlotLadderMarks = { marks: [], resets: [], baseTier };
  if (minTier >= meter.tierBars.length && !showWeak) return out;
  for (const run of runs) {
    const span = run.ph1 - run.ph0;
    if (run.held || span <= 1e-9) continue; // a held frame plays no lattice
    const toBeatR = (t: number) =>
      run.b0 + ((t - run.ph0) / span) * (run.b1 - run.b0);
    for (let i = lowerBound(meter.beats, run.ph0); i < meter.beats.length; i++) {
      const t = meter.beats[i];
      if (t > run.ph1) break;
      const d = meter.downs.get(t);
      if (!d) {
        if (showWeak) out.marks.push({ beatR: toBeatR(t), tier: -1, parenthetical: false });
        continue;
      }
      if (d.tier < minTier) continue;
      out.marks.push({ beatR: toBeatR(t), tier: d.tier, parenthetical: d.parenthetical });
    }
    for (const m of meter.resetMarks) {
      if (m >= run.ph0 && m <= run.ph1) out.resets.push(toBeatR(m));
    }
  }
  return out;
}

// ── The GLOBAL ladder (gh#190 iteration) ─────────────────────────────────
//
// The mix's own hypermeter, on the routine clock: anchored on track 0's
// ladder, then GOVERNED by whichever slot is still carrying its recorded
// motion — ties break by first entry (slot order IS entry order). At a
// governance handoff the incoming track's ladder is adopted; when its
// phrase phase disagrees with the running count, the ladder DERIVES a
// meter reset at the incoming's next phrase boundary and flags the
// leftover bars parenthetical (gold) — an extra bar played between one
// track's exit and the next drop reads at a glance, even though no
// source track carries a Reset mark there.

export interface ProjectedDownbeat {
  beatR: number;
  tier: number;
  parenthetical: boolean;
  /** Bar ordinal within the track's own governing segment (Reset-aware). */
  barIndex: number;
}

/** ALL of a slot's downbeats (and source Reset marks) projected through
 * its runs onto the routine clock — no zoom culling (the global ladder's
 * feed; culling happens at draw). */
export function slotDownbeatMarks(
  meter: TrackMeter,
  runs: BeatRun[]
): { downs: ProjectedDownbeat[]; resets: number[] } {
  const downs: ProjectedDownbeat[] = [];
  const resets: number[] = [];
  for (const run of runs) {
    const span = run.ph1 - run.ph0;
    if (run.held || span <= 1e-9) continue;
    const toBeatR = (t: number) =>
      run.b0 + ((t - run.ph0) / span) * (run.b1 - run.b0);
    for (
      let i = lowerBound(meter.downbeats, run.ph0);
      i < meter.downbeats.length;
      i++
    ) {
      const t = meter.downbeats[i];
      if (t > run.ph1) break;
      const d = meter.downs.get(t)!;
      downs.push({ beatR: toBeatR(t), ...d });
    }
    for (const m of meter.resetMarks) {
      if (m >= run.ph0 && m <= run.ph1) resets.push(toBeatR(m));
    }
  }
  return { downs, resets };
}

export interface GlobalLadderMark {
  beatR: number;
  tier: number;
  /** Extra bar (derived or source) — tints gold. */
  parenthetical: boolean;
}

export interface GlobalLadder {
  /** Downbeats only, ascending, deduped at handoffs. */
  marks: GlobalLadderMark[];
  /** Reset guides (routine beats): source-track marks AND derived ones. */
  resets: number[];
}

export interface GovernorSpan {
  /** Index into the parallel downbeat-marks array (slot order). */
  slot: number;
  entryBeat: number;
  releaseBeat: number;
}

const HANDOFF_EPS_BEATS = 0.6;

/**
 * Build the global ladder. `spans` in slot (= entry) order; `downsBySlot`
 * parallel (null = gridless slot — skipped for governance). The governor
 * at beat b is the FIRST slot with entry ≤ b < release; when it releases,
 * the next takes over. Seamless handoffs (incoming phrase phase agrees
 * with the running count) adopt the incoming ladder silently; phase
 * breaks derive a reset at the incoming's next phrase boundary, with the
 * in-between bars flattened to plain parenthetical bars.
 */
export function buildGlobalLadder(
  spans: GovernorSpan[],
  downsBySlot: (ProjectedDownbeat[] | null)[],
  resetsBySlot: (number[] | null)[],
  topBarsBySlot: (number | null)[],
  durationBeats: number
): GlobalLadder {
  const usable = spans.filter((s) => (downsBySlot[s.slot] ?? null) !== null);
  const marks: GlobalLadderMark[] = [];
  const resets: number[] = [];
  if (usable.length === 0) return { marks, resets };

  // Governance segments over [0, duration]: breakpoints at every entry
  // and release of a usable slot.
  const cuts = [
    ...new Set(
      usable
        .flatMap((s) => [s.entryBeat, s.releaseBeat])
        .concat([0, durationBeats])
        .filter((b) => b >= 0 && b <= durationBeats)
        .map((b) => Math.round(b * 1e6) / 1e6)
    ),
  ].sort((a, b) => a - b);
  const governorAt = (b: number): GovernorSpan | null =>
    usable.find((s) => b >= s.entryBeat - 1e-6 && b < s.releaseBeat - 1e-6) ?? null;

  let prevGov: GovernorSpan | null = null;
  /** The previous segment's LAST global downbeat (running-count probe). */
  let lastMark: { beatR: number; barIndex: number } | null = null;
  for (let c = 0; c < cuts.length - 1; c++) {
    const s0 = cuts[c];
    const s1 = cuts[c + 1];
    if (s1 - s0 <= 1e-6) continue;
    const gov = governorAt(s0 + 1e-6);
    if (!gov) continue;
    const downs = (downsBySlot[gov.slot] ?? []).filter(
      (d) => d.beatR >= s0 - 1e-6 && d.beatR < s1 - 1e-6
    );
    for (const r of resetsBySlot[gov.slot] ?? []) {
      if (r >= s0 - 1e-6 && r < s1 - 1e-6) resets.push(r);
    }
    if (downs.length === 0) {
      prevGov = gov;
      continue;
    }
    const topBars = topBarsBySlot[gov.slot] ?? 16;
    // Handoff phase check (a NEW governor, with a running count behind).
    let derivedFrom: number | null = null; // flatten-to-parenthetical start
    if (prevGov && prevGov.slot !== gov.slot && lastMark) {
      const d0 = downs[0];
      // Expected phase: the running count continued bar by bar. The gap
      // between the last outgoing downbeat and the first incoming one is
      // measured in GLOBAL bars (beatmatched ⇒ ~4 routine beats per bar).
      const barsGap = Math.max(
        1,
        Math.round((d0.beatR - lastMark.beatR) / BEATS_PER_BAR)
      );
      const expected = (lastMark.barIndex + barsGap) % topBars;
      if (d0.barIndex % topBars !== expected) {
        // Phase break: derive a reset at the incoming's next phrase
        // boundary; bars before it are the mix's own "extra" bars.
        const boundary = downs.find((d) => d.barIndex % topBars === 0);
        if (boundary && boundary.beatR > d0.beatR - 1e-6) {
          derivedFrom = d0.beatR;
          resets.push(boundary.beatR);
        }
      }
    }
    for (const d of downs) {
      // Dedupe a handoff downbeat coinciding with the previous mark.
      if (marks.length > 0 && d.beatR - marks[marks.length - 1].beatR < HANDOFF_EPS_BEATS) {
        continue;
      }
      const inDerived =
        derivedFrom !== null &&
        d.beatR >= derivedFrom - 1e-6 &&
        d.barIndex % topBars !== 0;
      marks.push({
        beatR: d.beatR,
        tier: inDerived ? 0 : d.tier,
        parenthetical: d.parenthetical || inDerived,
      });
      if (inDerived === false && derivedFrom !== null && d.barIndex % topBars === 0) {
        derivedFrom = null; // the derived reset landed — normal count resumes
      }
    }
    lastMark = downs[downs.length - 1];
    prevGov = gov;
  }
  resets.sort((a, b) => a - b);
  return { marks, resets };
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
