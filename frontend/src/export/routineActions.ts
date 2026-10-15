/**
 * Deck-action callouts for the Routine video (#377): the recorded (or
 * authored) gestures a viewer should SEE — hot cues, beat jumps, loops,
 * kills, fader throws, filter sweeps, Beat FX — distilled from a Routine's
 * slot-addressed events and its planned lanes into beat-stamped labels.
 *
 * Pure. Thresholds are presentation heuristics, not capture semantics.
 */
import type { PlannedRoutine, PlannedRoutineSlot, RoutineLanePoint } from '../sets/routinePlan';
import { routineFxAt, type RoutineBeatFx } from '../editor/beatFxLane';
import { BEAT_FX_SHORT_LABELS, formatBeatFxLength } from '../playback/beatFx';

export type ActionKind =
  | 'hotCue' | 'jump' | 'loop' | 'loopOff' | 'play' | 'pause' | 'seek'
  | 'kill' | 'restore' | 'faderIn' | 'faderOut' | 'filter' | 'filterOff' | 'fx' | 'fxOff';

export interface RoutineAction {
  beat: number;
  /** Entry-ordered slot index; null = master/global. */
  slot: number | null;
  kind: ActionKind;
  label: string;
  /** Hot cue slot number (hotCue) — for the cue's color. */
  cueSlot?: number;
}

type Ev = Record<string, unknown>;

/** Lane points this close after a slot's entry are seeds, not gestures. */
const SEED_BEATS = 0.25;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function transportActions(events: Ev[]): RoutineAction[] {
  const out: RoutineAction[] = [];
  for (const e of events) {
    const beat = num(e.beat);
    const slot = num(e.slot);
    if (beat === null) continue;
    if (e.kind === 'transport' && slot !== null) {
      const action = e.action as string;
      const detail = num(e.detail);
      if (action === 'hotCue' && detail !== null) {
        out.push({ beat, slot, kind: 'hotCue', label: `HOT CUE ${detail}`, cueSlot: detail });
      } else if (action === 'jumpBeats' && detail !== null) {
        const n = Math.abs(detail);
        const unit = n % 4 === 0 ? `${n / 4} BAR${n / 4 === 1 ? '' : 'S'}` : `${n} BEAT${n === 1 ? '' : 'S'}`;
        out.push({ beat, slot, kind: 'jump', label: `${detail < 0 ? '◀' : '▶'} JUMP ${unit}` });
      } else if (action === 'seek') {
        out.push({ beat, slot, kind: 'seek', label: 'SEEK' });
      } else if (action === 'play') {
        out.push({ beat, slot, kind: 'play', label: 'PLAY' });
      } else if (action === 'pause') {
        out.push({ beat, slot, kind: 'pause', label: 'PAUSE' });
      }
    } else if (e.kind === 'loop' && slot !== null) {
      const region = e.region as { start: number; end: number } | null;
      if (region) {
        out.push({ beat, slot, kind: 'loop', label: 'LOOP' });
      } else {
        out.push({ beat, slot, kind: 'loopOff', label: 'LOOP OFF' });
      }
    }
  }
  return out;
}

/** Hysteresis gesture detection on a step lane: kills/restores on EQ,
 * in/out on the fader, engage/release on the filter. */
