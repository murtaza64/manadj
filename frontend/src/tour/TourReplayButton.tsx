/**
 * TopBar ? button (feature-tour #282, story 3): replay any section's
 * coach marks. Picking a section first navigates to its surface (mode
 * switch — the sidebar-level Sets and Sessions tours
 * land on the Library), then requests the tour; TourController waits for
 * the anchors to render.
 */

import { useEffect, useState } from 'react';
import type { AppMode } from '../components/TopBar';
import { TOUR_SECTIONS } from './steps';
import { requestTour, type TourSectionId } from './tourState';
import './tour.css';
import { lessons, skipTutorial, startTutorial } from '../tutorials/tutorialState';

const TARGET_MODE: Record<TourSectionId, AppMode> = {
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
}: {
  onModeChange: (mode: AppMode) => void;
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
    skipTutorial();
    setMenu(false);
    onModeChange(TARGET_MODE[section]);
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
            <span className="topbar-segment-label">Tutorials — learn by doing</span>
            {lessons.map(lesson => <button key={lesson.id} role="menuitem" className="topbar-mode-menu-item" onClick={() => {
              setMenu(false);
              onModeChange(lesson.area === 'performance' ? 'performance' : 'routine');
              startTutorial(lesson.id);
            }}>{lesson.title}</button>)}
            <span className="topbar-segment-label">Tours — look around</span>
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
