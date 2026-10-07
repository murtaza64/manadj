import { useSyncExternalStore } from 'react';
import { lessons, requestTutorial, subscribeTutorial, tutorialProgress, tutorialVersion } from './tutorialState';

export function TutorialSettings() {
  useSyncExternalStore(subscribeTutorial, tutorialVersion);
  return <section>
    <div className="settings-section-heading"><div><h2>Tutorials</h2><p>Hands-on lessons. Your actions advance each task; Library changes are real.</p></div></div>
    {lessons.map(lesson => <div className="tutorial-settings-row" key={lesson.id}>
      <span>{lesson.title} — {tutorialProgress(lesson.id)?.status ?? 'not started'}</span>
      <button className="btn btn-secondary" onClick={() => requestTutorial(lesson.id)}>Replay</button>
    </div>)}
  </section>;
}
