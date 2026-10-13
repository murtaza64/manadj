/** Registers the Spotify connect Setup guide (#347). */
import { lazy } from 'react';
import { guideStatus, registerGuide } from '../guides';

export const SPOTIFY_GUIDE_ID = 'spotify';

registerGuide({
  id: SPOTIFY_GUIDE_ID,
  title: 'Spotify',
  // Between SoundCloud (40) and Soulseek (50).
  order: 45,
  status: () => guideStatus(SPOTIFY_GUIDE_ID),
  Component: lazy(() => import('./SpotifyGuide')),
});
