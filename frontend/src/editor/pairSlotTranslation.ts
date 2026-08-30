/**
 * Pair↔slot translation (ADR 0037, PRD mix-editor-supersession phase 1).
 *
 * The Mix editor is the Routine editor's slot surface. A Transition (or
 * Cameo) is a PAIR artifact — seconds-anchored, context-free (ADR 0010) —
 * that projects onto the slot surface as the 2-slot special case the
 * routine draft model was built to absorb ("a pair IS the 2-slot special
 * case", routineDraft.ts). This module is the boundary translator: it does
 * NOT give pairs their own algebra inside the editor.
 *
 * ## Projection (load): Transition → RoutineDetailWire
 *
 * - The routine clock runs at the OUTGOING's tempo (targetBpm = bpmA), so
 *   `secPerBeat = 60/bpmA` and beat 0 = the window start.
 * - Slot 0 = outgoing (A), anchored at the window start: entry offset 0,
 *   entry position = A's track-time there (the Sketch origin invariant
 *   makes that `startSec` without outgoing jumps).
 * - Slot 1 = incoming (B): entry offset 0, entry position = `bInSec` (the
 *   incoming's entry alignment; negative = a silent lead gap — the routine
 *   trace parks a below-zero position, matching arrangementAt's deferral).
 * - Both tracks play LINEARLY across the window in the synthetic
 *   recording: two tick samples per slot (window start + end). The
 *   incoming's per-beat rate carries its tempo-match varispeed (rateB), so
 *   the routine's trace-slope pitch re-anchoring reproduces the pair's
 *   playback rate exactly. Lanes and jumps become authored EDITS, not
 *   recording, so an unedited pair yields an empty-edits routine and every
 *   authored field is a re-derivable edit.
 *
 * ## Re-derivation (save): RoutineEdits → Transition
 *
 * The pair artifact stays the source of truth. Save re-derives ONLY the
 * fields whose edits are present, on a clone of the ORIGINAL Transition —
 * so untouched fields round-trip byte-identically (no seconds↔beats
 * quantization drift on an unedited window; ADR 0037's first invariant).
 * The exit test: open a Transition, audition, save without edits →
 * byte-identical artifact; edit one lane point → only that field
 * re-derived.
 *
 * ## Gridless degrade
 *
 * A track without a Beatgrid has no BPM; the pair still edits in a
 * DEGRADED SECONDS mode — `secPerBeat` falls back to a 1-beat-per-second
 * synthetic clock so the surface is never locked out (ADR 0037's second
 * invariant). Slot ↔ seconds math stays exact; only the beat READOUTS lose
 * meaning, which the surface renders as seconds.
 */
import {
  LANE_IDS,
  jumpRepeatCount,
  tempoMatchRatio,
  type LaneId,
  type Transition,
} from './mixModel';
import { laneKey, type AuthoredJump, type RoutineEdits } from '../routines/routineDraft';
import type { RoutineDetailWire } from '../api/client';
import type { RoutineLanePoint } from '../sets/routinePlan';

/** Degraded-mode fallback: with no grid, one beat = one second, so the
 * slot surface still has a clock and the seconds math is untouched. */
const DEGRADED_SEC_PER_BEAT = 1;

/** A pair projected onto the slot surface. Carries the synthetic detail
 * the routine build consumes, the live authored edits, and the geometry
 * needed to re-derive the artifact on save. */
export interface PairSlotProjection {
  detail: RoutineDetailWire;
  edits: RoutineEdits;
  /** Track BPMs per slot ([bpmA, bpmB]) for buildEditorRoutine; null in a
   * degraded slot (fed as the degraded clock's implied BPM). */
  trackBpms: number[];
  /** targetBpm for the routine clock = bpmA (or the degraded clock). */
  targetBpm: number;
  /** Seconds-per-beat of the projection's routine clock — the axis every
   * beat↔seconds conversion in save() rides. */
  secPerBeat: number;
  /** True when the outgoing track lacked a grid: beat readouts are
   * seconds, but editing is never blocked. */
  degraded: boolean;
}

