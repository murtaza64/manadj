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
import type { EditorMix, LaneId, LanePoint, Transition } from './mixModel';
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
    lockedWindow: false,
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
    this.persist.save(
      this.state.pairKey,
      toStoredEntry(this.liveItems(), this.state.session.active)
    );
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
    });
    this.onTransitionLoaded?.(items[active].transition);
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

  /** Alignment nudge (glossary; issue 09): realign the pair by a fixed
   * time step. B moves with the frame; A anchors the mix axis, so nudging
   * A shifts frame+B the opposite way. */
  alignmentNudge(deck: 'A' | 'B', deltaSec: number): void {
    const shift = deck === 'B' ? deltaSec : -deltaSec;
    this.updateMix((m) => ({
      ...m,
      transition: { ...m.transition, startSec: Math.max(0, m.transition.startSec + shift) },
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
   * view choreography fires. */
  private applySession(items: SavedTransition[], active: number): void {
    this.touch({
      session: { items, active },
      mix: {
        ...this.state.mix,
        transition: structuredClone(items[active].transition),
      },
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
