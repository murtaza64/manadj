/**
 * Kind-fluid crossings (ADR 0039, gh#330): an authored mix has no kind
 * while editing — at persist time 2 slots save as a Transition, ≥ 3 as a
 * Routine. This module is the pure translation across the boundary:
 *
 * - authoredToTransition: a 2-slot authored draft → the seconds-anchored
 *   pair payload. The window opens at the incoming's entry (the pair
 *   model: both roles play from the window start); positions come from
 *   the BUILT traces, so nudges, jumps and holds before the entry land in
 *   startSec/bInSec exactly as auditioned. In-window lanes and jumps map
 *   to x ∈ [0, 1]; trims, pauses and out-of-window events have no pair
 *   field and drop.
 * - pairToAuthoredEdits: a Transition's slot projection → an authored
 *   draft (structure + lanes + jumps), ready to grow a third slot.
 */
import type { RoutineDetailWire } from '../api/client';
import type { JumpEvent, LaneId, Lanes, Transition } from '../editor/mixModel';
import { routineFilterToPair } from '../editor/pairSlotTranslation';
import { cloneRoutineBeatFx, routineFxToPair } from '../editor/beatFxLane';
import { traceStateAt, type RoutineLanePoint } from '../sets/routinePlan';
import { normalizeAuthored, orderedSlots, structureToDetail } from './authoredMix';
import { emptyEdits, laneKey, type RoutineEdits } from './routineDraft';
import { buildEditorRoutine } from './routineEditorModel';

const CONTROL_LANE: Record<string, [LaneId, LaneId]> = {
  fader: ['faderA', 'faderB'],
  eqLow: ['eqLowA', 'eqLowB'],
  eqMid: ['eqMidA', 'eqMidB'],
  eqHigh: ['eqHighA', 'eqHighB'],
  filter: ['filterA', 'filterB'],
};
/** Shortest pair window (beats) a crossing will mint. */
const MIN_WINDOW_BEATS = 8;

function valueAt(points: RoutineLanePoint[], beat: number): number {
  if (beat <= points[0].beat) return points[0].value;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (beat <= b.beat) {
      return b.beat > a.beat ? a.value + ((beat - a.beat) / (b.beat - a.beat)) * (b.value - a.value) : b.value;
    }
  }
  return points[points.length - 1].value;
}

/** An authored envelope clipped to [from, to] and normalized to x. */
function windowLane(points: RoutineLanePoint[], from: number, to: number, filter: boolean) {
  const span = to - from;
  const y = (v: number) => (filter ? routineFilterToPair(v) : v);
  const inner = points.filter((p) => p.beat > from && p.beat < to);
  return [
    { x: 0, y: y(valueAt(points, from)) },
    ...inner.map((p) => ({ x: (p.beat - from) / span, y: y(p.value) })),
    { x: 1, y: y(valueAt(points, to)) },
  ];
}

export interface AuthoredPair {
  aTrackId: number;
  bTrackId: number;
  transition: Transition;
}

/** A 2-slot authored draft as a Transition; null when not exactly 2
 * slots, a BPM is missing, or the cast is a self-double. */
