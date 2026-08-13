/**
 * Replay store (sessions 05): one active Session replay at a time, with a
 * tiny observable status for the timeline UI (the conductorStore idiom,
 * scaled down). Starting a new replay stops the previous one.
 */
import { SessionReplayDriver } from './SessionReplayDriver';
import type { ReplayAudio, ReplayStopReason } from './SessionReplayDriver';
import type { ReplayPlan } from './replayPlanner';

export interface ReplayState {
  status: 'idle' | 'loading' | 'playing' | 'paused';
  /** Session uuid + capture-clock start of the active replay. */
  sessionUuid: string | null;
  startT: number | null;
  lastStop: ReplayStopReason | null;
}

let state: ReplayState = { status: 'idle', sessionUuid: null, startT: null, lastStop: null };
let instance: SessionReplayDriver | null = null;
const listeners = new Set<() => void>();

function setState(next: Partial<ReplayState>): void {
  state = { ...state, ...next };
  for (const fn of listeners) fn();
}

export function replayState(): ReplayState {
  return state;
}

export function subscribeReplay(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Start replaying a plan; any previous replay stops first. */
export async function startReplay(
  sessionUuid: string,
  plan: ReplayPlan,
  audio: ReplayAudio,
  loadTrack: (deck: 'A' | 'B' | 'C' | 'D', trackId: number) => Promise<boolean>,
  onStopped?: (reason: ReplayStopReason, cause?: string) => void
): Promise<void> {
  instance?.stop();
  setState({ status: 'loading', sessionUuid, startT: plan.startT, lastStop: null });
  const driver = new SessionReplayDriver(plan, audio, {
    loadTrack,
    onStopped: (reason, cause) => {
      if (instance === driver) {
        instance = null;
        setState({ status: 'idle', sessionUuid: null, startT: null, lastStop: reason });
      }
      onStopped?.(reason, cause);
    },
  });
  instance = driver;
  await driver.start();
  // Still the active instance and not already stopped → rolling.
  if (instance === driver) setState({ status: 'playing' });
}

/** Stop the active replay (UI stop button). No-op when idle. */
export function stopReplay(): void {
  instance?.stop();
}

/** The session-clock moment the active replay is at (moving playhead). */
export function replayNowT(): number | null {
  return instance?.nowT() ?? null;
}

/** Space: toggle pause/resume on the active replay. */
export function toggleReplayPause(): void {
  if (!instance || (state.status !== 'playing' && state.status !== 'paused')) return;
  if (instance.isPaused()) {
    instance.resumeReplay();
    setState({ status: 'playing' });
  } else {
    instance.pauseReplay();
    setState({ status: 'paused' });
  }
}

/** Click-to-seek during playback: jump the active replay to a new plan. */
export function seekReplay(plan: ReplayPlan): void {
  const driver = instance;
  if (!driver) return;
  setState({ startT: plan.startT });
  void driver.seekTo(plan);
}
