import type { MidiMessage } from './feedback';
import type { Mapping } from './mapping';

/**
 * Connected-output store (midi-pad-leds 01): the per-device send capability
 * the adapter publishes for each mapped MIDI output port. Module-level like
 * connectionStore (its mirror on the output side); the feedback bridge
 * reads it through useSyncExternalStore and resyncs every deck's lights
 * whenever the set changes (connect, replug). Ports that match no Mapping
 * never appear here.
 */

export interface ControllerOutput {
  /** The matched Mapping (its feedback section holds the LED addresses). */
  readonly mapping: Mapping;
  readonly send: (message: MidiMessage) => void;
}

const outputs = new Map<string, ControllerOutput>(); // port id → capability
const listeners = new Set<() => void>();

// Referentially stable snapshot for useSyncExternalStore.
let snapshot: readonly ControllerOutput[] = [];

function publish(): void {
  snapshot = [...outputs.values()];
  for (const listener of listeners) listener();
}

export function controllerOutputAttached(portId: string, output: ControllerOutput): void {
  outputs.set(portId, output);
  publish();
}

export function controllerOutputDetached(portId: string): void {
  if (!outputs.delete(portId)) return;
  publish();
}

/** Send capabilities of currently connected, mapping-matched outputs. */
export function connectedOutputs(): readonly ControllerOutput[] {
  return snapshot;
}

export function subscribeOutputs(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function _resetOutputStoreForTests(): void {
  outputs.clear();
  snapshot = [];
  listeners.clear();
}
