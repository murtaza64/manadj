/**
 * Routine draft store (gh#170 pass 2): owns the OPEN Routine's authored
 * edits — the EditorStore idiom (hand-rolled snapshot/subscribe), with
 * the undo story the pair editor never grew: value-snapshot undo/redo
 * stacks over the (small) RoutineEdits value. Mutations COALESCE by
 * gesture key (a lane drag emits ~60 onChange/s — one undo entry per
 * gesture, the pointer-up boundary sealing it); autosave is the owner's
 * business (subscribe + debounce → PUT), never the store's.
 */
import { useSyncExternalStore } from 'react';
import type { RoutineLanePoint } from '../sets/routinePlan';
import { editsAreEmpty, emptyEdits, laneKey, type AuthoredJump, type AuthoredPause, type RoutineEdits, type RemovedRecordedJump, type RemovedRecordedPause } from './routineDraft';

const UNDO_DEPTH = 100;

export interface RoutineDraftSnapshot {
  /** The open Routine (edits belong to it); null = nothing open. */
  routineUuid: string | null;
  edits: RoutineEdits;
  canUndo: boolean;
  canRedo: boolean;
  /** Bumps on every edit — cheap dirty tracking for autosave owners. */
  version: number;
}

const clone = (e: RoutineEdits): RoutineEdits => ({
  lanes: Object.fromEntries(Object.entries(e.lanes).map(([k, v]) => [k, [...v]])),
  jumps: e.jumps.map((j) => ({ ...j })),
  removedRecordedJumps: e.removedRecordedJumps.map((r) => ({ ...r })),
  pauses: e.pauses.map((p) => ({ ...p })),
  removedRecordedPauses: e.removedRecordedPauses.map((r) => ({ ...r })),
  nudges: { ...e.nudges },
  trims: { ...e.trims },
  entryOffsets: { ...e.entryOffsets },
});

export class RoutineDraftStore {
  private routineUuid: string | null = null;
  private edits: RoutineEdits = emptyEdits();
  private undoStack: RoutineEdits[] = [];
  private redoStack: RoutineEdits[] = [];
  private version = 0;
  /** Open gesture: while the same key keeps arriving, mutations coalesce
   * into one undo entry (sealed by endGesture / a different key). */
  private gestureKey: string | null = null;
  private listeners = new Set<() => void>();
  private snapshot: RoutineDraftSnapshot = {
    routineUuid: null,
    edits: this.edits,
    canUndo: false,
    canRedo: false,
    version: 0,
  };

  getSnapshot = (): RoutineDraftSnapshot => this.snapshot;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  /** Load a Routine's persisted edits (open / re-open / re-promotion).
   * Resets history — undo never crosses artifact identity. */
  load(routineUuid: string, edits: RoutineEdits): void {
    this.routineUuid = routineUuid;
    this.edits = clone(edits);
    this.undoStack = [];
    this.redoStack = [];
    this.gestureKey = null;
    this.emit();
  }

  reset(): void {
    this.routineUuid = null;
    this.edits = emptyEdits();
    this.undoStack = [];
    this.redoStack = [];
    this.gestureKey = null;
    this.emit();
  }

  // ── Mutations (all coalesce by gesture key) ──────────────────────────

  setLane(slotId: string, control: string, points: RoutineLanePoint[]): void {
    this.mutate(`lane:${slotId}:${control}`, (e) => {
      e.lanes[laneKey(slotId, control)] = [...points].sort((a, b) => a.beat - b.beat);
    });
  }

  /** Drop an authored lane — the recorded step lane plays again. */
  clearLane(slotId: string, control: string): void {
    this.mutate(`lane-clear:${slotId}:${control}`, (e) => {
      delete e.lanes[laneKey(slotId, control)];
    });
    this.endGesture();
  }

  addJump(jump: AuthoredJump): void {
    this.mutate(`jump-add:${jump.id}`, (e) => {
      e.jumps.push({ ...jump });
    });
    this.endGesture();
  }

  updateJump(id: string, patch: Partial<Omit<AuthoredJump, 'id' | 'slotId'>>): void {
    this.mutate(`jump-update:${id}`, (e) => {
      const j = e.jumps.find((x) => x.id === id);
      if (!j) return;
      Object.assign(j, patch);
      if (j.deltaSec >= 0) delete j.repeat; // repeat is backward-only (loop doctrine)
    });
  }

