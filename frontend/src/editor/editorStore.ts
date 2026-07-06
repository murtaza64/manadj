/**
 * Editor store (mix-editor 27): the Transition editor's session state
 * behind a snapshot/subscribe seam (DeckEngine house style). The shell
 * becomes layout + glue; widgets subscribe narrowly (useEditorSelector),
 * so a 60/s lane drag re-renders only the subscribers of `mix`.
 *
 * PERSISTENCE LIVES HERE, armed INSIDE mutations: only a mutation applied
 * to the loaded session can schedule a save, and `loadPair` flushes the
 * previous pair before seeding — the render-ordering race that once
 * materialized an unseeded (pristine) session into a pair DELETE (the
 * 2026-07-04 incident, issue 26 comments) is unrepresentable here, not
 * guarded against. Pristine Transitions still never persist
 * (pairStore's materialization rules — this store calls them).
 *
 * Deliberately OUTSIDE: MixPlayer (a subscriber — notifications are
 * synchronous, so audio sees a mutation before the caller's next line),
 * the audible-surface claim, track objects and deck adoption/mirroring,
 * and the frame/park choreography (view+player concerns; the store fires
 * onTransitionLoaded and the shell chooses what that means visually).
 */
import { useCallback } from 'react';
import { useSyncExternalStore } from 'react';
import { defaultMix, lanePoints, slideB, slideBToCue } from './mixModel';
import type { EditorMix, JumpEvent, LaneId, LanePoint, Transition } from './mixModel';
import {
  freshTransition,
  isPristine,
  savePairEntry,
  snapshotPairStore,
  toStoredEntry,
} from './pairStore';
import type { PairEntry, SavedTransition } from './pairStore';
import { stampIntoSession } from './templateModel';
import type { ApplyPatch } from './templateModel';

export interface EditorSession {
  items: SavedTransition[];
  active: number;
}

export interface EditorSnapshot {
  mix: EditorMix;
  session: EditorSession;
  pairKey: string | null;
  snap: boolean;
  lockedWindow: boolean;
  /** A vectorized Take under review (transition-takes 03): the session
   * item `itemUuid` is pristine-LIKE — visible and editable, but filtered
   * from every persist until promoteTakeDraft(). Browsing costs nothing;
   * promotion is the explicit act. */
  takeDraft: { takeUuid: string; itemUuid: string } | null;
}

/** Persistence seam (defaults to the transition store / pairStore). */
export interface EditorPersistence {
  load(pairKey: string): PairEntry | undefined;
  save(pairKey: string, entry: PairEntry | null): void;
}

const SAVE_DEBOUNCE_MS = 300;

export class EditorStore {
  private state: EditorSnapshot = {
    mix: defaultMix(),
    session: { items: [freshTransition([])], active: 0 },
    pairKey: null,
    snap: true,
    // Lock defaults ON (mix-editor 32): named tension accepted — the
    // signature double-drop flow now starts with a lock-off press.
    lockedWindow: true,
    takeDraft: null,
  };

  private readonly persist: EditorPersistence;
  private readonly listeners = new Set<() => void>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private savePending = false;
  private onTransitionLoaded: ((t: Transition) => void) | null = null;

  constructor(persist?: Partial<EditorPersistence>) {
    this.persist = {
      load: persist?.load ?? ((key) => snapshotPairStore()[key]),
      save: persist?.save ?? savePairEntry,
    };
  }

  // ── Snapshot / subscription ─────────────────────────────────────────

