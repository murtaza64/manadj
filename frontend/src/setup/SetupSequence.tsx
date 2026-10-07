import { useEffect, useRef, useState } from 'react';
import { guideStatus, saveSetupJourney, setGuideStatus, type SetupGuide } from './guides';
import { guidePresentation } from './guidePresentation';
import { GuideContent } from './GuideContent';
import './setup.css';

export interface SetupSequenceProps {
  guides: SetupGuide[];
  onFinish: () => void;
  onPause?: () => void;
  initialIndex?: number;
  /** First run checkpoints survive closing/reloading, including after an import. */
  persist?: boolean;
}

export function SetupSequence({ guides, onFinish, onPause = onFinish, initialIndex = 0, persist = false }: SetupSequenceProps) {
  const [index, setIndex] = useState(initialIndex);
  const body = useRef<HTMLDivElement>(null);
  const guide = guides[index];
  const wasDone = guide ? guideStatus(guide.id) === 'done' : false;
  useEffect(() => {
    body.current?.closest('.setup-panel')?.scrollTo?.(0, 0);
    body.current?.focus({ preventScroll: true });
  }, [index]);

  const advance = (status: 'done' | 'skipped') => {
    // Skipping a replay does not undo completed configuration.
    setGuideStatus(guide.id, wasDone ? 'done' : status);
    const next = index + 1;
    if (persist) saveSetupJourney({ ids: guides.map((g) => g.id), index: next });
    setIndex(next);
  };

  return (
    <div className="setup-sequence" data-testid="setup-sequence">
      <aside className="setup-sequence-sidebar">
        <div className="setup-eyebrow">manaDJ / Setup</div>
        <ol className="setup-steps" aria-label="Setup steps">
          {guides.map((g, i) => {
            const status = i < index ? guideStatus(g.id) : 'not-started';
            return (
              <li key={g.id} className={`setup-step ${i === index ? 'active' : status}`}
                aria-current={i === index ? 'step' : undefined}>
                <span className="setup-step-number" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                <span>{g.title}<small>{i === index ? 'In progress' : i < index ? status === 'done' ? 'Done' : 'Skipped' : 'Optional'}</small></span>
              </li>
            );
          })}
        </ol>
        <p className="setup-sidebar-note">Make it yours, one step at a time. Every step is optional.</p>
      </aside>
      <div className="setup-sequence-main">
        <header className="setup-sequence-header">
          <span className="setup-eyebrow" role="status">{guide ? `Step ${index + 1} of ${guides.length} · ${guidePresentation(guide.id).category}` : 'Setup reviewed'}</span>
          {guide && <button className="btn btn-secondary btn-mini" onClick={onPause}>Finish later</button>}
        </header>
        <div className="setup-sequence-body" ref={body} tabIndex={-1}>
          {guide ? (
            <GuideContent key={guide.id}><guide.Component onDone={() => advance('done')} onSkip={() => advance('skipped')} /></GuideContent>
          ) : (
            <div className="setup-complete">
              <h1>Ready when you are.</h1>
              <p>Your choices are saved. Skipped steps are waiting in Settings → Setup.</p>
              <p className="setup-sidebar-note">Next, the Tour will show you around. You can dismiss it at any time.</p>
              <button className="btn btn-primary" onClick={onFinish}>Open manaDJ</button>
            </div>
          )}
        </div>
        {guide && <footer className="setup-sequence-footer">{index + 1 < guides.length ? `Up next: ${guides[index + 1].title}` : 'Last step — then you’re in.'}</footer>}
      </div>
    </div>
  );
}
