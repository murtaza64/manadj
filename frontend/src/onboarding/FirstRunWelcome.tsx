/** First run (#275, setup-guides #288): an empty Library (library_total
 * === 0) that has never finished or skipped First run gets a welcome
 * screen, then the Setup sequence — every registered guide in order
 * (Rekordbox import → tracks directory → Cue mode → …), each skippable.
 * When it closes, the feature tour takes over: the overlay wears
 * data-tour-suppress, so the tour starts the moment it unmounts. */
import { useEffect, useState } from 'react';
import { guideStatus, listGuides, setGuideStatus } from '../setup/guides';
import { SetupOverlay } from '../setup/SetupOverlay';
import { SetupSequence } from '../setup/SetupSequence';
import '../setup/allGuides';
import { onboardingApi } from './api';
import { WELCOME_GUIDE_ID } from './guideIds';
import './onboarding.css';

type Screen = 'hidden' | 'welcome' | 'sequence';

export function FirstRunWelcome() {
  const [screen, setScreen] = useState<Screen>('hidden');

  useEffect(() => {
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
  }, []);

  if (screen === 'hidden') return null;

  const finish = (status: 'done' | 'skipped') => {
    setGuideStatus(WELCOME_GUIDE_ID, status);
    setScreen('hidden');
  };
  // Guides already finished elsewhere (Settings) don't repeat.
  const pending = listGuides().filter((g) => g.status() !== 'done');

  return (
    <SetupOverlay testId="first-run-welcome">
      {screen === 'welcome' && (
        <div className="onboarding-guide">
          <h1 className="onboarding-hero">Welcome to manadj</h1>
          <p className="onboarding-muted">
            Your Library is empty. A few short steps get you playing — every one can be skipped and
            run again later from Settings → Setup.
          </p>
          <ol className="onboarding-plan">
            {pending.map((g) => (
              <li key={g.id}>{g.title}</li>
            ))}
          </ol>
          <div className="onboarding-actions">
            <button className="btn" onClick={() => finish('skipped')}>
              Skip setup
            </button>
            <button
              className="btn btn-primary"
              onClick={() => (pending.length ? setScreen('sequence') : finish('done'))}
            >
              Get started
            </button>
          </div>
        </div>
      )}
      {screen === 'sequence' && <SetupSequence guides={pending} onFinish={() => finish('done')} />}
    </SetupOverlay>
  );
}