  removeJump(id: string): void {
    this.mutate(`jump-remove:${id}`, (e) => {
      e.jumps = e.jumps.filter((x) => x.id !== id);
    });
    this.endGesture();
  }

  /** Suppress a RECORDED discontinuity (continuity restored at replay). */
  removeRecordedJump(slotId: string, beat: number): void {
    this.mutate(`recorded-remove:${slotId}:${beat}`, (e) => {
      if (
        !e.removedRecordedJumps.some((r) => r.slotId === slotId && Math.abs(r.beat - beat) < 1e-6)
      ) {
        e.removedRecordedJumps.push({ slotId, beat });
      }
    });
    this.endGesture();
  }

  restoreRecordedJump(slotId: string, beat: number): void {
    this.mutate(`recorded-restore:${slotId}:${beat}`, (e) => {
      e.removedRecordedJumps = e.removedRecordedJumps.filter(
        (r) => !(r.slotId === slotId && Math.abs(r.beat - beat) < 1e-6)
      );
    });
    this.endGesture();
  }

  /** Per-slot alignment nudge (gh#190 item 6): set the slot's rigid
   * track-time slide. 0 clears the entry. One undo step per call. */
  setNudge(slotId: string, deltaSec: number): void {
    this.mutate(`nudge:${slotId}:${deltaSec}`, (e) => {
      if (deltaSec === 0) delete e.nudges[slotId];
      else e.nudges[slotId] = deltaSec;
    });
    this.endGesture();
  }

  /** Per-slot channel trim (gh#190 iteration): 0..1, 0.5 = nominal
   * (clears the entry). Slider drags coalesce per slot; seal with
   * endGesture on release. */
  setTrim(slotId: string, value: number): void {
    const v = Math.max(0, Math.min(1, value));
    this.mutate(`trim:${slotId}`, (e) => {
      if (Math.abs(v - 0.5) < 1e-6) delete e.trims[slotId];
      else e.trims[slotId] = v;
    });
  }

  /** Drag-flavored nudge (gh#190 track drag): the whole drag coalesces
   * into ONE undo entry per gesture key — seal with endGesture on
   * pointer-up. `key` should identify the gesture, not the value. */
  setNudgeLive(gestureKey: string, slotId: string, deltaSec: number): void {
    this.mutate(gestureKey, (e) => {
      if (deltaSec === 0) delete e.nudges[slotId];
      else e.nudges[slotId] = deltaSec;
    });
  }

  /** Drag-flavored ENTRY-OFFSET edit (ADR 0039, #207 slice 2 — the
   * vertical slot drag): write several slots' overrides in ONE mutation
   * (a reorder swap touches two), coalescing per gesture key — seal with
   * endGesture on pointer-up. null clears an entry (back to recorded). */
  setEntryOffsetsLive(gestureKey: string, patch: Record<string, number | null>): void {
    this.mutate(gestureKey, (e) => {
      for (const [slotId, v] of Object.entries(patch)) {
        if (v === null) delete e.entryOffsets[slotId];
        else e.entryOffsets[slotId] = v;
      }
    });
  }

