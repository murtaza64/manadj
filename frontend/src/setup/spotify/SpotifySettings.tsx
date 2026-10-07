/** Standalone host: Settings → Accounts → Spotify. */
import { useSyncExternalStore } from 'react';
import { guideStatus, setGuideStatus, subscribeSetupState } from '../guides';
import SpotifyGuide from './SpotifyGuide';
import { SPOTIFY_GUIDE_ID } from './register';

const STATUS_LABEL = { done: 'Done', skipped: 'Skipped', 'not-started': 'Not started' } as const;

export default function SpotifySettings() {
  const status = useSyncExternalStore(subscribeSetupState, () => guideStatus(SPOTIFY_GUIDE_ID));
  return (
    <>
      <p className="settings-hint" data-testid="spotify-guide-status">
        Guide status: {STATUS_LABEL[status]}
      </p>
      <SpotifyGuide
        onDone={() => setGuideStatus(SPOTIFY_GUIDE_ID, 'done')}
        onSkip={() => setGuideStatus(SPOTIFY_GUIDE_ID, 'skipped')}
      />
    </>
  );
}
