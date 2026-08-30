/**
 * Stem-mask history (stems #213): the deck waveform BEHIND the playhead
 * shows the stems that were actually audible when that audio played;
 * ahead of it, the live kill state — the stripHistory idiom applied to
 * the per-stem mask (STEM_NAMES order, 0/1 per stem).
 *
 * Module-level per-deck registry: the deck strip and the minimap render
 * from the same history, and whichever surface's recorder loop runs
 * feeds it (recording is idempotent — same values dedupe to one step).
 */
import type { ChannelId } from '../playback/mixer';

export type StemMask = readonly [number, number, number, number];

export const ALL_ON: StemMask = [1, 1, 1, 1];

const same = (a: StemMask, b: StemMask) =>
  a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];

export interface StemMaskHistory {
  record(playhead: number, playing: boolean, mask: StemMask): void;
  at(t: number, live: StemMask): StemMask;
  clear(): void;
}

function createStemMaskHistory(): StemMaskHistory {
  const ts: number[] = [];
  const vs: StemMask[] = [];
  let frontier = -Infinity;
  return {
    record(playhead, playing, mask) {
      if (playhead < frontier) {
        // Seek/loop-wrap backward: the stretch about to be re-heard
        // rewrites its history (stripHistory semantics).
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
      if (!playing) return;
      const last = vs.length - 1;
      if (last >= 0 && same(vs[last], mask)) return;
      if (last >= 0 && ts[last] === playhead) {
        vs[last] = mask;
        return;
      }
      ts.push(playhead);
      vs.push(mask);
    },
    at(t, live) {
      if (t >= frontier || ts.length === 0 || t < ts[0]) return live;
      let lo = 0;
      let hi = ts.length - 1;
      while (hi - lo > 0) {
        const mid = (lo + hi + 1) >> 1;
        if (ts[mid] <= t) lo = mid;
        else hi = mid - 1;
      }
      return vs[lo];
    },
    clear() {
      ts.length = 0;
      vs.length = 0;
      frontier = -Infinity;
    },
  };
}

const histories = new Map<ChannelId, StemMaskHistory>();

export function stemMaskHistoryFor(deck: ChannelId): StemMaskHistory {
  let h = histories.get(deck);
  if (!h) {
    h = createStemMaskHistory();
    histories.set(deck, h);
  }
  return h;
}