export function authoredToTransition(
  edits: RoutineEdits,
  bpmOf: (trackId: number) => number | null | undefined
): AuthoredPair | null {
  const ordered = orderedSlots(edits);
  if (!edits.authored || ordered.length !== 2) return null;
  const [A, B] = ordered;
  if (A.trackId === B.trackId) return null;
  const bpmA = bpmOf(A.trackId);
  const bpmB = bpmOf(B.trackId);
  if (!bpmA || !bpmB || bpmA <= 0 || bpmB <= 0) return null;
  const detail = structureToDetail('crossing', null, edits.authored);
  const { planned } = buildEditorRoutine(
    detail,
    detail.cast.map((id) => (id === A.trackId ? bpmA : bpmB)),
    bpmA,
    edits
  );
  const pA = planned.slots.find((s) => s.slotId === A.slotId)!;
  const pB = planned.slots.find((s) => s.slotId === B.slotId)!;
  const beatOf = (mixSec: number) => (mixSec - planned.beatOriginMixSec) / planned.secPerBeat;
  const from = beatOf(pB.entryMixSec);
  const to = Math.max(planned.playbackBounds.endBeat, from + MIN_WINDOW_BEATS);
  const lanes: Lanes = {};
  for (const [control, ids] of Object.entries(CONTROL_LANE)) {
    [A, B].forEach((slot, role) => {
      const pts = edits.lanes[laneKey(slot.slotId, control)];
      if (pts && pts.length > 0) lanes[ids[role]] = windowLane(pts, from, to, control === 'filter');
      // An authored slot without a fader lane sounds open; the pair's
      // default incoming fader ramps in — pin it open to match.
      else if (control === 'fader' && role === 1) lanes.faderB = [{ x: 0, y: 1 }, { x: 1, y: 1 }];
    });
  }
  const jumpsFor = (slotId: string): JumpEvent[] =>
    edits.jumps
      .filter((j) => j.slotId === slotId && j.beat >= from && j.beat <= to)
      .map((j) => ({
        x: (j.beat - from) / (to - from),
        deltaSec: j.deltaSec,
        ...(j.repeat && j.repeat > 1 && j.deltaSec < 0 ? { count: Math.floor(j.repeat) } : {}),
      }));
  const jumpsA = jumpsFor(A.slotId);
  const jumps = jumpsFor(B.slotId);
  // Beat FX (#353) keeps its absolute beats (steps may sit outside the
  // window — the pair model admits them).
  const beatFx = edits.beatFx
    ? routineFxToPair(edits.beatFx, (beat) => (beat - from) / (to - from),
      (slotId) => (slotId === A.slotId ? 'A' : slotId === B.slotId ? 'B' : null))
    : undefined;
  return {
    aTrackId: A.trackId,
    bTrackId: B.trackId,
    transition: {
      startSec: Math.max(0, traceStateAt(pA.trace, from).pos),
      durationSec: (to - from) * planned.secPerBeat,
      bInSec: traceStateAt(pB.trace, from + 1e-9).pos,
      tempoMatch: true,
      lanes,
      ...(jumps.length ? { jumps } : {}),
      ...(jumpsA.length ? { jumpsA } : {}),
      ...(beatFx ? { beatFx } : {}),
    },
  };
}

/** The projection writes every pair lane, defaults included; a lane flat
 * at the authored default (fader open, EQ centered, filter off) adds
 * nothing and would badge every lane as edited. */
function flatAtDefault(key: string, pts: RoutineLanePoint[]): boolean {
  const control = key.slice(key.indexOf(':') + 1);
  const d = control === 'fader' ? 1 : control === 'filter' ? 0 : 0.5;
  return pts.every((p) => Math.abs(p.value - d) < 1e-9);
}

/** A Transition's slot projection as an authored draft (structure +
 * lanes + jumps), beat 0 re-anchored on the entry slot. The routine ends
 * where the pair's window does (`windowBeats` after the incoming entry) —
 * not at the projection's whole-track authoring extent. */
export function pairToAuthoredEdits(
  detail: RoutineDetailWire,
  pairEdits: RoutineEdits,
  windowBeats: number
): RoutineEdits {
  const e: RoutineEdits = {
    ...emptyEdits(),
    lanes: Object.fromEntries(
      Object.entries(pairEdits.lanes)
        .filter(([k, v]) => !k.endsWith(':trim') && !flatAtDefault(k, v))
        .map(([k, v]) => [k, v.map((p) => ({ ...p }))])
    ),
    jumps: pairEdits.jumps.map((j) => ({ ...j })),
    ...(pairEdits.beatFx ? { beatFx: cloneRoutineBeatFx(pairEdits.beatFx) } : {}),
    authored: {
      slots: detail.cast.map((trackId, i) => ({
        slotId: detail.slot_ids?.[i] ?? String(i),
        trackId,
        entryBeat: detail.entry_offsets_beats[i],
        entryPos: detail.entry_positions[i],
      })),
      durationBeats: Math.max(...detail.entry_offsets_beats) + windowBeats,
    },
  };
  normalizeAuthored(e);
  return e;
}
