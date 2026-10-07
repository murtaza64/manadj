/** Registers the Soulseek Setup guide (setup-guides PRD #291). */
import { lazy } from 'react';
import { guideStatus, registerGuide } from '../guides';

export const SOULSEEK_GUIDE_ID = 'soulseek';

registerGuide({
  id: SOULSEEK_GUIDE_ID,
  title: 'Soulseek',
  // Sequence: Welcome → Rekordbox → tracks dir → Cue mode → SoundCloud →
  // Soulseek → Controller check → Tour.
  order: 50,
  status: () => guideStatus(SOULSEEK_GUIDE_ID),
  Component: lazy(() => import('./SoulseekGuide')),
});
