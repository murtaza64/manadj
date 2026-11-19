/** Past-EOF grid projection + silence-loop entry boundary (gh#424).
 *
 * Stored beatgrids stop at track duration (backend beatgrid_utils walks each
 * tempo segment only while t <= duration). The silence loop lives AFTER the
 * last audible sample, so its hypermetric boundary usually sits past EOF.
 * This module extends a grid on the FINAL tempo segment's own lattice -
 * same accumulation and bar-phase rotation as the backend walk - and finds
 * the loop entry: the first top-tier Metric Ladder boundary at or after the
 * last audible sample.
 *
 * Rule provenance (user decision, 2026-11-18 iMessage): a FIXED 64-beat
 * silence loop starting on a "projected 64 beat hypermetric boundary", so
 * cross-deck drop alignment survives one track ending. This module maps
 * "64-beat hypermetric boundary" onto the Metric Ladder's TOP TIER: 64
 * beats (16 bars) under the default duple ladder at 4/4. A custom ladder's
 * top tier may span a different beat count — that mapping is the
 * implementation's interpretation of the decision, not its literal text.
 *
 * Stored arrays pass through UNTOUCHED (the waveform renderer matches
 * downbeats to beats by exact float equality); projection only appends. */

import type { BeatgridData } from '../types';
import { resolveLadder, type PersistedLadder } from './ladder';

/** Extend beat/downbeat times past the stored end, on the final tempo
 * segment's lattice, until coverage reaches `horizonSec`. Returns the grid
 * unchanged when it is empty or already covers the horizon. */
export function projectGridToHorizon(grid: BeatgridData, horizonSec: number): BeatgridData {
  const { tempo_changes, beat_times, downbeat_times } = grid;
  if (tempo_changes.length === 0 || beat_times.length === 0) return grid;
  const lastBeat = beat_times[beat_times.length - 1];
  if (lastBeat >= horizonSec) return grid;

  const tc = tempo_changes[tempo_changes.length - 1];
  const beatInterval = 60 / tc.bpm;
  const sigNum = tc.time_signature_num;

  // Re-walk the final segment exactly as the backend does (accumulated
  // addition from start_time, bar_position rotating mod sigNum) and append
  // only beats strictly past the stored end, so float accumulation matches
  // the stored prefix bit-for-bit within this segment.
  const beats = [...beat_times];
  const downbeats = [...downbeat_times];
  let t = tc.start_time;
  let barPosition = tc.bar_position;
  while (t <= horizonSec + beatInterval) {
    if (t > lastBeat) {
      beats.push(t);
      if (barPosition === 1) downbeats.push(t);
    }
    t += beatInterval;
    barPosition = (barPosition % sigNum) + 1;
    if (beats.length - beat_times.length > 100000) break; // pathological grid guard
  }
  return { tempo_changes, beat_times: beats, downbeat_times: downbeats };
}

/** Grid the waveform should draw while overlay regions exist (gh#424
 * rendering): when a region runs past the stored grid's track duration
 * (a silence loop), extend the lattice far enough to cover it so the
 * flat past-EOF tail keeps its beat/bar/hypermeter ticks. Returns the
 * grid unchanged when no region crosses EOF. `regionEnds` are seconds. */
export function gridForOverlayRegions(
  grid: BeatgridData,
  regionEnds: readonly number[],
  duration: number,
): BeatgridData {
  let horizon = duration;
  for (const end of regionEnds) {
    if (end > horizon) horizon = end;
  }
  // +1s: cover the region end even when it lands a fraction past the
  // last projected beat, mirroring silenceLoopEntry's generous horizon.
  return horizon > duration ? projectGridToHorizon(grid, horizon + 1) : grid;
}

export interface SilenceLoopEntry {
  /** Entry time in seconds: the first projected top-tier ladder boundary
   * at or after the last audible sample. */
  entrySec: number;
  /** Loop length in seconds under the entry segment's CURRENT tempo
   * (one top-tier group = 64 beats on the default 4/4 duple ladder). */
  loopLengthSec: number;
  /** Loop length in beats (top-tier group of the active ladder). */
  loopLengthBeats: number;
}

/** Find the silence-loop entry boundary: first top-tier Metric Ladder
 * boundary at or after `lastAudibleSec`, projecting the grid past EOF as
 * needed. Null for gridless tracks (they keep stop-at-end, gh#424 D4) or
 * when no downbeat lattice exists at all. */
export function silenceLoopEntry(
  grid: BeatgridData | null,
  persisted: PersistedLadder | null | undefined,
  lastAudibleSec: number,
): SilenceLoopEntry | null {
  if (!grid || grid.tempo_changes.length === 0 || grid.downbeat_times.length === 0) return null;

  const tc = grid.tempo_changes[grid.tempo_changes.length - 1];
  const beatInterval = 60 / tc.bpm;
  // Horizon: last audible point plus two full default-cycle spans, generous
  // enough that a top-tier boundary always lands inside it.
  const horizon = lastAudibleSec + 128 * beatInterval + 1;
  const projected = projectGridToHorizon(grid, horizon);
  const proj = resolveLadder(projected, persisted);
  if (!proj) return null;

  const sigNum = tc.time_signature_num;
  const loopLengthBeats = proj.tierBars[proj.topTier] * sigNum;
  const beats = projected.beat_times;
  const downbeats = projected.downbeat_times;

  for (let i = 0; i < downbeats.length; i++) {
    if (downbeats[i] < lastAudibleSec) continue;
    if (proj.tiers[i] !== proj.topTier || proj.parentheticals[i]) continue;
    // Loop length in seconds from the beat lattice at entry (pitch-safe:
    // consumers re-derive under rate changes, D6 beat-domain rule).
    const entryBeatIdx = beats.findIndex((b) => b === downbeats[i]);
    const endIdx = entryBeatIdx + loopLengthBeats;
    const endSec =
      endIdx < beats.length
        ? beats[endIdx]
        : downbeats[i] + loopLengthBeats * beatInterval;
    return { entrySec: downbeats[i], loopLengthSec: endSec - downbeats[i], loopLengthBeats };
  }
  return null;
}
