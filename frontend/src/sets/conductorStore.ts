/**
 * Conductor store (sets 04): module-level owner of the one running
 * Conductor — Set playback must survive view switches (the Performance
 * view visualizes it on the shared deck waveforms), so the instance can
 * never live in a pane's component state. Same house pattern as
 * followStore/setStore: module snapshot + useSyncExternalStore.
 *
 * One Conductor at a time; starting a Set (or starting the same Set from
 * another row) replaces the previous run. The plan is LIVE (sets 24):
 * any plan-input change re-plans the ongoing run in place — the
 * ConductorPlanFeed pushes each freshly assembled PlanInput through
 * replanSetPlayback, which remaps the position (replan.ts: an automatic
 * Pickup into the new plan) and swaps the plan under the run. The
 * sounding window's geometry is deferred (grafted) until it completes;
 * a poll on the mix clock lands the deferred geometry then.
 */
import { useSyncExternalStore } from 'react';
import { Conductor, type ConductorAudio, type ConductorHooks } from './Conductor';
import {
  evaluatePickup,
  flipPlanDecks,
  pickupStartLanes,
  readPickupSnapshot,
  type PickupDecision,
} from './pickup';
import { planSet, type PlanInput, type SetPlan } from './planner';
import {
  evaluateReplan,
  graftSoundingWindow,
  soundingWindowAt,
  soundingWindowKey,
} from './replan';
import { getSetSettings } from './setSettings';

export interface ConductorState {
  setId: number | null;
  status: 'idle' | 'playing' | 'paused';
  /** Entry index the playhead is inside (row highlight). */
  activeEntryIndex: number | null;
  /** Follow-playback (sets 05): on at playback start, disengaged by
   * manual pan/scroll, re-engaged by seeking or the follow button. */
  follow: boolean;
}

const IDLE: ConductorState = { setId: null, status: 'idle', activeEntryIndex: null, follow: false };

let conductor: Conductor | null = null;
let conductorSetId: number | null = null;
let conductorUnsub: (() => void) | null = null;
let follow = false;
let snapshot: ConductorState = IDLE;
/** The latest plan input the feed delivered (sets 24) — re-planned from
 * on graft expiry. */
let lastPlanInput: PlanInput | null = null;
/** The sounding window whose geometry is currently deferred (grafted),
 * as "out:in" — the expiry poll re-plans when the playhead leaves it. */
let graftPair: string | null = null;
let graftPoll: ReturnType<typeof setInterval> | null = null;

const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of listeners) fn();
}

function refreshSnapshot(): void {
  const next: ConductorState =
    conductor && conductor.isActive()
      ? {
          setId: conductorSetId,
          status: conductor.isPlaying() ? 'playing' : 'paused',
          activeEntryIndex: conductor.getActiveEntryIndex(),
          follow,
        }
      : IDLE;
  if (
    next.setId !== snapshot.setId ||
    next.status !== snapshot.status ||
    next.activeEntryIndex !== snapshot.activeEntryIndex ||
    next.follow !== snapshot.follow
  ) {
    snapshot = next;
    notify();
  }
}

function stopGraftPoll(): void {
  if (graftPoll !== null) {
    clearInterval(graftPoll);
    graftPoll = null;
  }
  graftPair = null;
}

function clearInstance(): void {
  conductorUnsub?.();
  conductorUnsub = null;
  conductor = null;
  conductorSetId = null;
  lastPlanInput = null;
  stopGraftPoll();
  follow = false;
  refreshSnapshot();
}

/** Install a fresh Conductor as the one running instance. */
function installInstance(
  setId: number,
  execPlan: SetPlan,
  audio: ConductorAudio,
  loadTrack: ConductorHooks['loadTrack'],
  prefetch?: ConductorHooks['prefetch']
): Conductor {
  conductor?.stop();
  clearInstance();
  const instance = new Conductor(execPlan, audio, {
    loadTrack,
    prefetch,
    onStopped: () => {
      // Every end (stop, natural end, takeover, displaced) settles idle.
      if (conductor === instance) clearInstance();
    },
  });
  conductor = instance;
  conductorSetId = setId;
  conductorUnsub = instance.subscribe(refreshSnapshot);
  follow = true; // on at playback start (sets 05)
  return instance;
}

/** Start playing a Set from an entry (0 = the top). Replaces any running
 * Conductor. `loadTrack` is the deck provider's Load path, captured by
 * the initiating view; `prefetch` (sets 14) warms the decode cache one
 * entry ahead. */
export function startSetPlayback(
  setId: number,
  plan: SetPlan,
  audio: ConductorAudio,
  loadTrack: ConductorHooks['loadTrack'],
  fromEntryIndex = 0,
  prefetch?: ConductorHooks['prefetch']
): void {
  // Same Set, still conducting: just re-seek (row play button) instead
  // of bouncing the claim/overlay through a stop-start. The running plan
  // is current by construction (live re-plan keeps it fresh — sets 24),
  // so no plan-identity check.
  if (conductor?.isActive() && conductorSetId === setId) {
    follow = true; // seeking re-engages follow (sets 05)
    conductor.playFromEntry(fromEntryIndex);
    refreshSnapshot();
    return;
  }
  const instance = installInstance(setId, plan, audio, loadTrack, prefetch);
  instance.playFromEntry(fromEntryIndex);
  refreshSnapshot();
}

/**
 * Seek within a Set's playback (sets 05: ladder click). Conducting this
 * plan already: seek in place, preserving play/pause. Otherwise: start
 * playing from that instant — auditioning any moment is one click.
 * Seeking re-engages follow.
 */