export interface PairSlotInput {
  /** Stable artifact identity (the SavedTransition uuid). */
  uuid: string;
  name: string;
  transition: Transition;
  trackAId: number;
  trackBId: number;
  /** Outgoing / incoming BPMs (null = gridless). bpmA drives the clock. */
  bpmA: number | null;
  bpmB: number | null;
}

// ── Load: Transition → slot projection ──────────────────────────────────

/** Map a pair role to the slot the surface addresses it as. Slot ids are
 * the migration-identity strings (ADR 0039: slotId = String(index) for
 * non-authored casts) — the projection is a synthetic recording, so the
 * index identity is exact. */
export const OUTGOING_SLOT = '0';
export const INCOMING_SLOT = '1';

/** The routine control key each pair lane maps to (per slot). Pair lane
 * ids are role-suffixed (`faderA`/`faderB`); the routine keys them
 * `${slot}:${control}`. Filter is the one value-space shift — see
 * pairFilterToRoutine. */
const LANE_ROLE: Record<LaneId, { slotId: string; control: string }> = {
  faderA: { slotId: OUTGOING_SLOT, control: 'fader' },
  faderB: { slotId: INCOMING_SLOT, control: 'fader' },
  eqLowA: { slotId: OUTGOING_SLOT, control: 'eqLow' },
  eqLowB: { slotId: INCOMING_SLOT, control: 'eqLow' },
  eqMidA: { slotId: OUTGOING_SLOT, control: 'eqMid' },
  eqMidB: { slotId: INCOMING_SLOT, control: 'eqMid' },
  eqHighA: { slotId: OUTGOING_SLOT, control: 'eqHigh' },
  eqHighB: { slotId: INCOMING_SLOT, control: 'eqHigh' },
  filterA: { slotId: OUTGOING_SLOT, control: 'filter' },
  filterB: { slotId: INCOMING_SLOT, control: 'filter' },
};

/** The incoming's playback rate under tempo match (varispeed): the
 * octave-folded BPM ratio, or 1 when tempo-match is off or a grid is
 * missing. This is `rateB` in mixModel's arrangement math. */
export function incomingRate(tr: Transition, bpmA: number | null, bpmB: number | null): number {
  if (!tr.tempoMatch) return 1;
  const ratio = tempoMatchRatio(bpmA, bpmB);
  return ratio ?? 1;
}

/** Pair filter value (0.5 = off) → routine filter value (0 = off,
 * −1..1). The routine filter default is 0; a pair filter lane at 0.5 must
 * read as routine 0. Linear map: 0→−1, 0.5→0, 1→+1. */
export function pairFilterToRoutine(y: number): number {
  return y * 2 - 1;
}

/** Routine filter value (−1..1, 0 = off) → pair filter value (0..1,
 * 0.5 = off). The inverse of pairFilterToRoutine. */
export function routineFilterToPair(v: number): number {
  return (v + 1) / 2;
}

/** Project a Transition into slot-surface form. Pure. */
export function transitionToProjection(input: PairSlotInput): PairSlotProjection {
  const { transition: tr, bpmA, bpmB } = input;
  const degraded = bpmA === null || bpmA <= 0;
  const clockBpm = degraded ? 60 / DEGRADED_SEC_PER_BEAT : bpmA;
  const secPerBeat = 60 / clockBpm;
  const durationBeats = tr.durationSec / secPerBeat;
  const rateB = incomingRate(tr, bpmA, bpmB);

  // Slot BPMs: A rides the clock (native); B rides its own so the
  // trace-slope pitch re-anchoring reproduces rateB. A gridless track
  // reads as the clock BPM (no varispeed to reproduce).
  const bpmASlot = degraded ? clockBpm : bpmA!;
  const bpmBSlot = bpmB && bpmB > 0 ? bpmB : clockBpm;

  const detail: RoutineDetailWire = {
    uuid: input.uuid,
    name: input.name,
    cast: [input.trackAId, input.trackBId],
    entry_offsets_beats: [0, 0],
    entry_positions: [aEntryPosition(tr), tr.bInSec],
    duration_beats: durationBeats,
    origin_take_uuid: null,
    created_at: null,
    events: syntheticEvents(tr, durationBeats, secPerBeat, rateB, bpmASlot, bpmBSlot),
    edits: null,
  };

  return {
    detail,
    edits: pairToEdits(tr, durationBeats),
    trackBpms: [bpmASlot, bpmBSlot],
    targetBpm: clockBpm,
    secPerBeat,
    degraded,
  };
}

