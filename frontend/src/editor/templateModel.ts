/**
 * Transition-template domain model (pure — under vitest).
 *
 * A template is a beat-domain RECIPE (ADR 0010 Amendment 2): per-side
 * anchor rules (base = a cue slot or the grid origin, plus a whole-beat
 * delta on that track's own grid), a length in beats, and sparse
 * normalized lanes. Applying translates beats → seconds via the
 * tempo-matched beatgrids and yields ordinary seconds-based Transition
 * fields — the recipe never survives into the model (no provenance).
 *
 * Resolution never guesses silently: every fallback and clamp produces a
 * one-line notice; anchoring is all-or-nothing across the pair (a partial
 * alignment would be silently broken).
 */
import type { BeatgridData } from '../types';
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

export interface AnchorRule {
  base: AnchorBase;
  /** Whole beats on the anchored track's own grid. */
  deltaBeats: number;
}

export interface TransitionTemplate {
  uuid: string;
  name: string;
  /** Anchor rule on the outgoing track. */
  alignA: AnchorRule;
  /** Anchor rule on the incoming track. */
  alignB: AnchorRule;
  lengthBeats: number;
  /** Scalable templates take an apply-time beat count (default
   * lengthBeats); fixed ones apply at exactly lengthBeats. */
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

/** Seconds per beat from the grid's first tempo change (constant BPM —
 * the same simplification the backend expansion makes today). */
export function beatPeriodSec(grid: BeatgridData): number {
  return 60 / grid.tempo_changes[0].bpm;
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
  const period = beatPeriodSec(grid);
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

/** Resolve a full anchor rule (base + whole-beat delta on the side's own
 * grid). The delta needs the grid even when the base cue is set. */
function resolveAnchorRule(
  rule: AnchorRule,
  side: TrackSideInfo,
  label: 'A' | 'B'
): ResolvedAnchor | null {
  const base = resolveAnchorBase(rule.base, side, label);
  if (!base) return null;
  if (rule.deltaBeats === 0) return base;
  if (!side.beatgrid) return null;
  return {
    sec: base.sec + rule.deltaBeats * beatPeriodSec(side.beatgrid),
    notice: base.notice,
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

/**
 * Apply a template to a pair: the two resolved align points coincide and
 * that instant is the transition start — startSec = A-local time of
 * alignA, bInSec = B-local time of alignB, durationSec = lengthBeats in
 * A-beats (mix time ≡ A time under the sketch origin; tempo-match makes
 * B's beats equivalent). Anchoring is all-or-nothing: if either side
 * fails, neither anchor is touched. The only clamp is the model's own
 * startSec ≥ 0. Negative bInSec is first-class (silent lead gap).
 */
export function applyTemplate(
  template: TransitionTemplate,
  sides: { a: TrackSideInfo; b: TrackSideInfo },
  lengthBeats: number = template.lengthBeats
): ApplyResult {
  const notices: string[] = [];
  const patch: ApplyPatch = {
    tempoMatch: true,
    lanes: structuredClone(template.lanes),
    hiddenLanes: [],
  };

  // Duration: beats → seconds on A's grid (mix time ≡ A time).
  if (sides.a.beatgrid) {
    patch.durationSec = lengthBeats * beatPeriodSec(sides.a.beatgrid);
  } else {
    notices.push('A has no beatgrid — length and anchors unchanged');
  }

  // Anchors: all-or-nothing across the pair.
  const anchorA = sides.a.beatgrid
    ? resolveAnchorRule(template.alignA, sides.a, 'A')
    : null;
  const anchorB = sides.b.beatgrid
    ? resolveAnchorRule(template.alignB, sides.b, 'B')
    : null;
  if (!sides.b.beatgrid) {
    notices.push('B has no beatgrid — anchors unchanged');
  }

  if (anchorA && anchorB) {
    if (anchorA.notice) notices.push(anchorA.notice);
    if (anchorB.notice) notices.push(anchorB.notice);
    if (anchorA.sec < 0) {
      notices.push('transition start clamped to 0 (resolved before A begins)');
      patch.startSec = 0;
    } else {
      patch.startSec = anchorA.sec;
    }
    patch.bInSec = anchorB.sec;
  } else if (sides.a.beatgrid && sides.b.beatgrid) {
    const failed = [!anchorA && 'A', !anchorB && 'B'].filter(Boolean).join(' and ');
    notices.push(`could not resolve the anchor on ${failed} — anchors unchanged`);
  }

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

/**
 * The whole-beat delta from a chosen base to the actual anchor position
 * (save-time). Null when the base cannot resolve on this side — the save
 * modal only offers resolvable bases, so this guards programmer error.
 * Fallback resolutions are NOT acceptable here: a save-time fallback
 * would bake a weaker anchor into the recipe permanently, so only set
 * cues and the grid origin qualify.
 */
export function deriveAnchorDeltaBeats(
  anchorSec: number,
  base: AnchorBase,
  side: TrackSideInfo
): number | null {
  if (!side.beatgrid) return null;
  const slot = cueSlot(base);
  let baseSec: number;
  if (slot === null) {
    baseSec = gridOriginSec(side.beatgrid);
  } else {
    const cue = side.hotCues.find((c) => c.slot === slot);
    if (!cue) return null;
    baseSec = cue.timeSec;
  }
  return Math.round((anchorSec - baseSec) / beatPeriodSec(side.beatgrid));
}

/** The window's duration in whole A-beats (mix time ≡ A time). */
export function deriveLengthBeats(durationSec: number, gridA: BeatgridData): number {
  return Math.max(0, Math.round(durationSec / beatPeriodSec(gridA)));
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

/** The save modal's default base per side: the set cue nearest the
 * actual anchor point (smallest |delta| — the cue the author built the
 * move around), else the grid origin. */
export function defaultAnchorBase(anchorSec: number, side: TrackSideInfo): AnchorBase {
  let best: { slot: number; dist: number } | null = null;
  for (const cue of side.hotCues) {
    const dist = Math.abs(cue.timeSec - anchorSec);
    if (!best || dist < best.dist) best = { slot: cue.slot, dist };
  }
  return best ? (`cue_${best.slot}` as AnchorBase) : 'grid_origin';
}
