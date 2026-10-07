/** Registers the Controller check Setup guide (setup-guides PRD #292). */
import { lazy } from 'react';
import { guideStatus, registerGuide } from '../guides';

export const CONTROLLER_CHECK_ID = 'controller-check';

registerGuide({
  id: CONTROLLER_CHECK_ID,
  title: 'Controller check',
  // Sequence: Welcome → Rekordbox → tracks dir → Cue mode → SoundCloud →
  // Soulseek → Controller check → Tour.
  order: 60,
  status: () => guideStatus(CONTROLLER_CHECK_ID),
  Component: lazy(() => import('./ControllerCheckGuide')),
});
