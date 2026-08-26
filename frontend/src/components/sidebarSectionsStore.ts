/**
 * Sidebar section collapse store (library-sidebar gh#174): the sidebar is
 * one fluid list of collapsible sections (Tracks / Playlists / Sets) under
 * a pinned "All tracks". Collapse state is layout intent, persisted across
 * boots — module-level subscribable like perfSectionsStore; the section
 * headers are the writers, PlaylistSidebar and the browse-nav cursor
 * (Library.tsx) are the readers.
 */
import type { SidebarSectionId } from './browseNav';

const STORAGE_KEY = 'manadj-sidebar-sections';

const SECTION_IDS: SidebarSectionId[] = ['tracks', 'playlists', 'sets'];

type Collapsed = Record<SidebarSectionId, boolean>;

/** Default: everything expanded; only an explicit true collapses. */
function load(): Collapsed {
  const collapsed: Collapsed = { tracks: false, playlists: false, sets: false };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return collapsed;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return collapsed;
    for (const section of SECTION_IDS) {
      if ((parsed as Record<string, unknown>)[section] === true) {
        collapsed[section] = true;
      }
    }
  } catch {
    // garbage/unavailable storage → defaults
  }
  return collapsed;
}

function save(collapsed: Collapsed): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(collapsed));
  } catch {
    // persistence is best-effort; the session keeps its setting
  }
}

let collapsed = load();
const listeners = new Set<() => void>();

export function subscribeSidebarSections(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isSidebarSectionCollapsed(section: SidebarSectionId): boolean {
  return collapsed[section];
}

export function setSidebarSectionCollapsed(section: SidebarSectionId, on: boolean): void {
  if (collapsed[section] === on) return;
  collapsed = { ...collapsed, [section]: on };
  save(collapsed);
  for (const listener of listeners) listener();
}

export function toggleSidebarSection(section: SidebarSectionId): void {
  setSidebarSectionCollapsed(section, !collapsed[section]);
}
