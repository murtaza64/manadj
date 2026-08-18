/**
 * Visualizer remote (realtime-visualization 03) — main-window side. Tracks
 * the viz window's liveness and active preset from its pings (works no
 * matter how the window was opened), and sends preset commands over the
 * same BroadcastChannel. Module-level store like the playback stores;
 * snapshots are cached so useSyncExternalStore consumers get reference
 * equality between changes.
 */

import { PING_TIMEOUT_MS, VISUALIZER_CHANNEL } from './channel';
import type { VisualizerMessage, VisualizerSetPreset } from './channel';

export interface VisualizerRemoteState {
  /** A viz window pinged within the timeout. */
  open: boolean;
  /** The viz window's active preset (null while closed/unknown). */
  presetId: string | null;
}

let state: VisualizerRemoteState = { open: false, presetId: null };
let lastPingAt = -Infinity;
let channel: BroadcastChannel | null = null;
let staleTimer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function update(next: VisualizerRemoteState): void {
  if (next.open === state.open && next.presetId === state.presetId) return;
  state = next;
  for (const listener of listeners) listener();
}

function ensureChannel(): BroadcastChannel {
  if (!channel) {
    channel = new BroadcastChannel(VISUALIZER_CHANNEL);
    channel.onmessage = (event: MessageEvent<VisualizerMessage>) => {
      if (event.data?.type !== 'ping') return;
      lastPingAt = performance.now();
      update({ open: true, presetId: event.data.presetId ?? state.presetId });
    };
    staleTimer = setInterval(() => {
      if (state.open && performance.now() - lastPingAt > PING_TIMEOUT_MS) {
        update({ open: false, presetId: null });
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