export function seekSetPlayback(
  setId: number,
  plan: SetPlan,
  audio: ConductorAudio,
  loadTrack: ConductorHooks['loadTrack'],
  mixTime: number,
  prefetch?: ConductorHooks['prefetch']
): void {
  if (conductor?.isActive() && conductorSetId === setId) {
    follow = true;
    conductor.seek(mixTime);
    refreshSnapshot();
    return;
  }
  const instance = installInstance(setId, plan, audio, loadTrack, prefetch);
  instance.seek(mixTime);
  instance.play();
  refreshSnapshot();
}

/**
 * Pickup (sets 16): adopt the live deck/mixer state as a mix instant and
 * resume Set playback from it — the inverse of takeover. Takes ONE
 * coherent snapshot, evaluates the pure predicate against it, and — when
 * lit — executes the decision from that same read: the Conductor runs
 * the deck-mirrored plan when the anchor sits on the other physical deck
 * (flip), the mixer/pitch converge to the plan over `rampSec`, and the
 * anchors are never touched at the instant. Returns the decision so the
 * caller can surface an unlit verdict (a stale-button click).
 */
export function pickupSetPlayback(
  setId: number,
  plan: SetPlan,
  audio: ConductorAudio,
  loadTrack: ConductorHooks['loadTrack'],
  opts: { rampSec: number; toleranceSec?: number },
  prefetch?: ConductorHooks['prefetch']
): PickupDecision {
  const snap = readPickupSnapshot(audio.mixer, audio.engines);
  const decision = evaluatePickup(plan, snap, { toleranceSec: opts.toleranceSec });
  if (!decision.lit) return decision;
  const execPlan = decision.flip ? flipPlanDecks(plan) : plan;
  const instance = installInstance(setId, execPlan, audio, loadTrack, prefetch);
  instance.pickup(decision.mixTime, {
    rampSec: opts.rampSec,
    rampDecks: decision.anchors,
    startLanes: pickupStartLanes(snap),
  });
  refreshSnapshot();
  return decision;
}

/**
 * Live re-plan (sets 24): a plan-input change while this Set is
 * conducting. Recomputes the plan (with the sounding window's geometry
 * deferred — the graft), remaps the position on the audibly dominant
 * deck (an automatic Pickup into the new plan, run internally — never
 * the user-facing predicate: the holder here is the Conductor itself),
 * and swaps the plan under the ongoing run. When the anchor's track has
 * left the Set the Conductor stands down takeover-style: the decks keep
 * sounding and the Pickup button surfaces the unresolvable state.
 *
 * Callers: the ConductorPlanFeed effect (one call per recomputed input;
 * editor drags are already coalesced by the autosave debounce).
 */
export function replanSetPlayback(setId: number, input: PlanInput): void {
  if (!conductor?.isActive() || conductorSetId !== setId) return;
  lastPlanInput = input;
  applyReplan();
}

function applyReplan(): void {
  const instance = conductor;
  const input = lastPlanInput;
  if (!instance?.isActive() || !input) return;
  const t = instance.getMixTime();
  // Defer the sounding window's geometry (lanes ride live): re-plan from
  // an input whose active adjacency keeps the executed geometry. The
  // exec plan carries any earlier graft, so deferral propagates until
  // the window completes.
  const sounding = soundingWindowAt(instance.plan, t);
  const grafted = sounding ? graftSoundingWindow(input, sounding) : null;
  const newPlan = planSet(grafted ?? input);
  const decision = evaluateReplan(instance.plan, t, newPlan);
  if (!decision.ok) {
    // The plan no longer accounts for what is sounding (anchor's track
    // left the Set / set emptied): keep the audio, stop conducting.
    stopGraftPoll();
    instance.standDown();
    return;
  }
  const execPlan = decision.flip ? flipPlanDecks(newPlan) : newPlan;
  instance.replacePlan(execPlan, decision.mixTime, {
    rampSec: getSetSettings().pickupRampSec,
  });
  graftPair = grafted ? soundingWindowKey(sounding) : null;
  if (graftPair !== null) startGraftPoll();
  else stopGraftPoll();
  refreshSnapshot();
}

/** While a graft is pending, watch the mix clock: when the playhead
 * leaves the deferred window (completion, or a seek out of it), re-plan
 * from the last input — the deferred geometry lands, and any later
 * replay of that window plays the NEW geometry. */
function startGraftPoll(): void {
  if (graftPoll !== null) return;
  graftPoll = setInterval(() => {
    const instance = conductor;
    if (!instance?.isActive() || lastPlanInput === null) {
      stopGraftPoll();
      return;
    }
    const pair = soundingWindowKey(soundingWindowAt(instance.plan, instance.getMixTime()));
    if (pair === graftPair) return; // still inside the deferred window
    applyReplan();
  }, 250);
}

/** Follow-playback toggle/disengage (sets 05). */
export function setFollowPlayback(on: boolean): void {
  if (follow === on) return;
  follow = on;
  refreshSnapshot();
}

export function conductorTogglePlay(): void {
  conductor?.togglePlay();
}

export function stopSetPlayback(): void {
  conductor?.stop();
}

/** The running Conductor (transport reads beyond the snapshot). */
export function getConductor(): Conductor | null {
  return conductor;
}

/** Non-hook snapshot read (sets 34: the space dispatch resolves its
 * transport verb outside React). */
export function getConductorState(): ConductorState {
  return snapshot;
}

export function useConductorState(): ConductorState {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => snapshot
  );
}
