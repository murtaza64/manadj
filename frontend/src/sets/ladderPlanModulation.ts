/**
 * Ladder waveform modulation from PLAN state (sets #171).
 *
 * Session-timeline parity: the Session timeline modulates its styled
 * waveforms from the RECORDED mixer control steps (waveformLanes'
 * `columnModulation`); the ladder modulates from the PLAN — the same
 * `planStateAt` lanes the Conductor executes — so what you see is what
 * the Conductor will do. Both surfaces speak the same `ColumnModulation`
 * contract into the shared style interpreter (ladderWaveStyle): fader ×
 * trim scale the column's height through the real gain curves, EQ kills
 * zero their band group's amplitudes (the group's color drops out of the
 * column). Filter is deliberately excluded, matching the session
 * timeline's control-lane choice.
 */

import { channelFaderToGain, trimToGain } from '../playback/mixerMath';
import { eqValueToGain } from '../playback/graph';
import type { ColumnModulation } from './ladderWaveStyle';
import { planStateAt, type PlanDeck, type SetPlan } from './planner';

/** Display normalizer — twin of waveformLanes' NOMINAL_STRIP_GAIN: the
 * nominal strip (trim centered, fader up, EQ flat) renders unmodified;
 * boosts saturate at 2× (heights clamp at the lane rail downstream). */
const NOMINAL_PLAN_GAIN = trimToGain(0.5) * channelFaderToGain(1);

/** Coarsest mix-time sampling interval. Plan lanes are smooth ramps over
 * seconds, so at high zoom (many columns per second) neighbouring columns
 * share a planStateAt sample — bounding the O(entries) evaluator to at
 * most ~20 calls per mix-second regardless of canvas width. At low zoom
 * every column gets its own sample (can't do better than per-pixel). */
const SAMPLE_SEC = 0.05;

/**
 * Build a per-column `ColumnModulation` source for one ladder clip:
 * `cols` canvas columns spanning `mixRange` (mix time, the clip's
 * `[entryMixSec, exitMixSec]`), reading `planStateAt(plan, t).lanes[deck]`.
 *
 * Cursor-cached for the renderer's monotonic left-to-right column walk
 * (same access pattern createColumnModulator serves on the session side);
 * out-of-order calls still return correct values, just without reuse.
 *
 * A column where the deck is NOT playing renders silent (scale 0) — the
 * `playing × fader` gate sampleFaderLevels already uses — so a clip never
 * shows body the Conductor won't produce.
 */
export function planColumnModulator(
  plan: SetPlan,
  deck: PlanDeck,
  mixRange: [number, number],
  cols: number,
): (x: number) => ColumnModulation {
  const [m0, m1] = mixRange;
  const span = Math.max(m1 - m0, 1e-3);
  const stride = Math.max(1, Math.floor((SAMPLE_SEC * cols) / span));
  let cachedBucket = -1;
  let cached: ColumnModulation = { eq: [1, 1, 1], scale: 1 };
  return (x: number) => {
    const bucket = Math.floor(x / stride);
    if (bucket === cachedBucket) return cached;
    cachedBucket = bucket;
    const mixTime = m0 + ((x + 0.5) / cols) * span;
    const s = planStateAt(plan, mixTime);
    const lanes = s.lanes[deck];
    const fader = s.decks[deck].playing ? lanes.fader : 0;
    const gain = channelFaderToGain(fader) * trimToGain(lanes.trim ?? 0.5);
    cached = {
      eq: [
        eqValueToGain(lanes.eq.low),
        eqValueToGain(lanes.eq.mid),
        eqValueToGain(lanes.eq.high),
      ],
      scale: Math.min(2, gain / NOMINAL_PLAN_GAIN),
    };
    return cached;
  };
}
