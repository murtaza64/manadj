/**
 * Active loop → waveform overlay region (looping 05): the one place the
 * loop's rendering identity lives. Bright, fully saturated green — the
 * active-STATE color (never a Deck identity color) — with the fill alpha
 * low enough that waveform peaks stay readable underneath.
 */
import type { LoopRegion } from '../playback/loop';
import type { OverlayRegion } from './WaveformRendererV2';

/** #00f900 — converged with the minimap-clarity lab verdict (issue 05). */
const LOOP_GREEN: [number, number, number] = [0, 0.976, 0];
const LOOP_FILL_ALPHA = 0.18;

const NO_REGIONS: OverlayRegion[] = [];

/** Regions for the deck's active loop; renders nothing while no loop. */
export function loopOverlayRegions(loop: LoopRegion | null | undefined): OverlayRegion[] {
  if (!loop) return NO_REGIONS;
  return [
    {
      start: loop.start,
      end: loop.end,
      color: LOOP_GREEN,
      fillAlpha: LOOP_FILL_ALPHA,
      edges: true,
    },
  ];
}
