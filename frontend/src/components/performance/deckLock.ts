/**
 * Deck load-lock (Performance view policy, four-deck-performance): a Load
 * onto an audibly-running deck is refused — a deck is replaced only
 * deliberately. Extracted from PerformanceView so the shared browse panel
 * (BrowsePanel) can style the lock without importing the view (gh#165).
 */
import { useSyncExternalStore } from 'react';
import type { DeckEngine } from '../../playback/DeckEngine';

/** True while a Load onto this deck must be refused (audible or about to be). */
export function isDeckLocked(engine: DeckEngine): boolean {
  return engine.isAudioRunning() || engine.getSnapshot().pendingPlay;
}

/** Reactive version of the lock, for styling the row affordances. */
export function useDeckLocked(engine: DeckEngine): boolean {
  return useSyncExternalStore(
    (cb) => engine.subscribe(cb),
    () => isDeckLocked(engine)
  );
}
