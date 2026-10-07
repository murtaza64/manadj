/** Settings → Setup (setup-guides #288): every registered guide with its
 * status and a launch button; "Run setup again" replays the whole
 * sequence. Launches open in the shared SetupOverlay. */
import { useState, useSyncExternalStore } from 'react';
import {
  guideStatus,
  listGuides,
  setGuideStatus,
  subscribeSetupState,
  type GuideStatus,
  type SetupGuide,
} from './guides';
import { SetupOverlay } from './SetupOverlay';
import { SetupSequence } from './SetupSequence';
import './allGuides';
import './setup.css';

const STATUS_LABEL: Record<GuideStatus, string> = {
  done: 'Done',
  skipped: 'Skipped',
  'not-started': 'Not started',
};

let stateVersion = 0;
const bump = () => {
  stateVersion += 1;
};
subscribeSetupState(bump);
const getVersion = () => stateVersion;

export default function SetupSettings() {
  useSyncExternalStore(subscribeSetupState, getVersion);
  const [launched, setLaunched] = useState<SetupGuide | 'all' | null>(null);
  const guides = listGuides();
  const close = () => setLaunched(null);

  return (
    <>
      <div className="settings-section-heading">
        <div>
          <h2>Setup</h2>
          <p>Guides from first run. Run any of them again, or the whole sequence.</p>
        </div>
        <button className="btn btn-secondary" onClick={() => setLaunched('all')} disabled={!guides.length}>
          Run setup again
        </button>
      </div>
      <ul className="setup-guide-list">
        {guides.map((g) => {
          const status = g.status();
          return (
            <li key={g.id} className="setup-guide-row" data-testid={`setup-row-${g.id}`}>
              <span className="setup-guide-title">{g.title}</span>
              <span className={`setup-status ${status}`}>{STATUS_LABEL[status]}</span>
              <button className="btn btn-mini" onClick={() => setLaunched(g)}>
                {status === 'not-started' ? 'Start' : 'Open'}
              </button>
            </li>
          );
        })}
      </ul>
      {launched === 'all' && (
        <SetupOverlay testId="setup-relaunch">
          <SetupSequence guides={guides} onFinish={close} />
        </SetupOverlay>
      )}
      {launched && launched !== 'all' && (
        <SetupOverlay testId="setup-relaunch">
          <launched.Component
            onDone={() => {
              setGuideStatus(launched.id, 'done');
              close();
            }}
            onSkip={() => {
              // Closing a relaunched guide never demotes a finished one.
              if (guideStatus(launched.id) !== 'done') setGuideStatus(launched.id, 'skipped');
              close();
            }}
          />
        </SetupOverlay>
      )}
    </>
  );
}
