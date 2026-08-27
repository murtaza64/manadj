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
import {
  editsAreEmpty,
  emptyEdits,
  laneKey,
  type AuthoredJump,
  type RoutineEdits,
} from './routineDraft';

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

  setLane(slot: number, control: string, points: RoutineLanePoint[]): void {
    this.mutate(`lane:${slot}:${control}`, (e) => {
      e.lanes[laneKey(slot, control)] = [...points].sort((a, b) => a.beat - b.beat);
    });
  }

  /** Drop an authored lane — the recorded step lane plays again. */
  clearLane(slot: number, control: string): void {
    this.mutate(`lane-clear:${slot}:${control}`, (e) => {
      delete e.lanes[laneKey(slot, control)];
    });
    this.endGesture();
  }

  addJump(jump: AuthoredJump): void {
    this.mutate(`jump-add:${jump.id}`, (e) => {
      e.jumps.push({ ...jump });
    });
    this.endGesture();
  }

  updateJump(id: string, patch: Partial<Omit<AuthoredJump, 'id' | 'slot'>>): void {
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
  removeRecordedJump(slot: number, beat: number): void {
    this.mutate(`recorded-remove:${slot}:${beat}`, (e) => {
      if (!e.removedRecordedJumps.some((r) => r.slot === slot && Math.abs(r.beat - beat) < 1e-6)) {
        e.removedRecordedJumps.push({ slot, beat });
      }
    });
    this.endGesture();
  }

  restoreRecordedJump(slot: number, beat: number): void {
    this.mutate(`recorded-restore:${slot}:${beat}`, (e) => {
      e.removedRecordedJumps = e.removedRecordedJumps.filter(
        (r) => !(r.slot === slot && Math.abs(r.beat - beat) < 1e-6)
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
