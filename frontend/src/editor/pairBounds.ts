import { isDeckAudible, isDeckSounding } from '../capture/audibility';
import { DEFAULT_DETECTOR_PARAMS } from '../capture/events';
import { channelFaderToGain, trimToGain } from '../playback/mixerMath';
import {
  aContentSegments, bContentSegments, defaultLanePoints, jumpRepeatCount,
  lanePoints, laneValuesAt, LANE_IDS, type Transition,
} from './mixModel';

export interface PairBounds {
  handover: { enter: number; exit: number } | null;
  outgoingEnd: number;
  authoringEnd: number;
}

/** Outgoing setup may precede the coordinate frame; hidden stashes are not controls. */
export function outgoingAutomationStart(tr: Transition): number {
  let start = tr.startSec;
  for (const id of LANE_IDS) {
    if (!id.endsWith('A') || tr.hiddenLanes?.includes(id)) continue;
    for (const p of tr.lanes[id] ?? []) start = Math.min(start, tr.startSec + p.x * tr.durationSec);
  }
  for (const j of tr.jumpsA ?? []) start = Math.min(start, tr.startSec + j.x * tr.durationSec);
  return Math.max(0, start);
}

/** Exact control/transport intervals, not waveform levels or a sampled clock.
 * The stored window is an automation coordinate frame, never a transport stop. */
export function pairBounds(tr: Transition, durations: { a: number; b: number }, rateB: number): PairBounds {
  const params = DEFAULT_DETECTOR_PARAMS;
  const outgoingStart = outgoingAutomationStart(tr);
  const mixer = { crossfader: 0, crossfaderEnabled: false };
  const segments = [aContentSegments(tr, durations.a), bContentSegments(tr, durations.b, rateB)];
  const times = new Set<number>([0, tr.startSec]);
  for (const spans of segments) for (const s of spans) {
    times.add(s.mixStartSec);
    times.add(s.mixEndSec);
  }
  // Invert the actual fader gain curve once, in control space.
  let lo = 0, hi = 1;
  for (let i = 0; i < 52; i++) {
    const mid = (lo + hi) / 2;
    if (trimToGain(0.5) * channelFaderToGain(mid) < params.audibleGain) lo = mid;
    else hi = mid;
  }
  for (const id of LANE_IDS) {
    const points = tr.hiddenLanes?.includes(id)
      ? defaultLanePoints(id, tr.durationSec) : lanePoints(tr.lanes, id, tr.durationSec);
    const thresholds = id.startsWith('fader') ? [0, hi]
      : id.startsWith('filter') ? [(1 - params.filterKillBeyond) / 2, (1 + params.filterKillBeyond) / 2]
        : [params.eqKillBelow];
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      times.add(tr.startSec + p.x * tr.durationSec);
      const q = points[i + 1];
      if (!q || q.y === p.y) continue;
      for (const value of thresholds) {
        const fraction = (value - p.y) / (q.y - p.y);
        if (fraction > 0 && fraction < 1)
          times.add(tr.startSec + (p.x + fraction * (q.x - p.x)) * tr.durationSec);
      }
    }
  }
  const ordered = [...times].filter(Number.isFinite).sort((a, b) => a - b);
  const intervals = ordered.slice(1).map((end, i) => {
    const start = ordered[i];
    const t = (start + end) / 2;
    const v = laneValuesAt(tr, t);
    if (t < outgoingStart) Object.assign(v, { faderA: 1, eqLowA: 0.5, eqMidA: 0.5, eqHighA: 0.5, filterA: 0.5 });
    const states = ['A', 'B'].map((role, slot) => {
      const r = role as 'A' | 'B';
      const d = {
        playing: segments[slot].some((s) => t >= s.mixStartSec && t < s.mixEndSec),
        fader: v[`fader${r}`], trim: 0.5, assignment: 'thru' as const,
        eq: { low: v[`eqLow${r}`], mid: v[`eqMid${r}`], high: v[`eqHigh${r}`] },
        filter: v[`filter${r}`] * 2 - 1,
      };
      return { sounding: isDeckSounding(d, mixer, params), audible: isDeckAudible(d, mixer, params) };
    });
    return { start, end, states };
  });
  const outgoing = intervals.filter((s) => s.states[0].sounding);
  const outgoingEnd = outgoing.at(-1)?.end ?? 0;
  const incoming = intervals.filter((s) => s.states[1].sounding);
  const enter = incoming[0]?.start;
  const incomingRuns: { start: number; end: number; audibleEnd: number }[] = [];
  for (const s of incoming) {
    const run = incomingRuns.at(-1);
    if (run && run.end === s.start) {
      run.end = s.end;
      if (s.states[1].audible) run.audibleEnd = s.end;
    } else incomingRuns.push({ start: s.start, end: s.end, audibleEnd: s.states[1].audible ? s.end : -Infinity });
  }
  const survives = incomingRuns.some((s) => s.start <= outgoingEnd + params.cutGapMaxS && s.audibleEnd > outgoingEnd);
  const handover = outgoing.length && enter !== undefined && enter <= outgoingEnd + params.cutGapMaxS && survives
    ? { enter: Math.min(enter, outgoingEnd), exit: outgoingEnd } : null;
  let authoringEnd = Math.max(tr.startSec + tr.durationSec, ...ordered);
  // Retain hidden envelopes and unreachable setup/events as authored material.
  for (const points of Object.values(tr.lanes)) for (const p of points ?? [])
    authoringEnd = Math.max(authoringEnd, tr.startSec + p.x * tr.durationSec);
  for (const [jumps, rate] of [[tr.jumpsA, 1], [tr.jumps, rateB]] as const)
    for (const j of jumps ?? []) authoringEnd = Math.max(authoringEnd,
      tr.startSec + j.x * tr.durationSec + (jumpRepeatCount(j) - 1) * Math.max(0, -j.deltaSec) / rate);
  return { handover, outgoingEnd, authoringEnd };
}

