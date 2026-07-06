/**
 * The BPM control's commit seam and projection math — plain module so the
 * behavior is testable against a fake api (deck-controls issue 02).
 *
 * BPM is a projection of the Beatgrid (ADR 0016): when a grid exists its
 * dominant tempo IS the BPM; track.bpm is metadata only for gridless
 * tracks. Writes go through the server's BPM write path (the PATCH
 * re-tempos/regenerates the grid itself; variable grids answer 409), so
 * the client's job is: serialize the PATCHes, invalidate, and surface the
 * 409 as a draft revert.
 */
import type { BeatgridData, TempoChange } from '../../types';

// ── Projection ───────────────────────────────────────────────────────────

export type BpmProjection =
  /** No grid, no track BPM — nothing to show. */
  | { kind: 'none' }
  /** No grid — track.bpm is plain metadata (a placeholder-grid seed). */
  | { kind: 'plain'; bpm: number }
  /** Constant grid — the grid's tempo, editable via re-tempo. */
  | { kind: 'grid'; bpm: number }
  /** Variable grid — dominant tempo, readout only (`~N (var)`). */
  | { kind: 'variable'; bpm: number };

/**
 * The grid's dominant tempo: the BPM occupying the most track time
 * (mirrors backend/beatgrid_utils.dominant_bpm). Without a duration the
 * last segment's length is unknown — fall back to the first tempo change.
 */
export function dominantBpm(
  tempoChanges: TempoChange[],
  durationSecs?: number | null
): number {
  if (tempoChanges.length === 1 || durationSecs == null) {
    return tempoChanges[0].bpm;
  }
  const weights = new Map<number, number>();
  tempoChanges.forEach((tc, i) => {
    const end =
      i + 1 < tempoChanges.length ? tempoChanges[i + 1].start_time : durationSecs;
    weights.set(tc.bpm, (weights.get(tc.bpm) ?? 0) + Math.max(0, end - tc.start_time));
  });
  let best = tempoChanges[0].bpm;
  let bestWeight = -1;
  for (const [bpm, weight] of weights) {
    if (weight > bestWeight) {
      bestWeight = weight;
      best = bpm;
    }
  }
  return best;
}

/** What the control shows: grid-dominant tempo when a grid exists, else track.bpm. */
export function projectBpm(
  grid: BeatgridData | null | undefined,
  trackBpm: number | null | undefined,
  durationSecs?: number | null
): BpmProjection {
  const changes = grid?.tempo_changes;
  if (changes && changes.length > 0) {
    const bpm = dominantBpm(changes, durationSecs);
    return changes.length > 1 ? { kind: 'variable', bpm } : { kind: 'grid', bpm };
  }
  if (trackBpm != null && trackBpm > 0) return { kind: 'plain', bpm: trackBpm };
  return { kind: 'none' };
}

/** The grid-first tempo scalar (ADR 0027): the grid's dominant tempo when
 * a grid exists, else track bpm, else null — projectBpm flattened for
 * callers that only want the number (editor tempo-match). */
export function gridFirstBpm(
  grid: BeatgridData | null | undefined,
  trackBpm: number | null | undefined,
  durationSecs?: number | null
): number | null {
  const projection = projectBpm(grid, trackBpm, durationSecs);
  return projection.kind === 'none' ? null : projection.bpm;
}

// ── Display / step math ──────────────────────────────────────────────────

/** Up to 2 decimals, trailing zeros trimmed (128, 128.5, 128.03). */
export function formatBpm(bpm: number): string {
  return (Math.round(bpm * 100) / 100).toFixed(2).replace(/\.?0+$/, '');
}

/** The Grow/Shrink pair (glossary): grid spacing wider ↔ tighter. */
export type GrowShrink = 'grow' | 'shrink';

/**
 * ±0.03 Grow/Shrink micro-adjust (glossary; library keyboard parity):
 * grow widens beat spacing (BPM down a hair), shrink tightens it (BPM up).
 * Snaps to the integer at x.99 / x.01 so repeated steps re-find round
 * tempos. (Formerly "BPM nudge" — renamed to end the collision with the
 * performance Nudge and the grid nudge.)
 */
export function growShrinkBpm(current: number, op: GrowShrink): number {
  let next = current + (op === 'shrink' ? 0.03 : -0.03);
  const decimal = Math.abs(next % 1);
  if (decimal >= 0.99 || decimal <= 0.01) next = Math.round(next);
  return Math.round(next * 100) / 100;
}

// ── Commit chain ─────────────────────────────────────────────────────────

/** The tracks PATCH answers 409 for variable grids (api.tracks.update
 * throws `Failed to update track (409): …`). */
export function isBpmConflict(error: unknown): boolean {
  return error instanceof Error && error.message.includes('(409)');
}

export interface BpmCommitterOptions {
  /** The PATCH (caller-supplied save handler or api.tracks.update). */
  save: (bpm: number) => void | Promise<unknown>;
  /** After each successful save — invalidations + per-surface side effects. */
  onCommitted?: (bpm: number) => void;
  /** 409 — the grid went variable under us; revert the draft. */
  onConflict?: (error: Error) => void;
  /** Any other failure. */
  onError?: (error: unknown) => void;
}

export interface BpmCommitter {
  /** Enqueue a commit; resolves when THIS commit has settled. */
  commit(bpm: number): Promise<void>;
}

/**
 * One serialized promise chain per control: rapid nudge clicks used to
 * interleave writes, landing grids built from stale BPMs (issue
 * mix-editor/24). The grid work now happens INSIDE the PATCH (server-side,
 * atomic per write — ADR 0016); the chain still orders the PATCHes and
 * their refetches. Failures never break the chain.
 */
export function createBpmCommitter(opts: BpmCommitterOptions): BpmCommitter {
  let chain: Promise<void> = Promise.resolve();

  const run = async (bpm: number) => {
    try {
      await opts.save(bpm);
      opts.onCommitted?.(bpm);
    } catch (error) {
      if (isBpmConflict(error)) {
        console.warn('BPM edit rejected — variable beatgrid (409):', error);
        opts.onConflict?.(error as Error);
      } else {
        console.error('BPM commit failed:', error);
        opts.onError?.(error);
      }
    }
  };

  return {
    commit(bpm: number) {
      chain = chain.then(() => run(bpm));
      return chain;
    },
  };
}
