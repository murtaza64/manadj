import { createContext, useContext, useSyncExternalStore } from 'react';
import type { DeckEngine, DeckSnapshot } from '../playback/DeckEngine';
import type { Track } from '../types';

/**
 * Access to the one shared Deck (ADR 0008). The provider lives in
 * contexts/DeckContext.tsx, above the view switch — the Deck outlives views.
 * (Context object + hooks live here, apart from the provider, for fast refresh.)
 *
 * The context value deliberately excludes the snapshot: it holds only stable
 * references, so transport events don't re-render the whole subtree (the
 * library's track table is huge). Components read deck state through
 * useDeckSnapshot with a selector and re-render only when their slice changes.
 */
export interface DeckContextValue {
  engine: DeckEngine;
  /** The Track on the Deck (kept alongside the engine's trackId for display). */
  loadedTrack: Track | null;
  /** Load a Track onto the Deck: fetch + decode, replacing the current one. */
  loadTrack: (track: Track) => void;
}

export const DeckContext = createContext<DeckContextValue | undefined>(undefined);

export function useDeck(): DeckContextValue {
  const ctx = useContext(DeckContext);
  if (!ctx) throw new Error('useDeck must be used within DeckProvider');
  return ctx;
}

/**
 * Subscribe to a slice of the deck snapshot. Re-renders only when the
 * selected value changes (Object.is), so cheap selectors like
 * `s => s.loadState === 'ready'` insulate large components from unrelated
 * transport events. Selecting the whole snapshot (`s => s`) re-renders on
 * every emit — fine for small components.
 */
export function useDeckSnapshot<T>(selector: (s: DeckSnapshot) => T): T {
  const { engine } = useDeck();
  return useSyncExternalStore(
    (cb) => engine.subscribe(cb),
    () => selector(engine.getSnapshot())
  );
}

/**
 * True when the Deck can play the loaded Track: audio is decoded AND belongs
 * to that Track. The trackId check closes the load window — between a Load
 * being requested and the engine finishing, the engine still holds the
 * previous track's audio, and controls must not act on it in the new
 * track's name.
 */
export function useDeckReady(): boolean {
  const { loadedTrack } = useDeck();
  const id = loadedTrack?.id ?? null;
  return useDeckSnapshot(
    (s) => id !== null && s.loadState === 'ready' && s.trackId === id
  );
}