  getSnapshot(): EditorSnapshot {
    return this.state;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** A Transition became current (pair load / switch / delete). The shell
   * registers view choreography here (re-frame, park the playhead). */
  setTransitionLoadedHandler(fn: ((t: Transition) => void) | null): void {
    this.onTransitionLoaded = fn;
  }

  private emit(next: Partial<EditorSnapshot>): void {
    this.state = { ...this.state, ...next };
    for (const fn of this.listeners) fn();
  }

  /** A mutation of the LOADED session: emit + arm the debounced save.
   * This is the only place saves get armed — no mutation, no save. */
  private touch(next: Partial<EditorSnapshot>): void {
    this.emit(next);
    if (!this.state.pairKey) return;
    this.savePending = true;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), SAVE_DEBOUNCE_MS);
  }

  // ── Persistence ─────────────────────────────────────────────────────

  /** Session items with the live mix folded into the active one. */
  liveItems(): SavedTransition[] {
    const { session, mix } = this.state;
    return session.items.map((it, i) =>
      i === session.active ? { ...it, transition: mix.transition } : it
    );
  }

  /** Write the pending session to the pair store NOW (debounce cancelled).
   * No-op unless a mutation armed it. */
  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (!this.savePending || !this.state.pairKey) return;
    this.savePending = false;
    // An unpromoted take draft never persists (pristine-like rule): other
    // session items save normally around it.
    const draftUuid = this.state.takeDraft?.itemUuid ?? null;
    const live = this.liveItems();
    const items = draftUuid === null ? live : live.filter((it) => it.uuid !== draftUuid);
    const activeItem = live[this.state.session.active];
    const active = Math.max(0, items.indexOf(activeItem));
    this.persist.save(this.state.pairKey, toStoredEntry(items, active));
  }

  /** Unmount: don't lose the last ≤300ms of edits. */
  dispose(): void {
    this.flush();
    this.listeners.clear();
    this.onTransitionLoaded = null;
  }

  // ── Pair lifecycle ──────────────────────────────────────────────────

  /** Seed the session for an assembled pair. Flushes the PREVIOUS pair
   * first (pending edits belong to it); the new pair starts with nothing
   * armed, so merely opening a pair can never write (or delete) it. */
  loadPair(pairKey: string): void {
    if (pairKey === this.state.pairKey) return;
    this.flush();
    const entry = this.persist.load(pairKey);
    const items = entry ? structuredClone(entry.items) : [freshTransition([])];
    const active = entry ? Math.min(entry.active, items.length - 1) : 0;
    this.emit({
      pairKey,
      session: { items, active },
      mix: { ...this.state.mix, transition: structuredClone(items[active].transition) },
      takeDraft: null, // an unpromoted draft evaporates with its pair
    });
    this.onTransitionLoaded?.(items[active].transition);
  }

  // ── Take review (transition-takes 03) ────────────────────────────────

  /** Stamp a vectorized Take into the session as a reviewable draft.
   * EMIT ONLY — no save is armed; the draft stays out of every persist
   * until promoted (see flush). */
  stampTakeDraft(takeUuid: string, transition: Transition): void {
    // Re-opening a Take on the already-loaded pair: the previous draft is
    // REPLACED, never orphaned (an orphan named "Take" is non-pristine and
    // would ride the next armed save — the bug this filter closes).
    // Pristine items evaporate too — on a fresh pair the draft replaces
    // "Transition 1" instead of siblinging it (same evaporation rule as
    // navigating away from an untouched take).
    const items = this.liveItems().filter(
      (it) => it.uuid !== this.state.takeDraft?.itemUuid && !isPristine(it)
    );
    const item: SavedTransition = {
      uuid: crypto.randomUUID(),
      name: 'Take',
      transition: structuredClone(transition),
    };
    this.emit({
      session: { items: [...items, item], active: items.length },
      mix: { ...this.state.mix, transition: structuredClone(transition) },
      takeDraft: { takeUuid, itemUuid: item.uuid },
    });
    this.onTransitionLoaded?.(item.transition);
  }

  /** The explicit promotion act: the draft becomes an ordinary saved
   * Transition (normal persistence path) and the caller gets the pair of
   * identifiers to record on the Take. Null when nothing is under review. */
  promoteTakeDraft(): { takeUuid: string; transitionUuid: string } | null {
    const draft = this.state.takeDraft;
    if (!draft) return null;
    this.touch({ takeDraft: null });
    this.flush();
    return { takeUuid: draft.takeUuid, transitionUuid: draft.itemUuid };
  }

  /** Drop an unpromoted draft on request (the review banner's Discard) —
   * emit-only: the draft never persisted, so there is nothing to undo. */
  discardTakeDraft(): void {
    const draft = this.state.takeDraft;
    if (!draft) return;
    const items = this.liveItems().filter((it) => it.uuid !== draft.itemUuid);
    const nextItems = items.length > 0 ? items : [freshTransition([])];
    const active = Math.min(this.state.session.active, nextItems.length - 1);
    this.emit({
      session: { items: nextItems, active },
      mix: { ...this.state.mix, transition: structuredClone(nextItems[active].transition) },
      takeDraft: null,
    });
    this.onTransitionLoaded?.(nextItems[active].transition);
  }

  /** Land the session on a fresh pristine Transition — the unresolved
   * adjacency's click-through target (sets 09). No-op when the active one
   * is already pristine (it IS the blank sketch); otherwise appends a
   * fresh take, which evaporates untouched like any pristine item.
   * EMIT ONLY — opening an adjacency is not an edit, so no save is armed
   * (the pristine sketch is filtered from persists regardless). */
  startBlankSketch(): void {
    const items = this.liveItems();
    if (isPristine(items[this.state.session.active])) return;
    const fresh = freshTransition(items);
    this.emit({
      session: { items: [...items, fresh], active: items.length },
      mix: { ...this.state.mix, transition: structuredClone(fresh.transition) },
    });
    this.onTransitionLoaded?.(fresh.transition);
  }

  /** Point the session at a saved Transition by uuid — selection only,
   * never a mutation (jumping from the history's promoted mark). */
  selectTransition(uuid: string): void {
    const items = this.liveItems();
    const index = items.findIndex((it) => it.uuid === uuid);
    if (index < 0 || index === this.state.session.active) return;
    this.emit({
      session: { items, active: index },
      mix: { ...this.state.mix, transition: structuredClone(items[index].transition) },
    });
    this.onTransitionLoaded?.(items[index].transition);
  }

  /** Track assignment (mix identity, not persisted session content). */
  setTrackId(deck: 'A' | 'B', trackId: number): void {
    this.emit({
      mix: { ...this.state.mix, [deck === 'A' ? 'trackAId' : 'trackBId']: trackId },
    });
  }

  // ── Mix mutations ───────────────────────────────────────────────────

  /** Generic escape hatch for the drag paths (behavior-frozen move; the
   * drag protocol narrows into named mutations with issue 16). */
  updateMix(fn: (m: EditorMix) => EditorMix): void {
    this.touch({ mix: fn(this.state.mix) });
  }

  setLane(id: LaneId, points: LanePoint[] | null): void {
    this.updateMix((m) => {
      const lanes = { ...m.transition.lanes };
      if (points === null) delete lanes[id];
      else lanes[id] = points;
      return { ...m, transition: { ...m.transition, lanes } };
    });
  }

  /** Remove a lane from the editor: the envelope stays in `lanes` (re-add
   * restores it) but reads as default during playback (model semantics). */
  hideLane(id: LaneId): void {
    this.updateMix((m) => ({
      ...m,
      transition: {
        ...m.transition,
        hiddenLanes: [...new Set([...(m.transition.hiddenLanes ?? []), id])],
      },
    }));
  }

  /** (Re-)add a lane: unhide, and materialize its points so it's drawn-on
   * (existing envelope wins over the default shape). */
  addLane(id: LaneId): void {
    this.updateMix((m) => ({
      ...m,
      transition: {
        ...m.transition,
        hiddenLanes: (m.transition.hiddenLanes ?? []).filter((h) => h !== id),
        lanes: {
          ...m.transition.lanes,
          [id]: lanePoints(m.transition.lanes, id, m.transition.durationSec),
        },
      },
    }));
  }

  // ── Jump events (transition-takes 01) ───────────────────────────────
  // Array order is INSERTION order, never re-sorted: the UI addresses
  // jumps by index across x drags (the math is order-insensitive).

  /** Add a Jump event at normalized window position x (clamped 0..1),
   * with no distance yet — the marker's editor sets deltaSec. */
  addJump(x: number): void {
    const jump = { x: Math.max(0, Math.min(1, x)), deltaSec: 0 };
    this.updateMix((m) => ({
      ...m,
      transition: { ...m.transition, jumps: [...(m.transition.jumps ?? []), jump] },
    }));
  }

  /** Patch one Jump event (marker drags patch `x`, the Δ editor patches
   * `deltaSec`) — addressed by insertion index, stable across x drags. */
  updateJump(index: number, patch: Partial<JumpEvent>): void {
    this.updateMix((m) => ({
      ...m,
      transition: {
        ...m.transition,
        jumps: (m.transition.jumps ?? []).map((j, i) => (i === index ? { ...j, ...patch } : j)),
      },
    }));
  }

  /** Delete one Jump event by insertion index. */
  removeJump(index: number): void {
    this.updateMix((m) => ({
      ...m,
      transition: {
        ...m.transition,
        jumps: (m.transition.jumps ?? []).filter((_, i) => i !== index),
      },
    }));
  }

  /** Deck B slide (issue 11): realign the pair. The caller supplies the
   * playhead (mix time) and B's rate; audio-side re-parking stays with the
   * player-owning shell. Slides are exact — snap never quantizes them. */
  slideDeckB(kind: 'cue' | 'beats', value: number, playheadSec: number, rateB: number): void {
    const tr = this.state.mix.transition;
    const mut =
      kind === 'cue'
        ? slideBToCue(tr, value, playheadSec, this.state.lockedWindow, rateB)
        : slideB(tr, value, this.state.lockedWindow, rateB);
    this.updateMix((m) => ({ ...m, transition: { ...m.transition, ...mut } }));
  }

  /** Alignment nudge (glossary; issue 09; polarity re-decided in 32):
   * realign the pair by a fixed time step in APPARENT MOTION — +δ moves
   * B's drawn block right (window and B ride startSec together; A anchors
   * the mix axis and never moves on screen). Deck-agnostic by
   * construction: both cards' ▶ mean "block right". */
  alignmentNudge(deltaSec: number): void {
    this.updateMix((m) => ({
      ...m,
      transition: { ...m.transition, startSec: Math.max(0, m.transition.startSec + deltaSec) },
    }));
  }

  // ── View toggles (not persisted — never arm a save) ─────────────────

  setSnap(on: boolean): void {
    this.emit({ snap: on });
  }

  setLockedWindow(on: boolean): void {
    this.emit({ lockedWindow: on });
  }

  toggleLockedWindow(): void {
    this.emit({ lockedWindow: !this.state.lockedWindow });
  }

  // ── Session mutations ───────────────────────────────────────────────

  /** Navigate the session (◀/▶). Leaving a pristine Transition discards it
   * silently; ▶ past the last creates a fresh pristine one. */
  navigateTransition(dir: -1 | 1): void {
    const items = this.liveItems();
    const { session } = this.state;
    const cur = items[session.active];
    let target = session.active + dir;
    if (target >= items.length) {
      // Past the end = new take (no-op when the current one IS fresh).
      if (isPristine(cur)) return;
      const fresh = freshTransition(items);
      this.applySession([...items, fresh], items.length);
      return;
    }
    if (target < 0) return;
    let nextItems = items;
    if (isPristine(cur) && items.length > 1) {
      // Evaporate the untouched take on the way out.
      nextItems = items.filter((_, i) => i !== session.active);
      if (session.active < target) target -= 1;
      target = Math.max(0, Math.min(target, nextItems.length - 1));
    }
    this.applySession(nextItems, target);
  }

  renameActive(name: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    this.touch({
      session: {
        ...this.state.session,
        items: this.state.session.items.map((it, i) =>
          i === this.state.session.active ? { ...it, name: trimmed } : it
        ),
      },
    });
  }

  toggleFavorite(): void {
    this.touch({
      session: {
        ...this.state.session,
        items: this.state.session.items.map((it, i) =>
          i === this.state.session.active ? { ...it, favorite: !it.favorite } : it
        ),
      },
    });
  }

  /** Stamp a template's resolved patch into the session (mix-editor 03).
   * Target semantics are stampIntoSession's contract: pristine active →
   * in place, else a new take; the receiver carries the template's name. */
  stampTemplate(templateName: string, patch: ApplyPatch): void {
    const next = stampIntoSession(
      this.liveItems(),
      this.state.session.active,
      templateName,
      patch
    );
    this.applySession(next.items, next.active);
  }

  /** Delete the active Transition (the switcher does the two-step confirm).
   * Last one → re-init blank (the old reset's feel); else land on next. */
  deleteActive(): void {
    const items = this.liveItems().filter((_, i) => i !== this.state.session.active);
    const nextItems = items.length > 0 ? items : [freshTransition([])];
    const active = Math.min(this.state.session.active, nextItems.length - 1);
    this.applySession(nextItems, active);
  }

  /** Session switch: new items/active, mix follows the active Transition,
   * view choreography fires. A take draft whose item is gone (deleted,
   * evaporated) drops its reference — a dangling ref would let Promote
   * record a nonexistent Transition on the Take. */
  private applySession(items: SavedTransition[], active: number): void {
    const draft = this.state.takeDraft;
    this.touch({
      session: { items, active },
      mix: {
        ...this.state.mix,
        transition: structuredClone(items[active].transition),
      },
      takeDraft: draft && items.some((it) => it.uuid === draft.itemUuid) ? draft : null,
    });
    this.onTransitionLoaded?.(items[active].transition);
  }
}

/** Narrow subscription: re-renders only when the selected slice changes
 * (Object.is). Selector must return a stable value for unchanged slices —
 * select primitives or existing object references, don't construct. */
export function useEditorSelector<T>(store: EditorStore, sel: (s: EditorSnapshot) => T): T {
  const subscribe = useCallback((cb: () => void) => store.subscribe(cb), [store]);
  return useSyncExternalStore(subscribe, () => sel(store.getSnapshot()));
}
