/**
 * Transition-template domain model (pure — under vitest).
 *
 * A template is a beat-domain RECIPE (ADR 0010 Amendment 2; anchor model
 * reworked 2026-07-04 #2, issue 28) in two parts:
 *
 * - The ALIGNMENT RULE: B's anchor (a cue slot or the grid origin) lands
 *   on A's anchor plus a single whole-beat delta on A's grid — "B's cue 2
 *   lines up with A's cue 4 + 8 beats". B's anchor is the musical
 *   reference of the move, typically B's mix-in landmark.
 * - The WINDOW: whole beats before/after the alignment instant. Free-
 *   signed (the anchor may sit outside the window); total ≥ 0, zero being
 *   a hard cut at the anchor.
 *
 * Applying translates beats → seconds via the tempo-matched beatgrids and
 * yields ordinary seconds-based Transition fields — the recipe never
 * survives into the model (no provenance).
 *
 * Resolution never guesses silently: every fallback and clamp produces a
 * one-line notice; anchoring is all-or-nothing across the pair (a partial
 * alignment would be silently broken).
 */
import type { BeatgridData } from '../types';
import { dominantBpm } from '../components/deckControls/bpmCommit';
import { defaultLanePoints } from './mixModel';
import type { LaneId, LanePoint, Lanes, Transition } from './mixModel';
import { freshTransition, isPristine } from './pairStore';
import type { SavedTransition } from './pairStore';

export type AnchorBase =
  | 'cue_1'
  | 'cue_2'
  | 'cue_3'
  | 'cue_4'
  | 'cue_5'
  | 'cue_6'
  | 'cue_7'
  | 'cue_8'
  | 'grid_origin';

export interface TransitionTemplate {
  uuid: string;
  name: string;
  /** Alignment rule: B's `alignBBase` lands on A's `alignABase` +
   * `deltaBeats` (whole beats, A's grid — under tempo-match beats are the
   * shared currency, so one delta carries the whole relative shift). */
  alignABase: AnchorBase;
  deltaBeats: number;
  alignBBase: AnchorBase;
  /** Window around the alignment instant, whole beats on the mix axis.
   * Free-signed; `beforeBeats + afterBeats ≥ 0` (zero = hard cut at the
   * anchor). */
  beforeBeats: number;
  afterBeats: number;
  /** Scalable templates take an apply-time TOTAL beat count (default
   * before+after) and split it proportionally — the anchor keeps its
   * relative position in the window. */
  scalable: boolean;
  /** Sparse normalized lanes: only lanes the author gave meaningful
   * content (hidden and untouched-default lanes are stripped at save). */
  lanes: Lanes;
}

/** What anchor resolution needs to know about one side of the pair. */
export interface TrackSideInfo {
  beatgrid: BeatgridData | null;
  hotCues: { slot: number; timeSec: number }[];
}

// ── Beat math ───────────────────────────────────────────────────────────

/** Seconds per beat of the grid's DOMINANT tempo (ADR 0027 §4 doctrine:
 * tempo-domain features treat a variable track as its dominant tempo —
 * shared helper, not the first segment). The grid's last beat time stands
 * in for the duration weighting; without beats the first tempo change is
 * the fallback (dominantBpm's own degradation). */
export function beatPeriodSec(grid: BeatgridData): number {
  const duration = grid.beat_times.length
    ? grid.beat_times[grid.beat_times.length - 1]
    : null;
  return 60 / dominantBpm(grid.tempo_changes, duration);
}

/**
 * GRID ORIGIN (glossary): the track's true first downbeat — the earliest
 * downbeat after extending the first tempo segment backward in whole
 * beats while the extrapolated position stays ≥ −ε, carrying bar phase
 * backward. Corrects grids whose first mark lands a beat or more after
 * the actual first downbeat (the off-by-one-bar trap: true downbeat at
 * t≈0, first grid mark on beat 2). ε = min(50ms, period/4) — enough for
 * jitter at track start, too tight to hallucinate a beat that lives
 * mostly before the audio.
 */
export function gridOriginSec(grid: BeatgridData): number {
  const tc = grid.tempo_changes[0];
  // The FIRST segment's own period: the origin extends the first segment
  // backward — the dominant tempo (beatPeriodSec) may belong to a later one.
  const period = 60 / tc.bpm;
  const sig = tc.time_signature_num;
  const eps = Math.min(0.05, period / 4);
  // How many whole beats fit backward from the first mark.
  const back = Math.max(0, Math.floor((tc.start_time + eps) / period));
  const extendedStart = tc.start_time - back * period;
  // Bar position of the extended first beat (1..sig).
  const pos = ((((tc.bar_position - 1 - back) % sig) + sig) % sig) + 1;
  // First downbeat at or after the extended start.
  const beatsToDownbeat = (sig + 1 - pos) % sig;
  return extendedStart + beatsToDownbeat * period;
}

