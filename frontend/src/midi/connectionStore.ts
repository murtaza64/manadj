/**
 * Connected-Controller store (midi-controller 08): which mapped MIDI input
 * ports are currently attached. Module-level like the rest of the MIDI
 * layer; the adapter publishes attach/detach, React reads it through
 * useSyncExternalStore (TopBar badge). Ports that match no Mapping never
 * appear here.
 */

const connected = new Map<string, string>(); // port id → port name
const listeners = new Set<() => void>();

// Referentially stable snapshot for useSyncExternalStore.
let snapshot: readonly string[] = [];

function publish(): void {
  snapshot = [...connected.values()];
  for (const listener of listeners) listener();
}

export function controllerAttached(portId: string, portName: string): void {
  if (connected.get(portId) === portName) return;
  connected.set(portId, portName);
  publish();
}

export function controllerDetached(portId: string): void {
  if (!connected.delete(portId)) return;
  publish();
}

/** Names of currently connected, mapping-matched controllers. */
export function connectedControllers(): readonly string[] {
  return snapshot;
}

export function subscribeControllers(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function _resetConnectionStoreForTests(): void {
  connected.clear();
  snapshot = [];
  listeners.clear();
}