  /** Drag-flavored PHRASE SHIFT (#221: "move the track WITH its
   * automation"): one gesture moves a slot's ENTRY on the routine clock
   * and rebases every authored edit addressed to it — lanes, jumps,
   * pauses, and removed-recorded markers — by the same beats, all from
   * the drag-start base (absolute rewrites per move; mutate() coalesces
   * the gesture into one undo entry). The build already shifts the
   * recorded timeline (trace + recorded lanes) with the entry override,
   * and authored/removed edit beats live in the SHIFTED frame — so the
   * whole treatment travels together. */
  phraseShiftLive(
    gestureKey: string,
    slotId: string,
    base: {
      entryBeat: number;
      /** The recorded entry — landing back on it deletes the override. */
      bakedEntryBeat: number;
      lanes: Record<string, RoutineLanePoint[]>;
      jumps: AuthoredJump[];
      pauses: AuthoredPause[];
      removedRecordedJumps: RemovedRecordedJump[];
      removedRecordedPauses: RemovedRecordedPause[];
    },
    deltaBeats: number
  ): void {
    this.mutate(gestureKey, (e) => {
      const entry = base.entryBeat + deltaBeats;
      if (Math.abs(entry - base.bakedEntryBeat) < 1e-6) delete e.entryOffsets[slotId];
      else e.entryOffsets[slotId] = entry;
      for (const [key, pts] of Object.entries(base.lanes)) {
        e.lanes[key] = pts.map((pt) => ({ beat: pt.beat + deltaBeats, value: pt.value }));
      }
      const jumpBase = new Map(base.jumps.map((j) => [j.id, j]));
      e.jumps = e.jumps.map((j) => {
        const b = j.slotId === slotId ? jumpBase.get(j.id) : undefined;
        return b ? { ...b, beat: b.beat + deltaBeats } : j;
      });
      const pauseBase = new Map(base.pauses.map((pz) => [pz.id, pz]));
      e.pauses = e.pauses.map((pz) => {
        const b = pz.slotId === slotId ? pauseBase.get(pz.id) : undefined;
        return b ? { ...b, beat: b.beat + deltaBeats } : pz;
      });
      e.removedRecordedJumps = [
        ...e.removedRecordedJumps.filter((r) => r.slotId !== slotId),
        ...base.removedRecordedJumps.map((r) => ({ ...r, beat: r.beat + deltaBeats })),
      ];
      e.removedRecordedPauses = [
        ...e.removedRecordedPauses.filter((r) => r.slotId !== slotId),
        ...base.removedRecordedPauses.map((r) => ({ ...r, beat: r.beat + deltaBeats })),
      ];
    });
  }

  /** Revert a slot's entry to the recorded offset (the authored-lane
   * '↺' idiom). One undo step. */
  clearEntryOffset(slotId: string): void {
    this.mutate(`entry-clear:${slotId}`, (e) => {
      delete e.entryOffsets[slotId];
    });
    this.endGesture();
  }

  // ── Pauses (gh#190: play/pause events, the jump idiom) ───────────────

  addPause(pause: AuthoredPause): void {
    this.mutate(`pause-add:${pause.id}`, (e) => {
      e.pauses.push({ ...pause });
    });
    this.endGesture();
  }

  updatePause(id: string, patch: Partial<Omit<AuthoredPause, 'id' | 'slotId'>>): void {
    this.mutate(`pause-update:${id}`, (e) => {
      const p = e.pauses.find((x) => x.id === id);
      if (!p) return;
      Object.assign(p, patch);
      if (p.durBeats <= 0) p.durBeats = 0.5;
    });
  }

  removePause(id: string): void {
    this.mutate(`pause-remove:${id}`, (e) => {
      e.pauses = e.pauses.filter((x) => x.id !== id);
    });
    this.endGesture();
  }

  /** Suppress a RECORDED hold (the deck plays through it at replay). */
  removeRecordedPause(slotId: string, beat: number): void {
    this.mutate(`recorded-pause-remove:${slotId}:${beat}`, (e) => {
      if (
        !e.removedRecordedPauses.some(
          (r) => r.slotId === slotId && Math.abs(r.beat - beat) < 1e-6
        )
      ) {
        e.removedRecordedPauses.push({ slotId, beat });
      }
    });
    this.endGesture();
  }

  /** Convert a RECORDED jump into an authored one (gh#190 iteration:
   * recorded jumps become movable/resizable while the original stays
   * restorable). Removal + authored replacement compose to the exact
   * recorded trajectory by construction; one mutation = one undo step. */
  convertRecordedJump(slotId: string, beat: number, deltaSec: number): AuthoredJump {
    const jump: AuthoredJump = {
      id: `j-conv-${slotId}-${Math.round(beat * 100)}`,
      slotId,
      beat,
      deltaSec,
    };
    this.mutate(`jump-convert:${slotId}:${beat}`, (e) => {
      if (
        !e.removedRecordedJumps.some(
          (r) => r.slotId === slotId && Math.abs(r.beat - beat) < 1e-6
        )
      ) {
        e.removedRecordedJumps.push({ slotId, beat });
      }
      if (!e.jumps.some((j) => j.id === jump.id)) e.jumps.push({ ...jump });
    });
    this.endGesture();
    return jump;
  }

