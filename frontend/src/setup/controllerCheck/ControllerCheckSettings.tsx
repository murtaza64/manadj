/** Standalone host: Settings → Controller check. */
import { useSyncExternalStore } from 'react';
import { guideStatus, setGuideStatus, subscribeSetupState } from '../guides';
import ControllerCheckGuide from './ControllerCheckGuide';
import { CONTROLLER_CHECK_ID } from './register';

const STATUS_LABEL = { done: 'Done', skipped: 'Skipped', 'not-started': 'Not started' } as const;

export default function ControllerCheckSettings() {
  const status = useSyncExternalStore(subscribeSetupState, () => guideStatus(CONTROLLER_CHECK_ID));
  return (
    <>
      <p className="settings-hint" data-testid="controller-check-status">
        Guide status: {STATUS_LABEL[status]}
      </p>
      <ControllerCheckGuide
        onDone={() => setGuideStatus(CONTROLLER_CHECK_ID, 'done')}
        onSkip={() => setGuideStatus(CONTROLLER_CHECK_ID, 'skipped')}
      />
    </>
  );
}
