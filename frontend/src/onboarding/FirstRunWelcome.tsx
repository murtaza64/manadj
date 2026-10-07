/** First run (#275, setup-guides #288): an empty Library (library_total
 * === 0) that has never finished or skipped First run gets a welcome
 * screen, then the Setup sequence — every registered guide in order
 * (Rekordbox import → tracks directory → Cue mode → …), each skippable.
 * When it closes, the feature tour takes over: the overlay wears
 * data-tour-suppress, so the tour starts the moment it unmounts. */
import { useEffect, useState } from 'react';
import { getGuide, guideStatus, listGuides, saveSetupJourney, setGuideStatus, setupJourney, type SetupGuide } from '../setup/guides';
import { SetupOverlay } from '../setup/SetupOverlay';
import { SetupSequence } from '../setup/SetupSequence';
import { guidePresentation } from '../setup/guidePresentation';
import '../setup/allGuides';
import { onboardingApi } from './api';
import { WELCOME_GUIDE_ID } from './guideIds';
import { HelpLink } from '../help/HelpLink';
import { guideHelp } from '../help/contexts';
import './onboarding.css';

type Screen = 'hidden' | 'welcome' | 'sequence';

export function FirstRunWelcome() {
  const [journey] = useState(setupJourney);
  const [screen, setScreen] = useState<Screen>(journey ? 'welcome' : 'hidden');
  const [sequenceGuides, setSequenceGuides] = useState<SetupGuide[]>(() =>
    journey?.ids.map(getGuide).filter((g): g is SetupGuide => !!g) ?? []);

  useEffect(() => {
    if (journey) return;
    if (guideStatus(WELCOME_GUIDE_ID) !== 'not-started') return;
    let cancelled = false;
    onboardingApi
      .libraryTotal()
      .then((total) => {
        if (!cancelled && total === 0) setScreen('welcome');
      })
      .catch(() => {
        // backend unreachable: never block the app on First run
      });
    return () => {
      cancelled = true;
    };
  }, [journey]);

  if (screen === 'hidden') return null;

  const finish = (status: 'done' | 'skipped') => {
    setGuideStatus(WELCOME_GUIDE_ID, status);
    saveSetupJourney(null);
    setScreen('hidden');
  };
  // Guides already finished elsewhere (Settings) don't repeat.
  const pending = listGuides().filter((g) => g.status() !== 'done');

  return (
    <SetupOverlay testId="first-run-welcome" onClose={() => {
      if (!setupJourney()) saveSetupJourney({ ids: pending.map((g) => g.id), index: 0 });
      setScreen('hidden');
    }}>
      {screen === 'welcome' && (
        <div className="onboarding-welcome">
          <div className="onboarding-welcome-intro">
            <div className="setup-eyebrow">Your first session</div>
            <h1 className="onboarding-hero">{journey ? 'Welcome back.' : 'Welcome to manaDJ.'}</h1>
            <p className="onboarding-lead">Your music.<br />Your way to play.</p>
            <p className="onboarding-muted">{journey
              ? 'Your progress is saved. Let’s pick up where you left off.'
              : 'Bring in your music, choose how you play, and check your equipment.'}</p>
            <div className="onboarding-reassurance">No need to do it all now.<br />Every step is optional.</div>
          </div>
          <div className="onboarding-welcome-plan">
            <h2 className="onboarding-title">{journey ? 'Your setup so far' : 'Make yourself at home'}</h2>
            <ol className="onboarding-plan">
              {(journey ? sequenceGuides : pending).map((g, i) => (
                <li key={g.id}>
                  <span className="onboarding-plan-number">{String(i + 1).padStart(2, '0')}</span>
                  <div><strong>{g.title}</strong><p>{journey && i < journey.index
                    ? g.status() === 'done' ? 'Done' : 'Skipped — revisit any time'
                    : guidePresentation(g.id).description}</p></div>
                </li>
              ))}
            </ol>
            <p className="onboarding-muted">You can revisit every guide in Settings → Setup.</p>
          </div>
          <div className="onboarding-actions">
            <HelpLink {...guideHelp(WELCOME_GUIDE_ID)} label="Help: Welcome" />
            <button className="btn btn-secondary" onClick={() => finish('skipped')}>
              Skip setup
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                const guides = journey ? sequenceGuides : pending;
                setSequenceGuides(guides);
                if (!journey) saveSetupJourney({ ids: guides.map((g) => g.id), index: 0 });
                setScreen('sequence');
              }}
            >
              {journey ? 'Resume setup' : 'Get started'}
            </button>
          </div>
        </div>
      )}
      {screen === 'sequence' && <SetupSequence guides={sequenceGuides} initialIndex={journey?.index ?? 0}
        persist onPause={() => setScreen('hidden')} onFinish={() => finish('done')} />}
    </SetupOverlay>
  );
}