  /** Convert an authored JUMP into an authored PAUSE at the same beat
   * (gh#190 displacement editor: one 3-state event). One undo step. */
  replaceJumpWithPause(id: string, durBeats: number): AuthoredPause | null {
    let out: AuthoredPause | null = null;
    this.mutate(`convert-jump:${id}`, (e) => {
      const j = e.jumps.find((x) => x.id === id);
      if (!j) return;
      e.jumps = e.jumps.filter((x) => x.id !== id);
      out = { id: `p-${id}`, slotId: j.slotId, beat: j.beat, durBeats: Math.max(0.5, durBeats) };
      e.pauses.push({ ...out });
    });
    this.endGesture();
    return out;
  }

  /** Convert an authored PAUSE into an authored JUMP (the other leg). */
  replacePauseWithJump(id: string, deltaSec: number): AuthoredJump | null {
    let out: AuthoredJump | null = null;
    this.mutate(`convert-pause:${id}`, (e) => {
      const p = e.pauses.find((x) => x.id === id);
      if (!p) return;
      e.pauses = e.pauses.filter((x) => x.id !== id);
      out = { id: `j-${id}`, slotId: p.slotId, beat: p.beat, deltaSec };
      e.jumps.push({ ...out });
    });
    this.endGesture();
    return out;
  }

  /** Convert a RECORDED hold into an authored pause (gh#190 design pass:
   * length-editable, movable — "editing a pause length" without a new
   * split primitive). One mutation = one undo step: suppress the
   * recorded hold and author its replacement over the same span. */
  convertRecordedPause(slotId: string, beat: number, durBeats: number): AuthoredPause {
    const pause: AuthoredPause = {
      id: `p-conv-${slotId}-${Math.round(beat * 100)}`,
      slotId,
      beat,
      durBeats: Math.max(0.5, durBeats),
    };
    this.mutate(`pause-convert:${slotId}:${beat}`, (e) => {
      if (
        !e.removedRecordedPauses.some(
          (r) => r.slotId === slotId && Math.abs(r.beat - beat) < 1e-6
        )
      ) {
        e.removedRecordedPauses.push({ slotId, beat });
      }
      if (!e.pauses.some((p) => p.id === pause.id)) e.pauses.push({ ...pause });
    });
    this.endGesture();
    return pause;
  }

  restoreRecordedPause(slotId: string, beat: number): void {
    this.mutate(`recorded-pause-restore:${slotId}:${beat}`, (e) => {
      e.removedRecordedPauses = e.removedRecordedPauses.filter(
        (r) => !(r.slotId === slotId && Math.abs(r.beat - beat) < 1e-6)
      );
    });
    this.endGesture();
  }

  /** Seal the open gesture (pointer up): the next mutation with the same
   * key starts a FRESH undo entry. */
  endGesture(): void {
    this.gestureKey = null;
  }

  // ── History ──────────────────────────────────────────────────────────

  undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(clone(this.edits));
    this.edits = prev;
    this.gestureKey = null;
    this.emit();
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(clone(this.edits));
    this.edits = next;
    this.gestureKey = null;
    this.emit();
  }

  // ── Internals ────────────────────────────────────────────────────────

  private mutate(key: string, fn: (e: RoutineEdits) => void): void {
    if (this.gestureKey !== key) {
      this.undoStack.push(clone(this.edits));
      if (this.undoStack.length > UNDO_DEPTH) this.undoStack.shift();
      this.redoStack = [];
      this.gestureKey = key;
    }
    const next = clone(this.edits);
    fn(next);
    this.edits = next;
    this.emit();
  }

  private emit(): void {
    this.version++;
    this.snapshot = {
      routineUuid: this.routineUuid,
      edits: this.edits,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      version: this.version,
    };
    for (const fn of this.listeners) fn();
  }
}

export function useRoutineDraft(store: RoutineDraftStore): RoutineDraftSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

/** Persisted form: null when nothing is authored (clears the column). */
export function editsForSave(edits: RoutineEdits): RoutineEdits | null {
  return editsAreEmpty(edits) ? null : edits;
}
