/** Settings → Setup (setup-guides #288): every registered guide with its
 * status and a launch button; "Run setup again" replays the whole
 * sequence. Launches open in the shared SetupOverlay. */
import { useState, useSyncExternalStore } from 'react';
import {
  guideStatus,
  listGuides,
  setGuideStatus,
  subscribeSetupState,
  setupJourney,
  saveSetupJourney,
  getGuide,
  type GuideStatus,
  type SetupGuide,
} from './guides';
import { SetupOverlay } from './SetupOverlay';
import { SetupSequence } from './SetupSequence';
import { guidePresentation } from './guidePresentation';
import { GuideContent } from './GuideContent';
import { HelpLink } from '../help/HelpLink';
import { guideHelp } from '../help/contexts';
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
  const [launched, setLaunched] = useState<SetupGuide | 'all' | 'resume' | null>(null);
  const guides = listGuides();
  const close = () => setLaunched(null);
  const journey = setupJourney();
  const keepDone = launched && typeof launched !== 'string' && guideStatus(launched.id) === 'done';

  return (
    <>
      <div className="settings-section-heading">
        <div>
          <h2>Setup</h2>
          <p>Pick up where you left off, or revisit one part of your setup.</p>
        </div>
        <button className="btn btn-secondary" onClick={() => setLaunched('all')} disabled={!guides.length}>
          Run setup again
        </button>
      </div>
      {journey && <p><button className="btn btn-primary" onClick={() => setLaunched('resume')}>Resume setup</button></p>}
      <ul className="setup-guide-list">
        {guides.map((g) => {
          const status = g.status();
          return (
            <li key={g.id} className="setup-guide-row" data-testid={`setup-row-${g.id}`}>
              <span className="setup-guide-title">{g.title}<small>{guidePresentation(g.id).description}</small></span>
              <span className={`setup-status ${status}`}>{STATUS_LABEL[status]}</span>
              <button className="btn btn-mini" onClick={() => setLaunched(g)}>
                {status === 'not-started' ? 'Start' : 'Open'}
              </button>
            </li>
          );
        })}
      </ul>
      {launched === 'all' && (
        <SetupOverlay testId="setup-relaunch" onClose={close}>
          <SetupSequence guides={guides} onFinish={close} />
        </SetupOverlay>
      )}
      {launched === 'resume' && journey && (
        <SetupOverlay testId="setup-relaunch" onClose={close}>
          <SetupSequence guides={journey.ids.map(getGuide).filter((g): g is SetupGuide => !!g)}
            initialIndex={journey.index} persist onPause={close} onFinish={() => {
              setGuideStatus('welcome', 'done');
              saveSetupJourney(null);
              close();
            }} />
        </SetupOverlay>
      )}
      {launched && typeof launched !== 'string' && (
        <SetupOverlay testId="setup-relaunch" onClose={close}>
          <div className="setup-standalone-body">
           <div className="setup-sequence-header"><span className="setup-eyebrow">Setup / {launched.title}</span><button className="btn btn-secondary btn-mini" onClick={close}>Close guide</button></div>
           <HelpLink {...guideHelp(launched.id)} label={`Help: ${launched.title}`} />
          <GuideContent key={launched.id}>
          <launched.Component
            onDone={() => {
              setGuideStatus(launched.id, 'done');
              close();
            }}
            onSkip={() => {
              // Closing a relaunched guide never demotes a finished one.
              setGuideStatus(launched.id, keepDone ? 'done' : 'skipped');
              close();
            }}
          />
          </GuideContent>
          </div>
        </SetupOverlay>
      )}
    </>
  );
}
