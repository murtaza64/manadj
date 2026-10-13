/**
 * Collapsible sidebar section header (library-sidebar gh#174): the
 * uppercase section label (Tracks / Playlists / Sets) with a collapse
 * caret. Click toggles the section; state lives in sidebarSectionsStore
 * (persisted). Styling stays the Sets-header vocabulary the sidebar
 * already used.
 */
import { useSyncExternalStore } from 'react';
import type { SidebarSectionId } from './browseNav';
import {
  isSidebarSectionCollapsed,
  subscribeSidebarSections,
  toggleSidebarSection,
} from './sidebarSectionsStore';

export default function SidebarSectionHeader({
  id,
  label,
}: {
  id: SidebarSectionId;
  label: string;
}) {
  const collapsed = useSyncExternalStore(subscribeSidebarSections, () =>
    isSidebarSectionCollapsed(id)
  );
  return (
    <div
      className={`pl-sidebar-section-header${collapsed ? ' collapsed' : ''}`}
      data-section-header={id}
      role="button"
      aria-expanded={!collapsed}
      onClick={() => toggleSidebarSection(id)}
    >
      <span className="pl-sidebar-section-caret">{collapsed ? '▸' : '▾'}</span>
      {label}
    </div>
  );
}
