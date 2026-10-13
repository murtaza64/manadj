/**
 * Authored mixes (ADR 0039, gh#325): a Routine built from scratch on the
 * Mix editor's blank canvas — no origin Take, no recording. The authored
 * STRUCTURE (cast, slot ids, entry beats, entry positions, duration) IS
 * the substance; each slot's trace is synthesized at build time
 * (routinePlan.synthesizedSlotTrace).
 *
 * The structure rides the draft store inside `RoutineEdits.authored` so
 * structural edits (add/remove slot) share the edits layer's undo history
 * and autosave. It is CLIENT-SIDE ONLY inside the edits value: persistence
 * splits it back out into the Routine's first-class fields (PUT
 * /api/routines/{uuid}/structure) — `editsForSave` strips it.
 *
 * Kind-fluid (ADR 0039): the draft has no kind; 2 slots persist as a
 * Transition, ≥ 3 as a Routine, converting on save at crossings
 * (kindCrossing.ts, gh#330).
 */
import type { RoutineDetailWire, RoutineStructureWire } from '../api/client';
import type { HotCue } from '../types';
import { laneKey, mintSlotId, type RoutineEdits } from './routineDraft';

export interface AuthoredSlot {
  slotId: string;
  trackId: number;
  /** Entry beat on the routine clock (structure, not an override). */
  entryBeat: number;
  /** Track seconds where playback starts at the entry. */
  entryPos: number;
}

export interface AuthoredStructure {
  slots: AuthoredSlot[];
  durationBeats: number;
}

/** A Routine needs ≥ 3 slots at rest (ADR 0035). */
export const MIN_ROUTINE_SLOTS = 3;
/** Below 2 slots nothing persists; 2 save as a Transition (ADR 0039). */
export const MIN_PERSIST_SLOTS = 2;
/** Material kept after the last entry when a slot lands (8 bars). */
export const TAIL_BEATS = 32;
/** Default stagger between slots added in one gesture (multi-track drag). */
export const STAGGER_BEATS = 32;
/** The authored fader step's closed→open ramp, ending on the entry beat. */
export const FADER_STEP_BEATS = 0.0625;
const BAR = 4;

export function emptyStructure(): AuthoredStructure {
  return { slots: [], durationBeats: TAIL_BEATS };
}

/** Entry position doctrine (ADR 0039, Set-playback hard cut): Hot Cue 1,
 * else track start. */
export function defaultEntryPos(hotcues: HotCue[] | undefined): number {
  const cue1 = hotcues?.find((c) => c.slot_number === 1);
  return cue1 ? Math.max(0, cue1.time_seconds) : 0;
}

/** Entries are structural: SNAP rounds to the bar (downbeat). */
export function snapEntryBeat(beat: number, snap: boolean): number {
  return snap ? Math.round(beat / BAR) * BAR : beat;
}

/** Effective entry beat: the edits layer's override (vertical reorder
 * drag) over the structure's own entry. */
export function effectiveEntry(edits: RoutineEdits, slot: AuthoredSlot): number {
  return edits.entryOffsets[slot.slotId] ?? slot.entryBeat;
}

/** Slots in derived entry order (slot index = entry order, ADR 0035). */
export function orderedSlots(edits: RoutineEdits): AuthoredSlot[] {
  const s = edits.authored;
  if (!s) return [];
  return s.slots
    .map((slot, i) => ({ slot, i, beat: effectiveEntry(edits, slot) }))
    .sort((a, b) => a.beat - b.beat || a.i - b.i)
    .map(({ slot }) => slot);
}

export function structureFromDetail(d: RoutineDetailWire): AuthoredStructure {
  return {
    slots: d.cast.map((trackId, i) => ({
      slotId: d.slot_ids?.[i] ?? String(i),
      trackId,
      entryBeat: d.entry_offsets_beats[i],
      entryPos: d.entry_positions[i],
    })),
    durationBeats: d.duration_beats,
  };
}

/** The wire detail the editor builds from — the authored draft rendered
 * through the same path as any saved Routine. */
export function structureToDetail(
  uuid: string,
  name: string | null,
  s: AuthoredStructure
): RoutineDetailWire {
  const slots = [...s.slots].sort((a, b) => a.entryBeat - b.entryBeat);
  return {
    uuid,
    name,
    cast: slots.map((x) => x.trackId),
    slot_ids: slots.map((x) => x.slotId),
    entry_offsets_beats: slots.map((x) => x.entryBeat),
    entry_positions: slots.map((x) => x.entryPos),
    duration_beats: s.durationBeats,
    origin_take_uuid: null,
    authored: true,
    created_at: null,
    events: [],
    edits: null,
  };
}

export function structureForSave(s: AuthoredStructure): RoutineStructureWire {
  const d = structureToDetail('', null, s);
  return {
    cast: d.cast,
    slot_ids: d.slot_ids!,
    entry_offsets_beats: d.entry_offsets_beats,
    entry_positions: d.entry_positions,
    duration_beats: d.duration_beats,
  };
}

