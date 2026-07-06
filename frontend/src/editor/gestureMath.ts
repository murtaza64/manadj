/**
 * Editor hardware-gesture math (editor-midi 02): pure helpers shared by
 * the surface handle registrations and the on-screen gesture cluster.
 */

/** N beats at a base BPM → seconds (jump A by A's beats on the mix axis;
 * Slide B by its OWN beats in B-track seconds). */
export function beatsToSeconds(beats: number, bpm: number): number {
  return (beats * 60) / bpm;
}

/**
 * Slide-control polarity (mix-editor 32; glossary "Slide"): arrow- and
 * step-shaped Slide controls follow APPARENT MOTION — ▶ (+beats) moves the
 * incoming Track's drawn block RIGHT on screen, in both lock modes.
 * slideB's +δ re-cues the content later, which DRAWS the block left
 * (unlocked: bInSec += δ; locked: startSec −= δ/rate) — so gesture beats
 * negate on the way into the model. The model math is correct and
 * untouched; only the gesture layer flips. Jog B is exempt (platter
 * metaphor: forward = music advances) and bypasses this helper.
 */
export function slideBeatsToSeconds(beats: number, bpm: number): number {
  return -beatsToSeconds(beats, bpm);
}
