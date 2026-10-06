/**
 * TopBar ? button (feature-tour #282, story 3): replay any section's
 * coach marks. Picking a section first navigates to its surface (mode
 * switch / Settings toggle — the sidebar-level Sets and Sessions tours
 * land on the Library), then requests the tour; TourController waits for
 * the anchors to render.
 */

import { useEffect, useState } from 'react';
import type { AppMode } from '../components/TopBar';
import { TOUR_SECTIONS } from './steps';
import { requestTour, type TourSectionId } from './tourState';
import './tour.css';

const TARGET_MODE: Record<Exclude<TourSectionId, 'settings'>, AppMode> = {
  library: 'library',
  performance: 'performance',
  edit: 'routine',
  sync: 'sync',
  sets: 'library',
  sessions: 'library',
  history: 'history',
};

export function TourReplayButton({
  onModeChange,
  settingsOpen,
  onSettingsToggle,
}: {
  onModeChange: (mode: AppMode) => void;
  settingsOpen: boolean;
  onSettingsToggle: () => void;
}) {
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    if (!menu) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [menu]);

  const replay = (section: TourSectionId) => {
    setMenu(false);
    if (section === 'settings') {
      if (!settingsOpen) onSettingsToggle();
    } else {
      onModeChange(TARGET_MODE[section]);
    }
    requestTour(section);
  };

  return (
    <span className="tour-replay">
      <button
        className="tour-replay-button"
        title="Tour: replay a section's guided walkthrough"
        aria-haspopup="menu"
        aria-expanded={menu}
        onClick={() => setMenu((v) => !v)}
      >
        ?
      </button>
      {menu && (
        <>
          <div className="topbar-mode-menu-scrim" onMouseDown={() => setMenu(false)} />
          <div className="topbar-mode-menu tour-replay-menu" role="menu">
            {TOUR_SECTIONS.map((s) => (
              <button
                key={s.id}
                role="menuitem"
                className="topbar-mode-menu-item"
                onClick={() => replay(s.id)}
              >
                <span className="topbar-segment-label">{s.label}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </span>
  );
}
