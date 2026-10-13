/**
 * Shared browse-panel host contract (gh#165): the imperative handle of the
 * ONE Library instance (BrowsePanel.tsx) plus the per-mode load-policy
 * registry the panel reads. Split from BrowsePanel so mode views import no
 * component (and fast refresh keeps working).
 */
import { createRef } from 'react';
import type { LibraryBrowseHandle } from './Library';
import type { AppMode } from './TopBar';
import type { ChannelId } from '../playback/mixer';
import type { Track } from '../types';

/** The modes that show the shared browse panel. */
export type BrowseMode = 'library' | 'performance' | 'transition' | 'routine';

export function isBrowseMode(mode: AppMode): mode is BrowseMode {
  return (
    mode === 'library' || mode === 'performance' || mode === 'transition' || mode === 'routine'
  );
}

/**
 * Imperative surface of the one Library instance (selection navigation +
 * selected track). The Performance view and the Transition editor own
 * their keyboards outright and drive the table through this. Because the
 * handle is SHARED, every document-level key listener that drives it must
 * gate on useViewActive() — two live listeners would double-step it.
 */
export const sharedBrowseHandle = createRef<LibraryBrowseHandle>();

/** A custom row action replacing the ABCD deck buttons (#221: the Mix
 * editor's picker-chip fill — rows navigate the picker, not the decks). */
export interface BrowseRowAction {
  icon: string;
  title: string;
  run(track: Track): void;
}

/** A mode's load routing for the browse surface's row buttons/double-click. */
export interface BrowseHostConfig {
  /** Row hover buttons + double-click route here (the mode's load policy —
   * e.g. the Performance load lock, or the editor's A/B assignment). */
  onLoadToDeck: (deck: ChannelId, track: Track) => void;
  /** Which Deck a double-click targets (defaults to A). */
  doubleClickDeck?: ChannelId;
  /** When set, rows render THESE instead of the ABCD load buttons. */
  rowActions?: BrowseRowAction[];
  /** When set, double-click routes here instead of a deck load. */
  onDoubleClick?: (track: Track) => void;
}

// ── Host registry ─────────────────────────────────────────────────────────
// Keep-alive mode views stay mounted (and re-register as their callbacks
// change) while hidden; the panel reads only the active mode's entry, so
// stale-but-mounted views never clobber the visible one.
const hosts = new Map<BrowseMode, BrowseHostConfig>();
const listeners = new Set<() => void>();

export function subscribeBrowseHosts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function browseHostFor(mode: BrowseMode): BrowseHostConfig | undefined {
  return hosts.get(mode);
}

function emit() {
  listeners.forEach((listener) => listener());
}

/** Register (or refresh) a mode's load policy. Returns the unregister. */
export function registerBrowseHost(mode: BrowseMode, config: BrowseHostConfig): () => void {
  hosts.set(mode, config);
  emit();
  return () => {
    if (hosts.get(mode) === config) {
      hosts.delete(mode);
      emit();
    }
  };
}
