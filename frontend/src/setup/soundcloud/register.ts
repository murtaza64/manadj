/** Registers the SoundCloud connect Setup guide (setup-guides PRD #290). */
import { lazy } from 'react';
import { guideStatus, registerGuide } from '../guides';

export const SOUNDCLOUD_GUIDE_ID = 'soundcloud';

registerGuide({
  id: SOUNDCLOUD_GUIDE_ID,
  title: 'SoundCloud',
  // Sequence: Welcome → Rekordbox → tracks dir → Cue mode → SoundCloud →
  // Soulseek → Controller check → Tour.
  order: 40,
  status: () => guideStatus(SOUNDCLOUD_GUIDE_ID),
  Component: lazy(() => import('./SoundCloudGuide')),
});