/** The outgoing's track-time at the window start. The Sketch origin
 * invariant makes it `startSec` with no outgoing jumps (mix time ≡ A's
 * elapsed play). Outgoing jumps live within the window (x∈[0,1]), so the
 * entry position is still `startSec`. */
function aEntryPosition(tr: Transition): number {
  return tr.startSec;
}

/**
 * The synthetic recording: two tick samples per slot (window start + end)
 * so buildSlotTrace classifies each span as a single moving segment. The
 * outgoing advances at its native rate (1 track-sec per mix-sec); the
 * incoming at rateB. Per-beat positions:
 *   posEnd = posStart + rate * durationBeats * secPerBeat
 * A gridless slot advances at its degraded clock (rate 1 in the clock's
 * seconds), still a valid moving trace.
 *
 * The recording carries NO control events — the pair's lanes are authored
 * EDITS, so an unedited pair has empty edits and a bare recording (the
 * lossless-save premise).
 */
function syntheticEvents(
  tr: Transition,
  durationBeats: number,
  secPerBeat: number,
  rateB: number,
  _bpmASlot: number,
  _bpmBSlot: number
): Record<string, unknown>[] {
  const aStart = aEntryPosition(tr);
  const aEnd = aStart + 1 * durationBeats * secPerBeat;
  const bStart = tr.bInSec;
  const bEnd = bStart + rateB * durationBeats * secPerBeat;
  return [
    {
      kind: 'tick',
      beat: 0,
      playheads: { [OUTGOING_SLOT]: aStart, [INCOMING_SLOT]: bStart },
    },
    {
      kind: 'tick',
      beat: durationBeats,
      playheads: { [OUTGOING_SLOT]: aEnd, [INCOMING_SLOT]: bEnd },
    },
  ];
}

/** Project the pair's lanes + jumps into authored edits on the beat clock.
 * Lanes with no drawn points stay absent (the surface renders the routine
 * default) — only DRAWN pair lanes become authored envelopes, so an
 * unedited pair yields empty edits. */
export function pairToEdits(tr: Transition, durationBeats: number): RoutineEdits {
  const lanes: Record<string, RoutineLanePoint[]> = {};
  const hidden = new Set(tr.hiddenLanes ?? []);
  for (const id of LANE_IDS) {
    const pts = tr.lanes[id];
    if (!pts || pts.length === 0 || hidden.has(id)) continue;
    const role = LANE_ROLE[id];
    const isFilter = role.control === 'filter';
    lanes[laneKey(role.slotId, role.control)] = pts.map((p) => ({
      beat: p.x * durationBeats,
      value: isFilter ? pairFilterToRoutine(p.y) : p.y,
    }));
  }

  const jumps: AuthoredJump[] = [];
  for (const j of tr.jumpsA ?? []) {
    jumps.push(pairJumpToAuthored(j, OUTGOING_SLOT, durationBeats));
  }
  for (const j of tr.jumps ?? []) {
    jumps.push(pairJumpToAuthored(j, INCOMING_SLOT, durationBeats));
  }

  return {
    lanes,
    jumps,
    removedRecordedJumps: [],
    pauses: [],
    removedRecordedPauses: [],
    nudges: {},
    trims: {},
    entryOffsets: {},
  };
}

