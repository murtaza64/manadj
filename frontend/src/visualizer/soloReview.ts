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

/**
 * Count ALL judgment exposure per candidate from the event log: solo
 * verdicts AND head-to-head vote participation. Counting only solo events
 * made ~everything look never-reviewed (the pre-solo arena history counted
 * for nothing), so the least-reviewed tier was the whole pool and new
 * candidates didn't stand out (human note, 2026-08-19).
 */
export function countSoloReviews(
  events: { type?: string; target?: string; a?: string; b?: string }[]
): Record<string, number> {
  const counts: Record<string, number> = {};
  const bump = (id?: string) => {
    if (id) counts[id] = (counts[id] ?? 0) + 1;
  };
  for (const e of events) {
    if (e.type === 'solo') bump(e.target);
    else if (e.type === 'vote') {
      bump(e.a);
      bump(e.b);
    }
  }
  return counts;
}

/**
 * Next candidate: uniformly RANDOM among the least-reviewed tier
 * (deterministic descent down the list was predictable — human note).
 * Selection pressure still spreads across the pool via the count floor;
 * never the current candidate unless it is the only one.
 */
export function nextCandidateId(
  listings: SoloListing[],
  counts: Record<string, number>,
  currentId: string | null,
  rng: () => number = Math.random
): string | null {
  const pool = listings.filter((l) => l.id !== currentId);
  const from = pool.length > 0 ? pool : listings;
  if (from.length === 0) return null;
  let minCount = Infinity;
  for (const l of from) minCount = Math.min(minCount, counts[l.id] ?? 0);
  const tier = from.filter((l) => (counts[l.id] ?? 0) === minCount);
  return tier[Math.min(tier.length - 1, Math.floor(rng() * tier.length))].id;
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

/**
 * Score adjustment for a MANUAL skip, weighted by watch time (human,
 * 2026-08-22: "more watch time = better"; a skip is "not as bad as a
 * manual 'bad' but still counts against"). Quick skip = half a dislike;
 * a long watch before skipping is mild positive evidence.
 */
export function skipAdjustment(watchedS: number): number {
  if (watchedS < 10) return -0.5;
  if (watchedS < 45) return -0.25;
  if (watchedS < 120) return 0;
  return 0.25;
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
  const beatsAfterDrop = opts.beatsAfterDrop ?? 128;
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
  // drop mode: a rising edge arms a delayed advance N beats out. If ANOTHER
  // drop lands before that window ends, advance IMMEDIATELY at the new drop
  // (human note: resetting/ignoring meant drop-to-drop sections never
  // advanced) — the refractory only guards against the same drop refiring.
  const rising = excitement >= dropThreshold && state.prevExcitement < dropThreshold;
  if (rising && nowMs >= state.armedAfter) {
    if (state.dueAt === null) {
      const beatMs = 60000 / (bpm && bpm > 40 ? bpm : 128);
      next.dueAt = nowMs + beatsAfterDrop * beatMs;
      next.armedAfter = nowMs + refractoryS * 1000;
    } else {
      // Second drop inside the pending window: cut to the next preset NOW.
      next.dueAt = null;
      next.lastAdvanceAt = nowMs;
      next.armedAfter = nowMs + refractoryS * 1000;
      return { state: next, advance: true };
    }
  }
  if (next.dueAt !== null && nowMs >= next.dueAt) {
    next.dueAt = null;
    next.lastAdvanceAt = nowMs;
    return { state: next, advance: true };
  }
  return { state: next, advance: false };
}
