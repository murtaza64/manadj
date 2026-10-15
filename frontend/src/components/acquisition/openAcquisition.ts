// REQUEST: open Sync → Acquisition on a Source Item (gh#342 task worklist).
// App switches to sync; SyncView opens the Acquisition tab; the view sets
// its filter to the item's title and scope to "all" so the row is on screen.
export const OPEN_ACQUISITION_EVENT = 'manadj:open-acquisition';

let pending: { itemId: number; search: string } | null = null;

export function requestAcquisitionItem(itemId: number, search: string): void {
  pending = { itemId, search };
  window.dispatchEvent(new CustomEvent(OPEN_ACQUISITION_EVENT));
}

export function takePendingAcquisition(): { itemId: number; search: string } | null {
  const p = pending;
  pending = null;
  return p;
}

export function peekPendingAcquisition(): boolean {
  return pending != null;
}