function pairJumpToAuthored(
  j: { x: number; deltaSec: number; count?: number },
  slotId: string,
  durationBeats: number
): AuthoredJump {
  const beat = j.x * durationBeats;
  const repeat = jumpRepeatCount({ x: j.x, deltaSec: j.deltaSec, count: j.count });
  return {
    id: `${slotId}:${beat}`,
    slotId,
    beat,
    deltaSec: j.deltaSec,
    repeat: repeat > 1 ? repeat : undefined,
  };
}

// ── Save: RoutineEdits → Transition (lossless re-derivation) ─────────────

export interface PairSaveContext {
  /** The ORIGINAL artifact — the source of truth for untouched fields. */
  original: Transition;
  /** The projection's window in beats: the axis beats → normalized x
   * (x = beat / durationBeats) rides on. */
  durationBeats: number;
  /** The projection's seconds-per-beat. Carried for symmetry with the
   * projection and future seconds-domain re-derivation; the current lane/
   * jump save uses only the normalized-x mapping (durationBeats). */
  secPerBeat: number;
}

/**
 * Re-derive a Transition from the routine draft, touching ONLY edited
 * fields. Untouched fields pass through from the original by reference
 * value — no re-projection, so no seconds↔beats round-trip drift on an
 * unedited window. Returns the SAME object shape a pair save serializes.
 *
 * - Authored LANE envelopes → the corresponding pair lane (beats → x;
 *   filter value-space unmapped). A lane never drawn stays as the original
 *   had it.
 * - Authored JUMPS → jumpsA (slot 0 = outgoing) / jumps (slot 1 =
 *   incoming). Only present when the draft carries jumps for that role;
 *   otherwise the original's jumps pass through.
 * - Alignment NUDGE on the incoming slot slides `bInSec` (a rigid
 *   track-seconds slide is exactly the incoming entry-alignment shift).
 * - Everything else (startSec, durationSec, tempoMatch, hiddenLanes,
 *   untouched lanes/jumps) is the original's, verbatim.
 */
export function editsToTransition(edits: RoutineEdits, ctx: PairSaveContext): Transition {
  const { original, durationBeats } = ctx;
  // Clone so we never mutate the source of truth. Structured-ish clone of
  // the nested lanes/jumps is only needed for the fields we touch, but a
  // shallow clone with fresh lanes keeps the untouched fields identical.
  const out: Transition = { ...original, lanes: { ...original.lanes } };

  // Lanes: replace only the roles the draft authored.
  for (const [key, pts] of Object.entries(edits.lanes)) {
    const role = parseLaneKey(key);
    if (!role) continue;
    const laneId = laneIdFor(role.slotId, role.control);
    if (!laneId) continue;
    const isFilter = role.control === 'filter';
    out.lanes[laneId] = pts.map((p) => ({
      x: durationBeats > 0 ? p.beat / durationBeats : 0,
      y: isFilter ? routineFilterToPair(p.value) : p.value,
    }));
  }

  // Jumps: re-derive per role only when the draft carries jumps for it.
  const outgoingJumps = edits.jumps.filter((j) => j.slotId === OUTGOING_SLOT);
  const incomingJumps = edits.jumps.filter((j) => j.slotId === INCOMING_SLOT);
  if (outgoingJumps.length > 0) {
    out.jumpsA = outgoingJumps.map((j) => authoredJumpToPair(j, durationBeats));
  }
  if (incomingJumps.length > 0) {
    out.jumps = incomingJumps.map((j) => authoredJumpToPair(j, durationBeats));
  }

  // Incoming alignment nudge → bInSec (a rigid track-seconds slide).
  const nudgeB = edits.nudges[INCOMING_SLOT];
  if (typeof nudgeB === 'number' && nudgeB !== 0) {
    out.bInSec = original.bInSec + nudgeB;
  }
  // An outgoing nudge slides the window start in the outgoing's own
  // seconds (startSec is the outgoing's entry position).
  const nudgeA = edits.nudges[OUTGOING_SLOT];
  if (typeof nudgeA === 'number' && nudgeA !== 0) {
    out.startSec = Math.max(0, original.startSec + nudgeA);
  }

  return out;
}