// ── Cue-slot convention (glossary) ──────────────────────────────────────
// The ladder into the drop: 4 = drop (the firmest rung), 3 = 8 bars
// before 4, 2 = 8 bars before 3, 1 = typically 16 bars before 2. Slots
// 5–8 carry no convention. Expressed in beats from the grid origin — the
// absolute positions double as the last-resort heuristic table.

export const LADDER_BEATS: Partial<Record<number, number>> = {
  1: 0,
  2: 64,
  3: 96,
  4: 128,
};

function cueSlot(base: AnchorBase): number | null {
  return base === 'grid_origin' ? null : Number(base.slice(4));
}

export interface ResolvedAnchor {
  sec: number;
  /** Present when a fallback substituted for missing data. */
  notice?: string;
}

/**
 * Resolve an anchor base to a track-local time. The fallback chain for a
 * missing ladder cue: relative resolution from the nearest SET ladder
 * slot (ties break toward the firmer/higher rung), then the absolute
 * convention position from the grid origin. Convention-less slots (5–8)
 * and grid-less fallbacks return null — unresolvable.
 */
export function resolveAnchorBase(
  base: AnchorBase,
  side: TrackSideInfo,
  label: 'A' | 'B'
): ResolvedAnchor | null {
  const slot = cueSlot(base);
  if (slot === null) {
    if (!side.beatgrid) return null;
    return { sec: gridOriginSec(side.beatgrid) };
  }

  const cue = side.hotCues.find((c) => c.slot === slot);
  if (cue) return { sec: cue.timeSec };

  // Fallbacks are beat-domain: they need the grid and a ladder position.
  const target = LADDER_BEATS[slot];
  if (target === undefined || !side.beatgrid) return null;
  const period = beatPeriodSec(side.beatgrid);

  // Relative: nearest set ladder slot, ties toward the higher rung.
  const setLadder = side.hotCues
    .filter((c) => LADDER_BEATS[c.slot] !== undefined)
    .sort((p, q) => {
      const dp = Math.abs(LADDER_BEATS[p.slot]! - target);
      const dq = Math.abs(LADDER_BEATS[q.slot]! - target);
      return dp !== dq ? dp - dq : q.slot - p.slot;
    });
  const ref = setLadder[0];
  if (ref) {
    const deltaBeats = target - LADDER_BEATS[ref.slot]!;
    const bars = Math.abs(deltaBeats) / 4;
    return {
      sec: ref.timeSec + deltaBeats * period,
      notice: `cue ${slot} missing on ${label} — derived from cue ${ref.slot} (${
        deltaBeats < 0 ? '−' : '+'
      }${bars} bars)`,
    };
  }

  // Absolute last resort: the convention position from the grid origin.
  return {
    sec: gridOriginSec(side.beatgrid) + target * period,
    notice: `cue ${slot} missing on ${label} — used convention position (beat ${target})`,
  };
}

// ── Apply ───────────────────────────────────────────────────────────────

/** The seconds-based fields a template application stamps. Anchor and
 * duration fields are absent when their inputs could not resolve —
 * partial application always proceeds (lanes/tempo-match at minimum). */
export interface ApplyPatch {
  tempoMatch: true;
  lanes: Lanes;
  /** Cleared: the stamped recipe has no dismissed lanes. */
  hiddenLanes: LaneId[];
  startSec?: number;
  durationSec?: number;
  bInSec?: number;
}

export interface ApplyResult {
  patch: ApplyPatch;
  notices: string[];
}

/** Proportional window rescale: the chosen TOTAL splits so the anchor
 * keeps its relative position; `after` takes the rounding remainder so
 * `before' + after' ≡ chosenTotal` by construction. A zero-length
 * template cannot scale (no shape to keep) — the override is ignored. */
export function scaleWindow(
  beforeBeats: number,
  afterBeats: number,
  chosenTotal: number
): { before: number; after: number } {
  const total = beforeBeats + afterBeats;
  if (total <= 0 || chosenTotal === total) {
    return { before: beforeBeats, after: afterBeats };
  }
  const before = Math.round((beforeBeats * chosenTotal) / total);
  return { before, after: chosenTotal - before };
}