/** Resize only the coordinate frame. No authored point or setup jump is cropped. */
export function normalizePairWindow(tr: Transition, bounds: PairBounds, rateB = 1): Transition {
  let end = bounds.handover?.exit ?? bounds.outgoingEnd;
  let start = tr.startSec;
  for (const points of Object.values(tr.lanes)) for (const p of points ?? []) {
    start = Math.min(start, tr.startSec + p.x * tr.durationSec);
    end = Math.max(end, tr.startSec + p.x * tr.durationSec);
  }
  for (const [jumps, rate] of [[tr.jumpsA, 1], [tr.jumps, rateB]] as const)
    for (const j of jumps ?? []) {
      start = Math.min(start, tr.startSec + j.x * tr.durationSec);
      end = Math.max(end, tr.startSec + j.x * tr.durationSec
        + (jumpRepeatCount(j) - 1) * Math.max(0, -j.deltaSec) / rate);
    }
  start = Math.max(0, start);
  // A hidden fader keeps its stash, but evaluates the default on startSec.
  // Keep that origin rather than moving the default or overwriting the stash.
  if (tr.hiddenLanes?.includes('faderB')) start = tr.startSec;
  const durationSec = Math.max(end - start, 1e-6);
  if (start === tr.startSec && durationSec === tr.durationSec) return tr;
  const x = (value: number) => (tr.startSec + value * tr.durationSec - start) / durationSec;
  const lanes = { ...tr.lanes };
  // Defaults have geometry too (notably B's short-window fade).
  for (const id of LANE_IDS) {
    const points = lanes[id] ?? defaultLanePoints(id, tr.durationSec);
    lanes[id] = points.map((p) => ({ ...p, x: x(p.x) }));
  }
  if (start < tr.startSec && (tr.lanes.faderB?.[0]?.x ?? 0) >= 0) {
    lanes.faderB = [{ x: 0, y: 0 }, { x: x(0), y: 0 }, ...lanes.faderB!];
  }
  return {
    ...tr, startSec: start, durationSec, bInSec: tr.bInSec + (start - tr.startSec) * rateB,
    lanes,
    jumpsA: tr.jumpsA?.map((j) => ({ ...j, x: x(j.x) })),
    jumps: tr.jumps?.map((j) => ({ ...j, x: x(j.x) })),
  };
}

/** Admit edits outside the old frame before evaluating transport or handover. */
export function pairAuthoringTransition(tr: Transition, rateB: number): Transition {
  return normalizePairWindow(tr, {
    handover: null, outgoingEnd: tr.startSec + tr.durationSec,
    authoringEnd: tr.startSec + tr.durationSec,
  }, rateB);
}
