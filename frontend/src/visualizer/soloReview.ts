/**
 * Solo review flow (realtime-viz 06, human ask 2026-08-18): rate ONE
 * candidate at a time — like / dislike / neutral / note — during normal
 * DJ use in the main viz window, replacing head-to-head arena sessions as
 * the primary judging mode. Events are the same append-only jsonl
 * (type 'solo', outcome like|dislike|neutral); the orchestrator folds
 * likes/dislikes as approvals/rejections.
 *
 * Pure helpers: scheduling (least-reviewed next) and the auto-cycle
 * stepper (advance every X seconds, or N beats after a detected drop).
 */

export type SoloVerdict = 'like' | 'dislike' | 'neutral';

export interface SoloListing {
  id: string;
  rating: number;
}

/** Count solo reviews per candidate from the event log. */
export function countSoloReviews(
  events: { type?: string; target?: string }[]
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const e of events) {
    if (e.type === 'solo' && e.target) counts[e.target] = (counts[e.target] ?? 0) + 1;
  }
  return counts;
}

/**
 * Next candidate: fewest solo reviews first (selection pressure spreads
 * across the pool), ties broken by higher rating (see the good ones
 * sooner), never the current one unless it is the only candidate.
 */
export function nextCandidateId(
  listings: SoloListing[],
  counts: Record<string, number>,
  currentId: string | null
): string | null {
  const pool = listings.filter((l) => l.id !== currentId);
  const from = pool.length > 0 ? pool : listings;
  let best: SoloListing | null = null;
  let bestCount = Infinity;
  for (const l of from) {
    const c = counts[l.id] ?? 0;
    if (c < bestCount || (c === bestCount && best !== null && l.rating > best.rating)) {
      best = l;
      bestCount = c;
    }
  }
  return best?.id ?? null;
}

/** One tunable param declaration (mirrors PresetParam's numeric fields). */
export interface TunableParam {
  id: string;
  min: number;
  max: number;
  step: number;
  default: number;
}

/**
 * Parameter-genotype exploration (human ask 2026-08-18): each solo-flow
 * load presents DIFFERENT param values so verdicts (which snapshot params)
 * become (params → reward) samples. Per param: 15% a full-range
 * exploratory draw, else a gaussian around the declared default
 * (σ = 0.22·range — the file default is the current best-known, updated
 * in place at fold time). Clamped and snapped to step.
 */
export function sampleParamValues(
  params: TunableParam[],
  rng: () => number = Math.random
): Record<string, number> {
  const values: Record<string, number> = {};
  for (const p of params) {
    const range = p.max - p.min;
    let v: number;
    if (rng() < 0.15) {
      v = p.min + rng() * range;
    } else {
      // Box-Muller gaussian around the default.
      const u1 = Math.max(rng(), 1e-9);
      const u2 = rng();
      const gauss = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      v = p.default + gauss * 0.22 * range;
    }
    v = Math.min(p.max, Math.max(p.min, v));
    if (p.step > 0) v = Math.round((v - p.min) / p.step) * p.step + p.min;
    values[p.id] = Math.min(p.max, Math.max(p.min, v));
  }
  return values;
}

export type CycleMode = 'off' | 'timer' | 'drop';

export interface CycleState {
  /** Last time the preset advanced (ms). */
  lastAdvanceAt: number;
  /** Pending advance scheduled by a drop (ms timestamp), or null. */
  dueAt: number | null;
  /** Refractory: ignore drop triggers until this time (ms). */
  armedAfter: number;
  prevExcitement: number;
}

export const INITIAL_CYCLE: CycleState = {
  lastAdvanceAt: 0,
  dueAt: null,
  armedAfter: 0,
  prevExcitement: 0,
};

export interface CycleOptions {
  /** Timer mode period (seconds). */
  periodS?: number;
  /** Drop mode: beats after the drop trigger before advancing. */
  beatsAfterDrop?: number;
  /** Excitement rising-edge threshold that counts as a drop. */
  dropThreshold?: number;
  /** Refractory after a trigger (seconds). */
  refractoryS?: number;
}

/**
 * Advance decision for the auto-cycle. Returns the new state and whether
 * the caller should advance to the next candidate now.
 */
export function stepCycle(
  state: CycleState,
  mode: CycleMode,
  nowMs: number,
  excitement: number,
  bpm: number | null,
  opts: CycleOptions = {}
): { state: CycleState; advance: boolean } {
  const periodS = opts.periodS ?? 45;
  const beatsAfterDrop = opts.beatsAfterDrop ?? 16;
  const dropThreshold = opts.dropThreshold ?? 0.55;
  const refractoryS = opts.refractoryS ?? 20;

  const next: CycleState = { ...state, prevExcitement: excitement };
  if (mode === 'off') {
    next.dueAt = null;
    return { state: next, advance: false };
  }
  if (mode === 'timer') {
    if (nowMs - state.lastAdvanceAt >= periodS * 1000) {
      next.lastAdvanceAt = nowMs;
      return { state: next, advance: true };
    }
    return { state: next, advance: false };
  }
  // drop mode: rising edge arms a delayed advance N beats out.
  const rising = excitement >= dropThreshold && state.prevExcitement < dropThreshold;
  if (rising && nowMs >= state.armedAfter && state.dueAt === null) {
    const beatMs = 60000 / (bpm && bpm > 40 ? bpm : 128);
    next.dueAt = nowMs + beatsAfterDrop * beatMs;
    next.armedAfter = nowMs + refractoryS * 1000;
  }
  if (next.dueAt !== null && nowMs >= next.dueAt) {
    next.dueAt = null;
    next.lastAdvanceAt = nowMs;
    return { state: next, advance: true };
  }
  return { state: next, advance: false };
}
