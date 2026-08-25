/**
 * Strip history for the live deck-waveform modulation (performance-mode
 * 09 follow-up): the waveform BEHIND the playhead shows the strip as it
 * WAS when that audio played; ahead of it, the live strip. A step series
 * in track time (the timeline's gainAt idiom): appended only on value
 * CHANGES while playing, binary-searched per modulation sample.
 *
 * Seeking/looping backward truncates the overwritten stretch — the pass
 * about to be re-heard rewrites its history. Paused moves are not
 * recorded (nothing is heard); the last-played values stand.
 */

/** The modulation values the renderer consumes (u_modTex channels: gain =
 * pre-fader trim scale, low/mid/high = EQ) plus the raw fader position —
 * the DOM fader fill rides the same history. */
export interface StripValues {
  gain: number;
  low: number;
  mid: number;
  high: number;
  fader: number;
}

const same = (a: StripValues, b: StripValues) =>
  a.gain === b.gain &&
  a.low === b.low &&
  a.mid === b.mid &&
  a.high === b.high &&
  a.fader === b.fader;

export interface StripHistory {
  /** Per-frame: the deck's playhead (track seconds) + the EFFECTIVE strip. */
  record(playhead: number, playing: boolean, values: StripValues): void;
  /** Modulation lookup: recorded values for the played past, `live` for
   * the frontier and beyond (and for time never covered). */
  at(t: number, live: StripValues): StripValues;
  /** New track / fresh deck. */
  clear(): void;
}

export function createStripHistory(): StripHistory {
  const ts: number[] = [];
  const vs: StripValues[] = [];
  /** The frontier: the latest playhead seen (t >= frontier is "future"). */
  let frontier = -Infinity;

  return {
    record(playhead: number, playing: boolean, values: StripValues): void {
      if (playhead < frontier) {
        // Seek/loop-wrap backward: the stretch ahead of the new playhead
        // is about to be re-heard — drop the stale pass.
        let lo = 0;
        let hi = ts.length;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (ts[mid] < playhead) lo = mid + 1;
          else hi = mid;
        }
        ts.length = lo;
        vs.length = lo;
      }
      frontier = playhead;
      if (!playing) return; // paused: nothing heard, nothing recorded
      const last = vs.length - 1;
      if (last >= 0 && same(vs[last], values)) return; // step dedupe
      if (last >= 0 && ts[last] === playhead) {
        vs[last] = values; // same instant: replace, keep one step per t
        return;
      }
      ts.push(playhead);
      vs.push(values);
    },

    at(t: number, live: StripValues): StripValues {
      if (t >= frontier || ts.length === 0 || t < ts[0]) return live;
      // Last step with ts[i] <= t (gainAt idiom).
      let lo = 0;
      let hi = ts.length - 1;
      while (hi - lo > 0) {
        const mid = (lo + hi + 1) >> 1;
        if (ts[mid] <= t) lo = mid;
        else hi = mid - 1;
      }
      return vs[lo];
    },

    clear(): void {
      ts.length = 0;
      vs.length = 0;
      frontier = -Infinity;
    },
  };
}
