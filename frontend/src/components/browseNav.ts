/**
 * Pure navigation model for the Library's browse areas and sidebar
 * (four-deck-performance 24). Two concerns:
 *
 * - The AREA RING: the ordered focus targets a directional move walks —
 *   sidebar, then the track pane(s). Moves clamp at the ends (no wrap: a
 *   knob tilt past the edge should park, not teleport).
 * - The SIDEBAR CURSOR: a highlight that walks the sidebar's rows without
 *   changing the selected view (rekordbox tree semantics: turning moves
 *   the cursor, pressing opens). Entries mirror the sidebar's visual
 *   order: special views, playlists, sets.
 *
 * Everything here is data-in/data-out; Library.tsx owns the React state.
 */

import type { ViewType } from './PlaylistSidebar';

export type BrowseArea = 'sidebar' | 'main' | 'playlist' | 'library';

/** The ring, in visual order. Split view stacks two track panes. */
export function browseAreas(splitView: boolean): BrowseArea[] {
  return splitView ? ['sidebar', 'playlist', 'library'] : ['sidebar', 'main'];
}

/** One directional step through the ring, clamped at the ends. */
export function moveBrowseArea(
  areas: BrowseArea[],
  current: BrowseArea,
  delta: 1 | -1
): BrowseArea {
  const index = areas.indexOf(current);
  // A stale focus (e.g. the split closed under a pane focus) re-enters at
  // the nearest end in the direction of travel.
  if (index === -1) return delta === 1 ? areas[0] : areas[areas.length - 1];
  return areas[Math.min(areas.length - 1, Math.max(0, index + delta))];
}

export type SidebarViewEntry = {
  kind: 'view';
  view: Extract<ViewType, 'all' | 'unprocessed' | 'needs-attention' | 'archived' | 'session'>;
};
export type SidebarEntry =
  | SidebarViewEntry
  | { kind: 'playlist'; id: number }
  | { kind: 'set'; id: number };

const SPECIAL_VIEWS: SidebarViewEntry['view'][] = [
  'all',
  'unprocessed',
  'needs-attention',
  'archived',
  /* One Sessions ENTRY (sessions 04): the list opens in the main area. */
  'session',
];

/** All walkable sidebar rows, in the sidebar's visual order. */
export function sidebarEntries(playlistIds: number[], setIds: number[]): SidebarEntry[] {
  return [
    ...SPECIAL_VIEWS.map((view): SidebarEntry => ({ kind: 'view', view })),
    ...playlistIds.map((id): SidebarEntry => ({ kind: 'playlist', id })),
    ...setIds.map((id): SidebarEntry => ({ kind: 'set', id })),
  ];
}

/** Stable identity for an entry (cursor state and row highlighting). */
export function entryKey(entry: SidebarEntry): string {
  return entry.kind === 'view' ? `view:${entry.view}` : `${entry.kind}:${entry.id}`;
}

/** The entry key of the Library's CURRENT selection — the cursor's seed
 * when the sidebar gains focus, so walking starts from where you are. */
export function selectionEntryKey(
  view: ViewType,
  playlistId: number | null,
  setId: number | null
): string | null {
  if (view === 'playlist') return playlistId !== null ? `playlist:${playlistId}` : null;
  if (view === 'set') return setId !== null ? `set:${setId}` : null;
  return `view:${view}`;
}

/**
 * Move the cursor by delta rows, clamped. A missing/null cursor enters at
 * the end the motion comes from (down enters at the top, up at the bottom).
 */
export function moveCursor(
  entries: SidebarEntry[],
  currentKey: string | null,
  delta: number
): SidebarEntry | null {
  if (entries.length === 0) return null;
  const index = currentKey === null ? -1 : entries.findIndex((e) => entryKey(e) === currentKey);
  if (index === -1) return delta > 0 ? entries[0] : entries[entries.length - 1];
  return entries[Math.min(entries.length - 1, Math.max(0, index + delta))];
}

/** Cursor jump to the first/last row. */
export function cursorEnd(entries: SidebarEntry[], direction: 1 | -1): SidebarEntry | null {
  if (entries.length === 0) return null;
  return direction === 1 ? entries[entries.length - 1] : entries[0];
}

/** Rows one coarse "page" spans in paged navigation (tilt ▲▼, PgUp/PgDn). */
export const BROWSE_PAGE_ROWS = 15;

/**
 * Paged/end targets over a displayed id list (track panes). Returns the id
 * to select, or null when the list is empty. A missing anchor enters at
 * the end the motion comes from, mirroring moveCursor.
 */
export function pageTargetId(
  ids: number[],
  anchorId: number | null,
  direction: 1 | -1,
  pageRows: number = BROWSE_PAGE_ROWS
): number | null {
  if (ids.length === 0) return null;
  const index = anchorId === null ? -1 : ids.indexOf(anchorId);
  if (index === -1) return direction === 1 ? ids[0] : ids[ids.length - 1];
  return ids[Math.min(ids.length - 1, Math.max(0, index + direction * pageRows))];
}

export function endTargetId(ids: number[], direction: 1 | -1): number | null {
  if (ids.length === 0) return null;
  return direction === 1 ? ids[ids.length - 1] : ids[0];
}