/**
 * Apply a template to a pair.
 *
 * The ALIGNMENT INSTANT (mix time) = A-local time of `alignABase + delta`
 * on A's grid (A ≡ the mix axis under the sketch origin); B's resolved
 * anchor lands on it. The window sits around that instant: `startSec` =
 * instant − before·periodA, `durationSec` = total·periodA, `bInSec` =
 * B-anchor − before·periodB (B's native seconds — N mix-beats ≡ N B-beats
 * under tempo-match, which the template implies).
 *
 * The model's only clamp, `startSec ≥ 0`, SHRINKS the lead-in instead of
 * sliding the window: the alignment (the recipe's whole point) is
 * preserved and the tail keeps its length. Anchoring is all-or-nothing:
 * if either side fails, neither anchor is touched.
 */
export function applyTemplate(
  template: TransitionTemplate,
  sides: { a: TrackSideInfo; b: TrackSideInfo },
  totalBeats: number = template.beforeBeats + template.afterBeats
): ApplyResult {
  const notices: string[] = [];
  const patch: ApplyPatch = {
    tempoMatch: true,
    lanes: structuredClone(template.lanes),
    hiddenLanes: [],
  };

  if (!sides.a.beatgrid) {
    notices.push('A has no beatgrid — length and anchors unchanged');
    if (!sides.b.beatgrid) notices.push('B has no beatgrid — anchors unchanged');
    return { patch, notices };
  }
  const periodA = beatPeriodSec(sides.a.beatgrid);
  const { before, after } = scaleWindow(
    template.beforeBeats,
    template.afterBeats,
    totalBeats
  );

  // Duration stamps whenever A's grid exists (mix time ≡ A time).
  patch.durationSec = Math.max(0, (before + after) * periodA);

  // Anchors: all-or-nothing across the pair.
  if (!sides.b.beatgrid) {
    notices.push('B has no beatgrid — anchors unchanged');
    return { patch, notices };
  }
  const periodB = beatPeriodSec(sides.b.beatgrid);
  const anchorA = resolveAnchorBase(template.alignABase, sides.a, 'A');
  const anchorB = resolveAnchorBase(template.alignBBase, sides.b, 'B');
  if (!anchorA || !anchorB) {
    const failed = [!anchorA && 'A', !anchorB && 'B'].filter(Boolean).join(' and ');
    notices.push(`could not resolve the anchor on ${failed} — anchors unchanged`);
    return { patch, notices };
  }
  if (anchorA.notice) notices.push(anchorA.notice);
  if (anchorB.notice) notices.push(anchorB.notice);

  const instant = anchorA.sec + template.deltaBeats * periodA;

  // startSec ≥ 0: shrink the lead-in, keep the alignment and the tail.
  let beforeEff = before;
  if (instant - before * periodA < 0) {
    beforeEff = instant / periodA;
    notices.push('window start clamped to 0 — lead-in shortened (alignment preserved)');
  }
  patch.startSec = Math.max(0, instant - beforeEff * periodA);
  patch.durationSec = Math.max(0, (beforeEff + after) * periodA);
  patch.bInSec = anchorB.sec - beforeEff * periodB;

  return { patch, notices };
}

/**
 * APPLY TARGET (2026-07-04 grill): stamp into the active Transition when
 * it's pristine (fresh pair → the recipe lands in "Transition 1"), else
 * create a NEW Transition in the session — stamping over hand-drawn work
 * would be data loss with no undo; the multiple-takes switcher exists
 * precisely so alternatives get their own slot. Either way the receiver
 * takes the template's name — the only recipe→instance link (no
 * provenance is stored).
 */
export function stampIntoSession(
  items: SavedTransition[],
  active: number,
  templateName: string,
  patch: ApplyPatch
): { items: SavedTransition[]; active: number } {
  const cur = items[active];
  const receiver = isPristine(cur) ? cur : freshTransition(items);
  const stamped: SavedTransition = {
    ...receiver,
    name: templateName,
    transition: { ...receiver.transition, ...patch },
  };
  if (receiver === cur) {
    return { items: items.map((it, i) => (i === active ? stamped : it)), active };
  }
  return { items: [...items, stamped], active: items.length };
}

// ── Derivation (save-from-Transition) ───────────────────────────────────

/** A base position for SAVING: set cues and the grid origin only — a
 * save-time fallback would bake a weaker anchor into the recipe
 * permanently. Null when unresolvable. */
function saveBaseSec(base: AnchorBase, side: TrackSideInfo): number | null {
  const slot = cueSlot(base);
  if (slot === null) return side.beatgrid ? gridOriginSec(side.beatgrid) : null;
  return side.hotCues.find((c) => c.slot === slot)?.timeSec ?? null;
}

export interface DerivedAlignment {
  deltaBeats: number;
  beforeBeats: number;
  afterBeats: number;
}

