/**
 * Browse-session store (four-deck-performance 27): the Library's
 * session state, hoisted out of component state.
 *
 * Born when every top-panel mode mounted its own Library instance and
 * component state died on every Performance ⟷ Library flip. Since gh#165
 * ONE shared Library mounts once at App level (BrowsePanel) and never
 * remounts on mode switches, so this is now belt-and-braces: it seeds the
 * single mount and would carry the session across any future remount.
 * Same rationale as setStore's Set-view state; Set selection itself stays
 * setStore's.
 *
 * Non-reactive on purpose: read imperatively at mount, written by
 * effects. Nothing subscribes — only the next mount cares.
 */

import { EMPTY_SELECTION, type Selection } from '../selection/selectionModel';
import type { BrowseArea } from './browseNav';
import type { ViewType } from './PlaylistSidebar';

export interface BrowseSession {
  view: ViewType;
  playlistId: number | null;
  splitViewOpen: boolean;
  focusedArea: BrowseArea;
  sidebarCursor: string | null;
  /** Main-table row selection; pruned against the visible list on mount. */
  mainSelection: Selection;
  /** Main-table scroll offset, saved on unmount. */
  scrollTop: number;
}

const INITIAL: BrowseSession = {
  view: 'all',
  playlistId: null,
  splitViewOpen: false,
  focusedArea: 'main',
  sidebarCursor: null,
  mainSelection: EMPTY_SELECTION,
  scrollTop: 0,
};

let session: BrowseSession = INITIAL;

export function browseSession(): Readonly<BrowseSession> {
  return session;
}

export function updateBrowseSession(patch: Partial<BrowseSession>): void {
  session = { ...session, ...patch };
}

/**
 * The view a fresh mount restores. A selected Set wins (setStore is the
 * authority on Sets); otherwise the stored view — except a stored 'set'
 * with no selected Set, which falls back to All tracks, and a stored
 * 'playlist' whose playlist id is gone, which cannot be addressed.
 */
export function restoredView(setSelected: boolean, sessionSelected = false): ViewType {
  if (setSelected) return 'set';
  if (sessionSelected) return 'session';
  if (session.view === 'set') return 'all';
  if (session.view === 'playlist' && session.playlistId === null) return 'all';
  return session.view;
}

export function _resetBrowseSessionForTests(): void {
  session = INITIAL;
}
