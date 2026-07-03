/**
 * Main cue defaults (glossary: Main cue; PRD deck-consolidation issue 04).
 *
 * Precedence when loading a Track: saved cue → first beat (caller supplies,
 * from the Beatgrid) → first non-silent audio (engine computes from the
 * decoded buffer) → 0.0. Defaults are never persisted — only a cue the user
 * sets is written back.
 */

/** Amplitude below this is considered silence (~ -40 dBFS). */
const DEFAULT_SILENCE_THRESHOLD = 0.01;

export function resolveInitialCue({
  saved,
  firstBeat,
  firstNonSilence,
}: {
  saved: number | null;
  firstBeat: number | null;
  firstNonSilence: number | null;
}): number {
  return saved ?? firstBeat ?? firstNonSilence ?? 0;
}

/**
 * Time in seconds of the first sample whose magnitude exceeds the silence
 * threshold, or null if the audio never does.
 */
export function firstNonSilentTime(
  samples: Float32Array,
  sampleRate: number,
  threshold: number = DEFAULT_SILENCE_THRESHOLD
): number | null {
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]) > threshold) {
      return i / sampleRate;
    }
  }
  return null;
}
