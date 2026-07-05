/**
 * Quantize toggle store (looping 01): the app-wide sticky Quantize setting
 * (CONTEXT.md). Module-level like keyLockStore/routingStore — Quantize is
 * performer intent, not a Deck or view property; default is ON (the PRD's
 * 99% case needs no setup).
 *
 * Consumers read it at gesture time (placement snapping, quantized
 * triggers); the TopBar `Q` button is the one writer.
 */
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
  try {
    localStorage.setItem(STORAGE_KEY, String(on));
  } catch {
    // persistence is best-effort; the session keeps its setting
  }
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
