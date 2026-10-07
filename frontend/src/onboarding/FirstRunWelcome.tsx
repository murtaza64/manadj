/** First run (#275): an empty Library (library_total === 0) that has never
 * finished or skipped First run gets a welcome overlay — Import from
 * Rekordbox / Add a tracks directory / Skip. Carries data-tour-suppress so
 * the feature tour waits until First run is over (feature-tour lane). */
import { useEffect, useState } from 'react';
import { guideStatus, setGuideStatus } from '../setup/guides';
import { onboardingApi } from './api';
import { REKORDBOX_GUIDE_ID, WELCOME_GUIDE_ID } from './guideIds';
import { RekordboxImportGuide } from './RekordboxImportGuide';
import './onboarding.css';

type Screen = 'hidden' | 'welcome' | 'rekordbox';

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

  return (
    <div className="onboarding-overlay" data-tour-suppress="" data-testid="first-run-welcome">
      <div className="onboarding-panel">
        {screen === 'welcome' && (
          <div className="onboarding-guide">
            <h1 className="onboarding-hero">Welcome to manadj</h1>
            <p className="onboarding-muted">Your Library is empty. Where is your music?</p>
            <div className="onboarding-choices">
              <button className="onboarding-choice primary" onClick={() => setScreen('rekordbox')}>
                <span className="onboarding-choice-title">Import from Rekordbox</span>
                <span className="onboarding-choice-desc">
                  Tracks, hot cues, grids, keys, MyTags and playlists. Rekordbox is only read.
                </span>
              </button>
              <button className="onboarding-choice" disabled title="Coming with app settings (#276)">
                <span className="onboarding-choice-title">Add a tracks directory</span>
                <span className="onboarding-choice-desc">Scan a folder of audio files (coming soon).</span>
              </button>
            </div>
            <div className="onboarding-actions">
              <button className="btn" onClick={() => finish('skipped')}>
                Skip
              </button>
            </div>
          </div>
        )}
        {screen === 'rekordbox' && (
          <RekordboxImportGuide
            onDone={() => {
              setGuideStatus(REKORDBOX_GUIDE_ID, 'done');
              finish('done');
            }}
            onSkip={() => {
              setGuideStatus(REKORDBOX_GUIDE_ID, 'skipped');
              setScreen('welcome');
            }}
            onBackground={() => finish('done')}
          />
        )}
      </div>
    </div>
  );
}