/** Where B's chosen base sits in MIX time under the drawn alignment —
 * the alignment instant the recipe will reproduce. Null when the base
 * cannot resolve for saving. */
export function alignmentInstantSec(
  tr: Pick<Transition, 'startSec' | 'bInSec'>,
  rateB: number,
  baseB: AnchorBase,
  b: TrackSideInfo
): number | null {
  if (rateB <= 0) return null;
  const baseBSec = saveBaseSec(baseB, b);
  if (baseBSec === null) return null;
  return tr.startSec + (baseBSec - tr.bInSec) / rateB;
}

/**
 * Derive the recipe from the drawn Transition and two chosen bases, in
 * an order that keeps the identities honest (2026-07-04 #2 grill):
 *
 * 1. alignment instant (mix) = where B's base sits under the current
 *    alignment: startSec + (baseB − bInSec)/rateB;
 * 2. delta = instant − baseA, in A-beats, rounded;
 * 3. length = round(duration/periodA) — total FIRST, so the window length
 *    survives rounding intact;
 * 4. before = round((instant − startSec)/periodA);
 *    after = length − before — the remainder, never rounded on its own,
 *    so before + after ≡ length by construction.
 */
export function deriveAlignment(
  tr: Pick<Transition, 'startSec' | 'durationSec' | 'bInSec'>,
  rateB: number,
  baseA: AnchorBase,
  baseB: AnchorBase,
  a: TrackSideInfo,
  b: TrackSideInfo
): DerivedAlignment | null {
  if (!a.beatgrid) return null;
  const baseASec = saveBaseSec(baseA, a);
  const instant = alignmentInstantSec(tr, rateB, baseB, b);
  if (baseASec === null || instant === null) return null;
  const periodA = beatPeriodSec(a.beatgrid);
  const deltaBeats = Math.round((instant - baseASec) / periodA);
  const lengthBeats = Math.round(tr.durationSec / periodA);
  const beforeBeats = Math.round((instant - tr.startSec) / periodA);
  return { deltaBeats, beforeBeats, afterBeats: lengthBeats - beforeBeats };
}

const LANE_EPS = 1e-9;

function pointsEqual(a: LanePoint[], b: LanePoint[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (p, i) => Math.abs(p.x - b[i].x) < LANE_EPS && Math.abs(p.y - b[i].y) < LANE_EPS
    )
  );
}

/**
 * The template's lane payload from a Transition: the author's intent
 * only. Hidden lanes are dropped (hiding says "not part of the move"),
 * as are empty arrays and lanes still equal to their default shape
 * (added but never touched) — applying must not stamp trivial flat
 * envelopes over a target's existing lanes.
 */
export function stripTemplateLanes(tr: Transition): Lanes {
  const hidden = new Set(tr.hiddenLanes ?? []);
  const out: Lanes = {};
  for (const [id, pts] of Object.entries(tr.lanes) as [LaneId, LanePoint[]][]) {
    if (!pts || pts.length === 0 || hidden.has(id)) continue;
    if (pointsEqual(pts, defaultLanePoints(id, tr.durationSec))) continue;
    out[id] = pts;
  }
  return out;
}

/** The save modal's default A base: the set cue nearest the alignment
 * instant (the cue the author built the move around), else grid origin. */
export function defaultAnchorBase(anchorSec: number, side: TrackSideInfo): AnchorBase {
  let best: { slot: number; dist: number } | null = null;
  for (const cue of side.hotCues) {
    const dist = Math.abs(cue.timeSec - anchorSec);
    if (!best || dist < best.dist) best = { slot: cue.slot, dist };
  }
  return best ? (`cue_${best.slot}` as AnchorBase) : 'grid_origin';
}

/** The save modal's default B base (2026-07-04 #2 grill): the EARLIEST
 * set cue inside B's window span — the first cue inside the window is
 * usually the mix-in landmark. Fallbacks: nearest set cue to the span's
 * midpoint, else grid origin. */
export function defaultAnchorBaseB(
  tr: Pick<Transition, 'durationSec' | 'bInSec'>,
  rateB: number,
  side: TrackSideInfo
): AnchorBase {
  const spanStart = tr.bInSec;
  const spanEnd = tr.bInSec + tr.durationSec * rateB;
  const inside = side.hotCues
    .filter((c) => c.timeSec >= spanStart && c.timeSec <= spanEnd)
    .sort((p, q) => p.timeSec - q.timeSec);
  if (inside[0]) return `cue_${inside[0].slot}` as AnchorBase;
  return defaultAnchorBase((spanStart + spanEnd) / 2, side);
}
