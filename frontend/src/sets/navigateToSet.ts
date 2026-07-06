/**
 * Cross-view "go to this Set" request (sets 40) — the openPair pattern:
 * a module-level event so App-chrome (the TopBar ownership chip) can
 * navigate the browse view without owning it.
 *
 * The set store carries the durable selection (a freshly-mounted Library
 * restores it); the event covers the already-mounted Library, whose
 * view/selection are component state seeded from the store on mount.
 */
import { selectSet } from './setStore';

export const NAVIGATE_SET_EVENT = 'manadj:navigate-set';

/** Select the Set in the store and nudge any mounted Library to show it.
 * The caller switches the app mode to 'library' itself. */
export function requestSetNavigate(setId: number): void {
  selectSet(setId);
  window.dispatchEvent(new CustomEvent(NAVIGATE_SET_EVENT));
}
