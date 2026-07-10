/**
 * GRID ORIGIN (glossary): the track's true first downbeat — the earliest
 * downbeat after extending the first tempo segment backward in whole
 * beats while the extrapolated position stays ≥ −ε, carrying bar phase
 * backward. Corrects grids whose first mark lands a beat or more after
 * the actual first downbeat (the off-by-one-bar trap: true downbeat at
 * t≈0, first grid mark on beat 2). ε = min(50ms, period/4) — enough for
 * jitter at track start, too tight to hallucinate a beat that lives
 * mostly before the audio.
 *
 * Moved here from templateModel (metric-ladder 01): the Metric ladder's
 * default anchor and template anchor resolution share one definition.
 */
import type { BeatgridData } from '../types';

export function gridOriginSec(grid: BeatgridData): number {
  const tc = grid.tempo_changes[0];
  // The FIRST segment's own period: the origin extends the first segment
  // backward — the dominant tempo may belong to a later one.
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
