/** Standalone host: Settings → SoundCloud. */
import { useSyncExternalStore } from 'react';
import { guideStatus, setGuideStatus, subscribeSetupState } from '../guides';
import SoundCloudGuide from './SoundCloudGuide';
import { SOUNDCLOUD_GUIDE_ID } from './register';

const STATUS_LABEL = { done: 'Done', skipped: 'Skipped', 'not-started': 'Not started' } as const;

export default function SoundCloudSettings() {
  const status = useSyncExternalStore(subscribeSetupState, () => guideStatus(SOUNDCLOUD_GUIDE_ID));
  return (
    <>
      <p className="settings-hint" data-testid="soundcloud-guide-status">
        Guide status: {STATUS_LABEL[status]}
      </p>
      <SoundCloudGuide
        onDone={() => setGuideStatus(SOUNDCLOUD_GUIDE_ID, 'done')}
        onSkip={() => setGuideStatus(SOUNDCLOUD_GUIDE_ID, 'skipped')}
      />
    </>
  );
}
