/**
 * Space-driven mix-level transport (sets 34).
 *
 * Spacebar drives the mix-level transport of the current context: with a
 * Set selected in the mounted browse view, space belongs to the CONDUCTOR
 * — the set wins over the focused deck (per-deck keys keep their deck
 * toggles; the editor's audition toggle outranks everything by handling
 * space in its own capture listener). The verb resolves statefully, in
 * priority order: conducting → pause; paused mid-set → resume; stopped
 * with Pickup lit → pick up; else play from start. Pickup outranks
 * restart deliberately: mid-flow recovery is common, and accidentally
 * restarting a two-hour set is the worse failure. Play-from-selected-row
 * stays on the row ▶ buttons — space never targets a row.
 *
 * The keyboard hubs (library hub, Performance view) call dispatchSetSpace
 * and keep their legacy behavior when it declines (no Set selected). The
 * idle verbs need the selected Set's plan and the deck/mixer wiring —
 * React-side state this module cannot assemble — so the headless
 * SetSpaceTransport feed (App-level, ConductorPlanFeed's pattern)
 * registers an executing adapter while a Set is selected.
 */
import { conductorTogglePlay, getConductorState } from './conductorStore';
import { getSelectedSetId } from './setStore';

export type SetSpaceVerb = 'pause' | 'resume' | 'pickup' | 'play-from-start';

/** The stateful priority ladder (pure). `pickupLit` only matters when
 * stopped — conducting/paused always resolve to the toggle verbs. */
export function resolveSetSpaceVerb(
  status: 'idle' | 'playing' | 'paused',
  pickupLit: boolean
): SetSpaceVerb {
  if (status === 'playing') return 'pause';
  if (status === 'paused') return 'resume';
  return pickupLit ? 'pickup' : 'play-from-start';
}

/** Executes the idle verbs against the selected Set's assembled plan. */
export interface SetSpaceAdapter {
  /** The Pickup predicate against a fresh live snapshot (pure read —
   * no poll; evaluated at the keypress). */
  isPickupLit(): boolean;
  pickup(): void;
  playFromStart(): void;
}

let adapter: SetSpaceAdapter | null = null;

/** Mount-scoped registration (the SetSpaceTransport feed). Returns the
 * unregister; a newer registration is never clobbered by an older
 * unmount's cleanup. */
export function registerSetSpaceAdapter(a: SetSpaceAdapter): () => void {
  adapter = a;
  return () => {
    if (adapter === a) adapter = null;
  };
}

/**
 * Space pressed in a browse-surface context. True = the Set context
 * claimed the key — a Set is selected, even while its plan is still
 * assembling (space must not surprise-toggle a deck in that window).
 * False = no Set selected; the caller keeps its legacy behavior.
 */
export function dispatchSetSpace(): boolean {
  if (getSelectedSetId() === null) return false;
  const status = getConductorState().status;
  const verb = resolveSetSpaceVerb(
    status,
    status === 'idle' && (adapter?.isPickupLit() ?? false)
  );
  switch (verb) {
    case 'pause':
    case 'resume':
      conductorTogglePlay();
      break;
    case 'pickup':
      adapter?.pickup();
      break;
    case 'play-from-start':
      adapter?.playFromStart();
      break;
  }
  return true;
}

/** Tests only. */
export function _resetSetSpaceAdapterForTests(): void {
  adapter = null;
}
