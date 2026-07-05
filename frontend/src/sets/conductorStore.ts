/**
 * Conductor store (sets 04): module-level owner of the one running
 * Conductor — Set playback must survive view switches (the Performance
 * view visualizes it on the shared deck waveforms), so the instance can
 * never live in a pane's component state. Same house pattern as
 * followStore/setStore: module snapshot + useSyncExternalStore.
 *
 * One Conductor at a time; starting a Set (or starting the same Set from
 * another row) replaces the previous run. The plan is snapshotted at
 * start — re-pinning during playback takes effect on the next start.
 */
import { useSyncExternalStore } from 'react';
import { Conductor, type ConductorAudio, type ConductorHooks } from './Conductor';
import type { SetPlan } from './planner';

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

function clearInstance(): void {
  conductorUnsub?.();
  conductorUnsub = null;
  conductor = null;
  conductorSetId = null;
  follow = false;
  refreshSnapshot();
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
  // Same Set, same plan, still conducting: just re-seek (row play button)
  // instead of bouncing the claim/overlay through a stop-start.
  if (conductor?.isActive() && conductorSetId === setId && conductor.plan === plan) {
    follow = true; // seeking re-engages follow (sets 05)
    conductor.playFromEntry(fromEntryIndex);
    refreshSnapshot();
    return;
  }
  conductor?.stop();
  clearInstance();
  const instance = new Conductor(plan, audio, {
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
  if (conductor?.isActive() && conductorSetId === setId && conductor.plan === plan) {
    follow = true;
    conductor.seek(mixTime);
    refreshSnapshot();
    return;
  }
  conductor?.stop();
  clearInstance();
  const instance = new Conductor(plan, audio, {
    loadTrack,
    prefetch,
    onStopped: () => {
      if (conductor === instance) clearInstance();
    },
  });
  conductor = instance;
  conductorSetId = setId;
  conductorUnsub = instance.subscribe(refreshSnapshot);
  follow = true;
  instance.seek(mixTime);
  instance.play();
  refreshSnapshot();
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

export function useConductorState(): ConductorState {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => snapshot
  );
}
