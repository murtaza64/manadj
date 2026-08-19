/**
 * Windowed dominant-channel selection with hysteresis (realtime-viz 06).
 *
 * The beat/phase source used to be an instantaneous argmax over channel
 * levels, which flapped erratically during double drops and layered
 * sections (human note, 2026-08-18). Here each channel's level is smoothed
 * with a ~700 ms EMA and a challenger only takes the dominant slot when its
 * smoothed level exceeds the incumbent's by a margin — or the incumbent
 * stops being eligible (paused, unloaded), in which case the handoff is
 * immediate.
 *
 * Pure stepper: state in, state out. The bridge owns persistence.
 */

export interface DominanceSample {
  id: string;
  /** Instantaneous level (any monotone loudness proxy, e.g. meanAbsolute). */
  level: number;
  /** Whether this channel may hold the dominant slot (running + audible). */
  eligible: boolean;
}

export interface DominanceState {
  /** Smoothed level per channel id. */
  levels: Record<string, number>;
  dominantId: string | null;
}

export interface DominanceOptions {
  /** EMA time constant in seconds (default 0.7 — the requested ~500ms-1s). */
  tauSeconds?: number;
  /** Challenger must exceed incumbent by this factor (default 1.2). */
  takeoverRatio?: number;
}

export const INITIAL_DOMINANCE: DominanceState = { levels: {}, dominantId: null };

export function stepDominance(
  state: DominanceState,
  samples: DominanceSample[],
  dtSeconds: number,
  opts: DominanceOptions = {}
): DominanceState {
  const tau = opts.tauSeconds ?? 0.7;
  const ratio = opts.takeoverRatio ?? 1.2;
  const dt = Math.max(0, Math.min(1, dtSeconds));
  const alpha = 1 - Math.exp(-dt / tau);

  const levels: Record<string, number> = {};
  const eligible = new Set<string>();
  for (const s of samples) {
    const prev = state.levels[s.id] ?? 0;
    levels[s.id] = prev + (s.level - prev) * alpha;
    if (s.eligible) eligible.add(s.id);
  }

  const argmax = (): string | null => {
    let bestId: string | null = null;
    let best = -Infinity;
    for (const id of eligible) {
      const v = levels[id] ?? 0;
      if (v > best) {
        best = v;
        bestId = id;
      }
    }
    return bestId;
  };

  let dominantId = state.dominantId;
  if (dominantId === null || !eligible.has(dominantId)) {
    // No incumbent (or it went ineligible): hand off immediately.
    dominantId = argmax();
  } else {
    const incumbent = levels[dominantId] ?? 0;
    const challenger = argmax();
    if (
      challenger !== null &&
      challenger !== dominantId &&
      (levels[challenger] ?? 0) > incumbent * ratio + 1e-6
    ) {
      dominantId = challenger;
    }
  }

  return { levels, dominantId };
}
