import { useEffect, useState, useSyncExternalStore } from 'react';
import { activeTourSection, subscribeTour, tourVersion } from '../tour/tourState';
import { hasKeyboardOverlay } from '../components/performance/performanceKeys';
import { subscribeTutorialActions } from './engine';
import { acceptTutorialEvent, activeTutorial, finishBonus, lessonById, resumeTutorialInArea, skipTutorial, subscribeTutorial, tutorialFeedback, tutorialProgress, tutorialVersion } from './tutorialState';
import { DeckTutorialObserver } from './DeckTutorialObserver';
import './tutorial.css';

export function TutorialController() {
  useSyncExternalStore(subscribeTutorial, tutorialVersion);
  useSyncExternalStore(subscribeTour, tourVersion);
  const id = activeTutorial();
  const lesson = id ? lessonById(id) : null;
  const progress = id ? tutorialProgress(id) : null;
  const visible = lesson?.area === activeTourSection();
  const step = lesson && progress ? lesson.steps[progress.step] : null;
  const copy = step && progress ? step.copy(progress.context) : null;
  const [blocked, setBlocked] = useState(false);
  const [dockLeft, setDockLeft] = useState(false);

  useEffect(() => { resumeTutorialInArea(activeTourSection()); });

  useEffect(() => subscribeTutorialActions(event => {
    const active = activeTutorial();
    if (!active || lessonById(active).area !== activeTourSection() || hasKeyboardOverlay()
      || document.querySelector('[data-tour-suppress]')) return;
    acceptTutorialEvent(event);
  }), []);

  useEffect(() => {
    let highlighted: Element | null = null;
    const update = () => {
      const suppressed = hasKeyboardOverlay() || !!document.querySelector('[data-tour-suppress]');
      setBlocked(suppressed);
      const target = visible && !suppressed && copy ? document.querySelector(copy.target) : null;
      if (target === highlighted) return;
      highlighted?.classList.remove('tutorial-target');
      target?.classList.add('tutorial-target');
      highlighted = target;
    };
    update();
    const timer = setInterval(update, 200);
    return () => { clearInterval(timer); highlighted?.classList.remove('tutorial-target'); };
  }, [visible, copy?.target]);

  return <>
    <DeckTutorialObserver />
    {visible && !blocked && lesson && progress && <aside className={`tutorial-panel${dockLeft ? ' tutorial-left' : ''}`} aria-label={`${lesson.title} Tutorial`}>
      <header><span>TUTORIAL / {lesson.title}</span><button className="btn btn-secondary" onClick={skipTutorial}>{progress.status === 'complete' ? 'Close' : 'Skip tutorial'}</button></header>
      {progress.status === 'complete' ? <>
        <h2>Lesson complete</h2><p>Your changes stay in the Library. Replay any time from ? → Tutorials.</p>
      </> : copy && <>
        <div className="tutorial-progress">{step?.bonus ? 'BONUS' : 'TASK'} {progress.step + 1} / {lesson.steps.length}</div>
        <h2>{copy.title}</h2>
        <p>{copy.instruction}</p>
        {copy.key && <kbd>{copy.key}</kbd>}
        <p className="tutorial-wait">Do the action to continue. No Next button.</p>
        {step?.bonus && <button className="btn btn-secondary" onClick={finishBonus}>Finish without bonus</button>}
      </>}
      <div className="tutorial-feedback" role="status">{tutorialFeedback()}</div>
      <button className="btn btn-secondary" onClick={() => setDockLeft(v => !v)}>Move panel {dockLeft ? 'right' : 'left'}</button>
    </aside>}
  </>;
}
