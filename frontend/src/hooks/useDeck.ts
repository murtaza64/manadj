import { createContext, useContext, useSyncExternalStore } from 'react';
import type { DeckEngine, DeckSnapshot } from '../playback/DeckEngine';
import type { ChannelId } from '../playback/mixer';
import type { Track } from '../types';

/**
 * Deck addressing (performance-mode issue 02): both Decks live app-wide in
 * DeckProvider (contexts/DeckContext.tsx); a component reads *its* deck from
 * the nearest <DeckScope deck="A|B">. Hook signatures are deck-blind — the
 * whole single-deck component kit (Player, HotCue, keyboard hub, TagEditor)
 * works unchanged under any scope. (Context objects + hooks live here, apart
 * from the providers, for fast refresh.)
 *
 * The scope value deliberately excludes the snapshot: it holds only stable
 * references, so transport events don't re-render the whole subtree (the
 * library's track table is huge). Components read deck state through
 * useDeckSnapshot with a selector and re-render only when their slice changes.
 */
export interface DeckContextValue {
  /** Which mixer channel this scope addresses. */
  deck: ChannelId;
  engine: DeckEngine;
  /** The Track on the Deck (kept alongside the engine's trackId for display). */
  loadedTrack: Track | null;
  /** Load a Track onto the Deck: fetch + decode, replacing the current one. */
  loadTrack: (track: Track) => void;
  /**
   * Beatjump size (beats) for this Deck in the Performance view — halve/
   * double between 1 and 128 (playback/beatjump.ts). The library view keeps
   * its fixed constant and ignores this.
   */
  beatjumpBeats: number;
  /** Set the beatjump size (clamped into bounds by the provider). */
  setBeatjumpBeats: (beats: number) => void;
}

export const DeckContext = createContext<DeckContextValue | undefined>(undefined);

/** Both decks, provided app-wide by DeckProvider; DeckScope picks one. */
export const DeckRegistryContext = createContext<
  Record<ChannelId, DeckContextValue> | undefined
>(undefined);

export function useDeck(): DeckContextValue {
  const ctx = useContext(DeckContext);
  if (!ctx) throw new Error('useDeck must be used within a DeckScope');
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
