/** Only accepted application actions reach this engine. No timers or Next button. */
export type TutorialId = 'keyboard' | 'transition';
export type DeckId = 'A' | 'B' | 'C' | 'D';
export interface LessonContext {
  deck: DeckId;
  peer: DeckId;
  artifact?: string;
  editedVersion?: number;
  savedVersion?: number;
}
export interface TutorialEvent {
  type: string;
  deck?: DeckId;
  trackId?: number;
  artifact?: string;
  version?: number;
}
export interface TaskCopy { title: string; instruction: string; key?: string; target: string }
export interface TutorialStep {
  id: string;
  copy: (context: LessonContext) => TaskCopy;
  accepts: (event: TutorialEvent, context: LessonContext) => boolean;
  bonus?: boolean;
}
export interface Lesson { id: TutorialId; title: string; area: 'performance' | 'edit'; steps: TutorialStep[] }
export interface Progress {
  status: 'active' | 'skipped' | 'complete';
  step: number;
  context: LessonContext;
}

export function advance(lesson: Lesson, progress: Progress, event: TutorialEvent): Progress {
  if (progress.status !== 'active') return progress;
  const step = lesson.steps[progress.step];
  if (!step?.accepts(event, progress.context)) return progress;
  const index = progress.step + 1;
  return { ...progress, step: index, status: index === lesson.steps.length ? 'complete' : 'active' };
}

const listeners = new Set<(event: TutorialEvent) => void>();
export function reportTutorialAction(event: TutorialEvent) {
  for (const listener of listeners) listener(event);
}
export function subscribeTutorialActions(listener: (event: TutorialEvent) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