function laneActions(
  slot: PlannedRoutineSlot,
  control: 'fader' | 'eqLow' | 'eqMid' | 'eqHigh' | 'filter',
  points: RoutineLanePoint[],
  initial: number,
  entryBeat: number
): RoutineAction[] {
  const result: RoutineAction[] = [];
  const s = slot.slot;
  // Seed points at the slot's entry describe the state the deck ENTERED
  // with (slice-head seeds), not gestures — they still prime the
  // hysteresis but never emit a callout.
  const out = {
    push(a: RoutineAction) {
      if (a.beat > entryBeat + SEED_BEATS) result.push(a);
    },
  };
  const name = control === 'eqLow' ? 'LOW' : control === 'eqMid' ? 'MID' : control === 'eqHigh' ? 'HI' : control.toUpperCase();
  if (control === 'filter') {
    let engaged: 'lpf' | 'hpf' | null = Math.abs(initial) > 0.25 ? (initial < 0 ? 'lpf' : 'hpf') : null;
    for (const p of points) {
      const v = p.value;
      if (engaged === null && Math.abs(v) > 0.25) {
        engaged = v < 0 ? 'lpf' : 'hpf';
        out.push({ beat: p.beat, slot: s, kind: 'filter', label: engaged === 'lpf' ? 'FILTER ◀ LPF' : 'FILTER HPF ▶' });
      } else if (engaged !== null && Math.abs(v) < 0.08) {
        engaged = null;
        out.push({ beat: p.beat, slot: s, kind: 'filterOff', label: 'FILTER OFF' });
      }
    }
    return result;
  }
  if (control === 'fader') {
    let open = initial > 0.12;
    for (const p of points) {
      if (!open && p.value > 0.35) {
        open = true;
        out.push({ beat: p.beat, slot: s, kind: 'faderIn', label: 'FADER IN' });
      } else if (open && p.value < 0.08) {
        open = false;
        out.push({ beat: p.beat, slot: s, kind: 'faderOut', label: 'FADER OUT' });
      }
    }
    return result;
  }
  let killed = initial < 0.05;
  for (const p of points) {
    if (!killed && p.value < 0.05) {
      killed = true;
      out.push({ beat: p.beat, slot: s, kind: 'kill', label: `${name} KILL` });
    } else if (killed && p.value > 0.3) {
      killed = false;
      out.push({ beat: p.beat, slot: s, kind: 'restore', label: `${name} BACK` });
    }
  }
  return result;
}

function fxActions(fx: RoutineBeatFx, slotIndexOf: (slotId: string) => number | null): RoutineAction[] {
  const out: RoutineAction[] = [];
  let prevOn = false;
  let prevKey = '';
  for (const step of fx.steps) {
    const v = routineFxAt(fx, step.beat);
    const slot = v.target === 'master' ? null : slotIndexOf(v.target);
    const key = `${v.selected}:${v.target}:${v.beats}`;
    if (v.on && (!prevOn || key !== prevKey)) {
      out.push({
        beat: step.beat, slot, kind: 'fx',
        label: `${BEAT_FX_SHORT_LABELS[v.selected]} ${formatBeatFxLength(v.beats)}${v.target === 'master' ? ' → MST' : ''}`,
      });
    } else if (!v.on && prevOn) {
      out.push({ beat: step.beat, slot, kind: 'fxOff', label: 'FX OFF' });
    }
    prevOn = v.on;
    prevKey = key;
  }
  return out;
}

/** All callouts for a Routine, beat-sorted. */
export function routineActions(routine: PlannedRoutine, events: Ev[]): RoutineAction[] {
  const out: RoutineAction[] = [...transportActions(events)];
  for (const slot of routine.slots) {
    const l = slot.lanes;
    const entryBeat = (slot.entryMixSec - routine.beatOriginMixSec) / routine.secPerBeat;
    out.push(...laneActions(slot, 'fader', l.fader, l.defaults.fader, entryBeat));
    out.push(...laneActions(slot, 'eqLow', l.eqLow, l.defaults.eq, entryBeat));
    out.push(...laneActions(slot, 'eqMid', l.eqMid, l.defaults.eq, entryBeat));
    out.push(...laneActions(slot, 'eqHigh', l.eqHigh, l.defaults.eq, entryBeat));
    out.push(...laneActions(slot, 'filter', l.filter, l.defaults.filter, entryBeat));
  }
  if (routine.beatFx) {
    out.push(...fxActions(routine.beatFx, (id) => routine.slots.find((s) => s.slotId === id)?.slot ?? null));
  }
  out.sort((a, b) => a.beat - b.beat);
  return out;
}