/**
 * The CHANGED subset of a live draft's edits against the projection's
 * baseline (#205): the editor's draft holds the WHOLE projection (every
 * drawn lane/jump became an authored edit on load), so feeding the full
 * draft to editsToTransition would re-derive untouched fields through the
 * beats→x float round-trip — drift the lossless invariant forbids. This
 * diff keeps only what actually changed since load (deep equality — the
 * draft store clones on load, so references never match):
 *
 * - lanes: per key, dropped when point-for-point equal to the baseline;
 * - jumps: per ROLE (slot), dropped when the slot's list is unchanged —
 *   an incoming-jump edit must not re-derive untouched outgoing jumps;
 * - nudges/trims: per slot, dropped when equal (or both absent).
 *
 * editsToTransition(changedPairEdits(draft, baseline), ctx) then touches
 * only genuinely edited fields; everything else passes through verbatim.
 */
export function changedPairEdits(draft: RoutineEdits, baseline: RoutineEdits): RoutineEdits {
  const lanes: Record<string, RoutineLanePoint[]> = {};
  for (const [key, pts] of Object.entries(draft.lanes)) {
    const base = baseline.lanes[key];
    if (!base || !lanePointsEqual(pts, base)) lanes[key] = pts;
  }
  // A lane cleared back to "recorded plays" (key deleted from the draft)
  // has no pair-side meaning yet — the original lane persists. Flagged in
  // the module header's scope notes.

  const jumps: AuthoredJump[] = [];
  const slotIds = new Set([...draft.jumps, ...baseline.jumps].map((j) => j.slotId));
  for (const slotId of slotIds) {
    const d = draft.jumps.filter((j) => j.slotId === slotId);
    const b = baseline.jumps.filter((j) => j.slotId === slotId);
    if (!jumpListsEqual(d, b)) jumps.push(...d);
  }

  const nudges: Record<string, number> = {};
  for (const [slot, v] of Object.entries(draft.nudges)) {
    if ((baseline.nudges[slot] ?? 0) !== v) nudges[slot] = v;
  }
  const trims: Record<string, number> = {};
  for (const [slot, v] of Object.entries(draft.trims)) {
    if ((baseline.trims[slot] ?? 0.5) !== v) trims[slot] = v;
  }

  return {
    lanes,
    jumps,
    // A pair projection's synthetic recording has no recorded jumps or
    // pauses, so removals cannot occur — empty by construction. Authored
    // PAUSES have no Transition-side field (the artifact cannot express a
    // hold; a jump can't fake one) — they audition but do not persist,
    // flagged as a phase-2 design item.
    removedRecordedJumps: [],
    pauses: [],
    removedRecordedPauses: [],
    nudges,
    trims,
    // Entry-offset overrides (ADR 0039 / #207 slice 2) are NOT
    // pair-persistable: on a 2-slot artifact a reorder is an A/B swap —
    // a DIFFERENT pair row (kind-conversion territory, #198). Gated like
    // pauses; audition-only until that lands.
    entryOffsets: {},
  };
}

function lanePointsEqual(a: RoutineLanePoint[], b: RoutineLanePoint[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].beat !== b[i].beat || a[i].value !== b[i].value) return false;
  }
  return true;
}

function jumpListsEqual(a: AuthoredJump[], b: AuthoredJump[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].beat !== b[i].beat ||
      a[i].deltaSec !== b[i].deltaSec ||
      (a[i].repeat ?? 1) !== (b[i].repeat ?? 1)
    ) {
      return false;
    }
  }
  return true;
}

