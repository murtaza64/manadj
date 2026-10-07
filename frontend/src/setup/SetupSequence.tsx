/** Setup sequence host (setup-guides #288): runs registered guides one
 * after another — each guide's own Done/Skip records its status and
 * advances. Used by First run (FirstRunWelcome) and by Settings → Setup
 * ("Run setup again"). A guide is free to render its own chrome; the host
 * only adds the step header. */
import { useState } from 'react';
import { setGuideStatus, type SetupGuide } from './guides';
import './setup.css';

export interface SetupSequenceProps {
  guides: SetupGuide[];
  /** Called after the last guide, or when the user leaves the sequence. */
  onFinish: () => void;
}

export function SetupSequence({ guides, onFinish }: SetupSequenceProps) {
  const [index, setIndex] = useState(0);
  const guide = guides[index];
  if (!guide) return null;

  const advance = (status: 'done' | 'skipped') => {
    setGuideStatus(guide.id, status);
    if (index + 1 >= guides.length) onFinish();
    else setIndex(index + 1);
  };
  const { Component } = guide;

  return (
    <div className="setup-sequence" data-testid="setup-sequence">
      <div className="setup-sequence-header">
        <ol className="setup-steps" aria-label="Setup steps">
          {guides.map((g, i) => (
            <li
              key={g.id}
              className={`setup-step${i === index ? ' active' : i < index ? ' past' : ''}`}
              aria-current={i === index ? 'step' : undefined}
            >
              {g.title}
            </li>
          ))}
        </ol>
        <button className="btn btn-mini setup-leave" onClick={onFinish}>
          Finish later
        </button>
      </div>
      <div className="setup-sequence-body">
        <Component key={guide.id} onDone={() => advance('done')} onSkip={() => advance('skipped')} />
      </div>
    </div>
  );
}
