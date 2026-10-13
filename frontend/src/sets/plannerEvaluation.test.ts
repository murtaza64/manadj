import { expect, it } from 'vitest';
import { PLAN_DECKS, planStateAtRaw, type SetPlan } from './planner';

it('keeps array precedence for overlapping, unordered and degenerate occupants on all decks', () => {
  const plan: SetPlan = {
    entries: PLAN_DECKS.flatMap((deck) =>
      [[20, 30], [10, 25], [0, 15], [12, 12], [18, 8]].map(([start, end], i) => ({
        deck, trackId: i, entryMixSec: start, exitMixSec: end,
        entrySec: 2, exitSec: 2 + end - start, mixOffsetSec: start - 2, rate: 1, trim: 0,
      }))
    ),
    adjacencies: [], routines: [], cameos: [], warnings: [], totalSec: 30,
  };
  for (const t of [-1, 0, 8, 10, 12, 15, 18, 20, 25, 30, Infinity, NaN]) {
    const state = planStateAtRaw(plan, t);
    let activeEntryIndex = 0;
    plan.entries.forEach((e, i) => {
      if (e.entryMixSec <= t) activeEntryIndex = i;
    });
    expect(state.activeEntryIndex).toBe(activeEntryIndex);
    for (const deck of PLAN_DECKS) {
      // Original per-deck selection, deliberately independent of time ordering.
      let active: number | null = null;
      let upcoming: number | null = null;
      let past: number | null = null;
      plan.entries.forEach((e, i) => {
        if (e.deck !== deck) return;
        if (t >= e.entryMixSec && t < e.exitMixSec) active = i;
        else if (e.entryMixSec > t) upcoming = upcoming ?? i;
        else past = i;
      });
      const idx = (active ?? upcoming ?? past)!;
      const entry = plan.entries[idx];
      const playing = !state.done && idx === active;
      expect(state.decks[deck]).toEqual({
        entryIndex: idx, trackId: entry.trackId, playing, pitchPercent: 0,
        trackTime: playing ? t - entry.mixOffsetSec
          : Math.max(0, idx === active || idx === upcoming ? entry.entrySec : entry.exitSec),
      });
    }
  }
});