function authoredJumpToPair(
  j: AuthoredJump,
  durationBeats: number
): { x: number; deltaSec: number; count?: number } {
  const x = durationBeats > 0 ? j.beat / durationBeats : 0;
  const out: { x: number; deltaSec: number; count?: number } = { x, deltaSec: j.deltaSec };
  if (j.repeat && j.repeat > 1 && j.deltaSec < 0) out.count = Math.floor(j.repeat);
  return out;
}

function parseLaneKey(key: string): { slotId: string; control: string } | null {
  const idx = key.indexOf(':');
  if (idx < 0) return null;
  return { slotId: key.slice(0, idx), control: key.slice(idx + 1) };
}

/** Inverse of LANE_ROLE: (slotId, control) → pair lane id. */
function laneIdFor(slotId: string, control: string): LaneId | null {
  for (const id of LANE_IDS) {
    const role = LANE_ROLE[id];
    if (role.slotId === slotId && role.control === control) return id;
  }
  return null;
}

// ── New pair drafts (#205, ADR 0037 pair synthesis) ─────────────────────

/** New blank pair drafts seed the window at the outgoing's OUTRO — the
 * last ~32 beats on the outgoing's clock (degraded 1-beat/sec without a
 * grid). The incoming enters at its start (bInSec 0; grid-aligned entry
 * refinement is a picker-round design item). Draft posture (ADR 0037/
 * 0039): the seeded Transition persists NOTHING until the first edit. */
export const NEW_PAIR_SEED_BEATS = 32;

export function seedNewTransition(outgoingDurationSec: number, bpmA: number | null): Transition {
  const secPerBeat = bpmA && bpmA > 0 ? 60 / bpmA : DEGRADED_SEC_PER_BEAT;
  const windowSec = NEW_PAIR_SEED_BEATS * secPerBeat;
  return {
    startSec: Math.max(0, outgoingDurationSec - windowSec),
    durationSec: windowSec,
    bInSec: 0,
    tempoMatch: true,
    lanes: {},
  };
}

// ── Cameo projection (host/guest 2-slot parity) ─────────────────────────
//
// A Cameo is the survivor-rule sibling of a Transition: the guest becomes
// audible AND silent entirely within the host's play — the HOST stays
// current (ADR 0037 slot 0 = host, slot 1 = guest). Unlike a Transition
// (both roles enter at the window start), the guest enters MID-WINDOW at
// the host's `entryHostSec` and leaves at `exitHostSec`, so slot 1 carries
// a non-zero entry offset and a fade-out envelope (the host never fades).
// The routine clock runs at the host tempo; the window brackets the guest
// engagement with a small lead-in and a fade-out tail.

/** A lead-in before the guest entry so the host is established when the
 * window opens (beats). */
const CAMEO_LEAD_BEATS = 4;

export interface PairCameoInput {
  uuid: string;
  name: string;
  hostTrackId: number;
  guestTrackId: number;
  /** Host / guest BPMs (null = gridless). bpmHost drives the clock. */
  bpmHost: number | null;
  bpmGuest: number | null;
  source: CameoPlanSourceLite;
}

/** The Cameo geometry the projection needs (structural subset of
 * cameoPlan's CameoPlanSource — kept local so this module doesn't depend
 * on the planner). */
export interface CameoPlanSourceLite {
  entryHostSec: number;
  exitHostSec: number;
  guestStartSec: number;
  fadeInSec: number;
  fadeOutSec: number;
  pitchPercent: number;
}

/**
 * Project a Cameo into slot-surface form. Slot 0 = host (plays through,
 * fader open); slot 1 = guest (enters at the host's entry, fades in/out,
 * goes silent by the exit while the host stays current).
 */
