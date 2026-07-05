/**
 * Editor hardware-gesture math (editor-midi 02): pure helpers shared by
 * the surface handle registrations and the on-screen gesture cluster.
 */

/** N beats at a base BPM → seconds (jump A by A's beats on the mix axis;
 * Slide B by its OWN beats in B-track seconds). */
export function beatsToSeconds(beats: number, bpm: number): number {
  return (beats * 60) / bpm;
}
