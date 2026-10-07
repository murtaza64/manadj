/** Standalone host: Settings → Soulseek. */
import { useSyncExternalStore } from 'react';
import { guideStatus, setGuideStatus, subscribeSetupState } from '../guides';
import SoulseekGuide from './SoulseekGuide';
import { SOULSEEK_GUIDE_ID } from './register';

const STATUS_LABEL = { done: 'Done', skipped: 'Skipped', 'not-started': 'Not started' } as const;

export default function SoulseekSettings() {
  const status = useSyncExternalStore(subscribeSetupState, () => guideStatus(SOULSEEK_GUIDE_ID));
  return (
    <>
      <p className="settings-hint" data-testid="soulseek-guide-status">
        Guide status: {STATUS_LABEL[status]}
      </p>
      <SoulseekGuide
        onDone={() => setGuideStatus(SOULSEEK_GUIDE_ID, 'done')}
        onSkip={() => setGuideStatus(SOULSEEK_GUIDE_ID, 'skipped')}
      />
    </>
  );
}
