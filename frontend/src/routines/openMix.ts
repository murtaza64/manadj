/**
 * Mix-editor open requests (#221, ADR 0037 phase 3): the one entry event
 * for opening ANY artifact kind on the unified surface, with optional Set
 * context (pin-follow). Supersedes openPair.ts's pair-editor request for
 * rewired entry points; openRoutine.ts stays for legacy routine-only
 * producers until they migrate here.
 *
 * The openPair.ts pattern: module-level pending + a window event; App
 * flips the view; the mounted editor consumes one-shot.
 */

export const OPEN_MIX_EVENT = 'manadj:open-mix';

export interface MixEditRequest {
  open:
    | { kind: 'routine'; uuid: string }
    | {
        kind: 'transition';
        aTrackId: number;
        bTrackId: number;
        /** Saved Transition to open; null = no artifact (with takeUuid: a
         * take review; without: a fresh seeded pair draft). */
        uuid: string | null;
        takeUuid?: string | null;
      };
  /** Arms pin-follow (sticky to the MOVE, not the surface — ADR 0037):
   * cycling within the opened artifact's move re-points this Set pin;
   * navigating to a different pair/cast disarms. */
  setContext?: { setId: number; headTrackId: number } | null;
}

let pending: MixEditRequest | null = null;

export function requestMixEdit(req: MixEditRequest): void {
  pending = req;
  window.dispatchEvent(new Event(OPEN_MIX_EVENT));
}

/** One-shot consume (the mounted Mix editor). */
export function consumeMixEdit(): MixEditRequest | null {
  const req = pending;
  pending = null;
  return req;
}

/**
 * Dev fallback (#221): route the rewired entry points back to the pair
 * editor. Dies with the pair editor in phase 5.
 *
 *   localStorage.setItem('manadj-pair-editor-fallback', '1')
 */
export function pairEditorFallback(): boolean {
  try {
    return localStorage.getItem('manadj-pair-editor-fallback') === '1';
  } catch {
    return false;
  }
}
