import { bench, describe } from 'vitest';
import { planSet, planStateAt, planStateAtRaw, type PlanInput } from './planner';

const input: PlanInput = {
  entries: [],
  tracks: {},
  transitionsByUuid: {},
  takesByUuid: {},
};
for (let i = 0; i < 93; i++) {
  const uuid = `window-${i}`;
  input.entries.push({ trackId: i, pin: i < 92 ? { kind: 'transition', uuid } : null });
  input.tracks[i] = { durationSec: 240, bpm: 120, hotCue1Sec: null };
  input.transitionsByUuid[uuid] = {
    startSec: 180,
    durationSec: 20,
    bInSec: 8,
    tempoMatch: false,
    lanes: {
      faderA: [{ x: 0, y: 0.7 }, { x: 1, y: 0 }],
      faderB: [{ x: 0, y: 0 }, { x: 1, y: 0.5 }],
    },
  };
}
const plan = planSet(input);
const samples = Array.from({ length: 4000 }, (_, i) => i * plan.totalSec / 3999);
let checksum = 0;

describe('93 windowed entries / 4000 timeline samples', () => {
  for (const evaluate of [planStateAtRaw, planStateAt]) {
    bench(evaluate.name, () => {
      for (const t of samples) {
        const state = evaluate(plan, t);
        checksum += state.lanes.A.fader + state.lanes.B.fader;
      }
      if (!Number.isFinite(checksum)) throw new Error('Invalid fader samples');
    }, { time: 2000, warmupTime: 1000 });
  }
});