export function cameoToProjection(input: PairCameoInput): PairSlotProjection {
  const { source: src, bpmHost, bpmGuest } = input;
  const degraded = bpmHost === null || bpmHost <= 0;
  const clockBpm = degraded ? 60 / DEGRADED_SEC_PER_BEAT : bpmHost;
  const secPerBeat = 60 / clockBpm;

  // The window opens a lead before the guest entry and closes a fade-out
  // tail after the guest exit — the host plays throughout.
  const leadSec = CAMEO_LEAD_BEATS * secPerBeat;
  const windowStartHostSec = Math.max(0, src.entryHostSec - leadSec);
  const windowEndHostSec = src.exitHostSec + src.fadeOutSec;
  const durationSec = Math.max(secPerBeat, windowEndHostSec - windowStartHostSec);
  const durationBeats = durationSec / secPerBeat;

  // Guest entry offset on the routine clock (host beats from window start).
  const guestEntryBeat = (src.entryHostSec - windowStartHostSec) / secPerBeat;
  const guestExitBeat = (src.exitHostSec - windowStartHostSec) / secPerBeat;

  const bpmHostSlot = degraded ? clockBpm : bpmHost!;
  const bpmGuestSlot = bpmGuest && bpmGuest > 0 ? bpmGuest : clockBpm;
  // The guest rides its recorded pitch (v1 crude: usually 0).
  const guestRate = 1 + src.pitchPercent / 100;

  const hostStart = windowStartHostSec;
  const hostEnd = hostStart + durationBeats * secPerBeat;
  // The guest advances from guestStartSec at its rate, but only over its
  // active span [entry, exit]; before entry it's parked at guestStartSec.
  const guestActiveBeats = Math.max(0, guestExitBeat - guestEntryBeat);
  const guestEnd = src.guestStartSec + guestRate * guestActiveBeats * secPerBeat;

  const events: Record<string, unknown>[] = [
    {
      kind: 'tick',
      beat: 0,
      playheads: { '0': hostStart, '1': src.guestStartSec },
    },
    // Guest entry mark (parked until here).
    {
      kind: 'tick',
      beat: guestEntryBeat,
      playheads: { '0': hostStart + guestEntryBeat * secPerBeat, '1': src.guestStartSec },
    },
    // Guest exit mark.
    {
      kind: 'tick',
      beat: guestExitBeat,
      playheads: { '0': hostStart + guestExitBeat * secPerBeat, '1': guestEnd },
    },
    {
      kind: 'tick',
      beat: durationBeats,
      playheads: { '0': hostEnd, '1': guestEnd },
    },
  ];

  // Guest fade-in/out as an authored fader envelope: closed before entry,
  // ramps up over fadeInSec, holds, ramps down to 0 over fadeOutSec.
  const fadeInBeats = src.fadeInSec / secPerBeat;
  const fadeOutBeats = src.fadeOutSec / secPerBeat;
  const guestFader: RoutineLanePoint[] = [
    { beat: Math.max(0, guestEntryBeat - 1e-6), value: 0 },
    { beat: guestEntryBeat, value: 0 },
    { beat: guestEntryBeat + fadeInBeats, value: 1 },
    { beat: Math.max(guestEntryBeat + fadeInBeats, guestExitBeat - fadeOutBeats), value: 1 },
    { beat: guestExitBeat, value: 0 },
  ].sort((a, b) => a.beat - b.beat);

  const edits: RoutineEdits = {
    lanes: { [laneKey(INCOMING_SLOT, 'fader')]: guestFader },
    jumps: [],
    removedRecordedJumps: [],
    pauses: [],
    removedRecordedPauses: [],
    nudges: {},
    trims: {},
    entryOffsets: {},
  };

  const detail: RoutineDetailWire = {
    uuid: input.uuid,
    name: input.name,
    cast: [input.hostTrackId, input.guestTrackId],
    entry_offsets_beats: [0, guestEntryBeat],
    entry_positions: [hostStart, src.guestStartSec],
    duration_beats: durationBeats,
    origin_take_uuid: null,
    created_at: null,
    events,
    edits: null,
  };

  return {
    detail,
    edits,
    trackBpms: [bpmHostSlot, bpmGuestSlot],
    targetBpm: clockBpm,
    secPerBeat,
    degraded,
  };
}