/** Shift every beat-stamped field by `delta` (origin re-normalization:
 * the entry slot sits at routine beat 0 — the window is anchored on the
 * first Track's timeline). Mutates `e`. */
function shiftBeats(e: RoutineEdits, delta: number): void {
  if (delta === 0 || !e.authored) return;
  e.authored.slots = e.authored.slots.map((s) => ({ ...s, entryBeat: s.entryBeat + delta }));
  e.authored.durationBeats += delta;
  for (const [k, pts] of Object.entries(e.lanes)) {
    e.lanes[k] = pts.map((p) => ({ ...p, beat: p.beat + delta }));
  }
  e.jumps = e.jumps.map((j) => ({ ...j, beat: j.beat + delta }));
  e.pauses = e.pauses.map((p) => ({ ...p, beat: p.beat + delta }));
  e.removedRecordedJumps = e.removedRecordedJumps.map((r) => ({ ...r, beat: r.beat + delta }));
  e.removedRecordedPauses = e.removedRecordedPauses.map((r) => ({ ...r, beat: r.beat + delta }));
  for (const k of Object.keys(e.entryOffsets)) e.entryOffsets[k] += delta;
  if (e.playbackBounds) {
    e.playbackBounds = {
      startBeat: e.playbackBounds.startBeat + delta,
      endBeat: e.playbackBounds.endBeat + delta,
    };
  }
}

/** Re-anchor beat 0 on the entry slot and keep the duration past the
 * last entry. Mutates `e`. */
export function normalizeAuthored(e: RoutineEdits): void {
  const s = e.authored;
  if (!s || s.slots.length === 0) return;
  const entries = s.slots.map((slot) => effectiveEntry(e, slot));
  shiftBeats(e, -Math.min(...entries));
  const last = Math.max(...s.slots.map((slot) => effectiveEntry(e, slot)));
  s.durationBeats = Math.max(s.durationBeats, last + TAIL_BEATS);
}

export interface SlotDrop {
  trackId: number;
  entryPos: number;
}

/**
 * Append slots (drag-to-add, ADR 0039): the first lands at `beat`
 * (already snapped by the caller), later ones stagger by STAGGER_BEATS;
 * on an empty canvas the first track is the entry slot (beat 0) and the
 * next one lands at `beat`.
 * Each non-entry slot gets an AUTHORED closed→open fader step at its
 * entry — a real, editable lane; no synthetic exit. The very first slot
 * of an empty canvas enters at beat 0, fader open. Mutates `e`.
 */
export function addSlotsTo(e: RoutineEdits, drops: SlotDrop[], beat: number): string[] {
  e.authored ??= emptyStructure();
  const ids: string[] = [];
  let next = beat;
  drops.forEach((d) => {
    const s = e.authored!;
    let entryBeat = 0;
    if (s.slots.length > 0) {
      entryBeat = next;
      next += STAGGER_BEATS;
    }
    const slotId = mintSlotId();
    ids.push(slotId);
    s.slots.push({ slotId, trackId: d.trackId, entryBeat, entryPos: d.entryPos });
  });
  normalizeAuthored(e);
  // Fader steps AFTER normalization (beats final). The entry slot (beat
  // 0) sounds from the start — no step.
  for (const id of ids) {
    const slot = e.authored!.slots.find((s) => s.slotId === id)!;
    if (slot.entryBeat <= 0) continue;
    e.lanes[laneKey(id, 'fader')] = [
      { beat: slot.entryBeat - FADER_STEP_BEATS, value: 0 },
      { beat: slot.entryBeat, value: 1 },
    ];
  }
  return ids;
}

/** Remove a slot and every edit addressed to it; re-anchor if the entry
 * slot went. Mutates `e`. */
export function removeSlotFrom(e: RoutineEdits, slotId: string): void {
  if (!e.authored) return;
  e.authored.slots = e.authored.slots.filter((s) => s.slotId !== slotId);
  for (const k of Object.keys(e.lanes)) {
    if (k.startsWith(`${slotId}:`)) delete e.lanes[k];
  }
  e.jumps = e.jumps.filter((j) => j.slotId !== slotId);
  e.pauses = e.pauses.filter((p) => p.slotId !== slotId);
  e.removedRecordedJumps = e.removedRecordedJumps.filter((r) => r.slotId !== slotId);
  e.removedRecordedPauses = e.removedRecordedPauses.filter((r) => r.slotId !== slotId);
  delete e.nudges[slotId];
  delete e.trims[slotId];
  delete e.entryOffsets[slotId];
  if (e.startTrims) delete e.startTrims[slotId];
  normalizeAuthored(e);
}

/** Stable key of the structure (memo dependency for the derived detail). */
export function structureKey(s: AuthoredStructure | undefined): string {
  return s ? JSON.stringify(s) : '';
}
