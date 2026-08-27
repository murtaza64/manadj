/**
 * Visualizer remote (realtime-visualization 03) — main-window side. Tracks
 * the viz window's liveness and active preset from its pings (works no
 * matter how the window was opened), and sends preset commands over the
 * same BroadcastChannel. Module-level store like the playback stores;
 * snapshots are cached so useSyncExternalStore consumers get reference
 * equality between changes.
 */

import { PING_TIMEOUT_MS, VISUALIZER_CHANNEL } from './channel';
import type {
  VisualizerMessage,
  VisualizerSetCycle,
  VisualizerSetParam,
  VisualizerSetPreset,
  VisualizerSoloCommand,
} from './channel';
import type { CycleMode, SoloVerdict } from './soloReview';

export interface VisualizerRemoteState {
  /** A viz window pinged within the timeout. */
  open: boolean;
  /** The viz window's active preset (null while closed/unknown). */
  presetId: string | null;
  /** The active preset's param values as last reported (null = unknown). */
  params: Record<string, number> | null;
  /** The viz window's auto-cycle mode as last reported (null = unknown). */
  cycleMode: CycleMode | null;
}

let state: VisualizerRemoteState = { open: false, presetId: null, params: null, cycleMode: null };
let lastPingAt = -Infinity;
let channel: BroadcastChannel | null = null;
let staleTimer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function sameParams(a: Record<string, number> | null, b: Record<string, number> | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => a[k] === b[k]);
}

function update(next: VisualizerRemoteState): void {
  if (
    next.open === state.open &&
    next.presetId === state.presetId &&
    next.cycleMode === state.cycleMode &&
    sameParams(next.params, state.params)
  ) {
    return;
  }
  state = next;
  for (const listener of listeners) listener();
}

function ensureChannel(): BroadcastChannel {
  if (!channel) {
    channel = new BroadcastChannel(VISUALIZER_CHANNEL);
    channel.onmessage = (event: MessageEvent<VisualizerMessage>) => {
      if (event.data?.type !== 'ping') return;
      lastPingAt = performance.now();
      update({
        open: true,
        presetId: event.data.presetId ?? state.presetId,
        params: event.data.params ?? state.params,
        cycleMode: event.data.cycleMode ?? state.cycleMode,
      });
    };
    staleTimer = setInterval(() => {
      if (state.open && performance.now() - lastPingAt > PING_TIMEOUT_MS) {
        update({ open: false, presetId: null, params: null, cycleMode: null });
      }
    }, 500);
    void staleTimer;
  }
  return channel;
}

export function subscribeVisualizerRemote(listener: () => void): () => void {
  ensureChannel();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getVisualizerRemote(): VisualizerRemoteState {
  return state;
}

/** Switch the viz window's preset from the laptop. */
export function sendVisualizerPreset(presetId: string): void {
  const message: VisualizerSetPreset = { type: 'set-preset', presetId };
  ensureChannel().postMessage(message);
}

/** Tweak a param on the viz window's preset from the laptop. */
export function sendVisualizerParam(presetId: string, paramId: string, value: number): void {
  const message: VisualizerSetParam = { type: 'set-param', presetId, paramId, value };
  ensureChannel().postMessage(message);
}

/** Solo-review action (like/dislike/neutral/next) from the laptop — the
 * viz window executes it with its own solo-flow logic. */
export function sendVisualizerSolo(action: SoloVerdict | 'next'): void {
  const message: VisualizerSoloCommand = { type: 'solo-command', action };
  ensureChannel().postMessage(message);
}

/** Set the viz window's auto-cycle mode from the laptop. */
export function sendVisualizerCycle(mode: CycleMode): void {
  const message: VisualizerSetCycle = { type: 'set-cycle', mode };
  ensureChannel().postMessage(message);
}
