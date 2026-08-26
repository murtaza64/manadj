/**
 * Quantize toggle store (looping 01): the app-wide sticky Quantize setting
 * (CONTEXT.md). Module-level like keyLockStore/routingStore — Quantize is
 * performer intent, not a Deck or view property; default is ON (the PRD's
 * 99% case needs no setup).
 *
 * Consumers read it at gesture time (placement snapping, quantized
 * triggers); the TopBar `Q` button is the one writer.
 */
import { writeSetting } from '../settings/persistedSettings';

const STORAGE_KEY = 'manadj-quantize';

function load(): boolean {
  try {
    // Default ON: only an explicit 'false' turns Quantize off.
    return localStorage.getItem(STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

function save(on: boolean): void {
  // Write-through (settings #176): DB + localStorage cache, best-effort.
  writeSetting(STORAGE_KEY, String(on));
}

let quantizeOn = load();
const listeners = new Set<() => void>();

export function subscribeQuantize(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isQuantizeOn(): boolean {
  return quantizeOn;
}

export function setQuantize(on: boolean): void {
  if (on === quantizeOn) return;
  quantizeOn = on;
  save(on);
  for (const listener of listeners) listener();
}
