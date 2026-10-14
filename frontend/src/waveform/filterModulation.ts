/**
 * Sweep filter → waveform modulation (#377): the filter's REAL frequency
 * response (sweepFilter.describeSweepFilter, the audio path's own model)
 * sampled at one representative frequency per style group, as linear
 * gains the renderers multiply into the EQ modulation. An LPF closing
 * thins the high and then the mid group out of the body; an HPF eats the
 * low group — the waveform shows what the filter leaves audible, the same
 * idiom as an EQ kill. Used live (DeckPanel), on the Session timeline and
 * in the Routine video; the three must agree.
 */
import type { FilterSettings } from '../playback/filterSettings';
import { sweepResponseDb } from '../playback/sweepFilter';

/** Representative centre of each style group (low < 250 < mid < 2500 < high). */
export const FILTER_GROUP_HZ = new Float32Array([90, 900, 6000]);
const SAMPLE_RATE = 48000;
const STEP = 0.005;

let cacheSettings: Readonly<FilterSettings> | null = null;
let cache: Map<number, readonly [number, number, number]> = new Map();

/** Per-group linear gains at a sweep position (−1 LPF … 0 open … 1 HPF),
 * normalized so the open position reads [1, 1, 1]. Memoized per settings
 * identity at 0.005 resolution (the renderers call this per frame). */
export function filterGroupGains(
  settings: Readonly<FilterSettings>, position: number
): readonly [number, number, number] {
  if (settings !== cacheSettings) {
    cacheSettings = settings;
    cache = new Map();
  }
  const p = Number.isFinite(position) ? Math.max(-1, Math.min(1, position)) : 0;
  const key = Math.round(p / STEP);
  const hit = cache.get(key);
  if (hit) return hit;
  // Normalized to the loudest group: the filter's SHAPE (what it keeps vs
  // removes), not its loudness — the live path's peak-gain compensation
  // pulls the whole passband down several dB, which as height would read
  // as a fader move, not a sweep.
  const at = sweepResponseDb(settings, key * STEP, FILTER_GROUP_HZ, SAMPLE_RATE);
  const peak = Math.max(at[0], at[1], at[2]);
  const gains: [number, number, number] = [0, 1, 2].map((i) =>
    Math.min(1, Math.max(0, 10 ** ((at[i] - peak) / 20)))
  ) as [number, number, number];
  cache.set(key, gains);
  return gains;
}
