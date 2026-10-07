/** Only accepted application actions reach this engine. No timers or Next button. */
export type TutorialId = 'keyboard' | 'transition';
export type DeckId = 'A' | 'B' | 'C' | 'D';
export interface LessonContext {
  deck: DeckId;
  peer: DeckId;
  artifact?: string;
  editedVersion?: number;
  savedVersion?: number;
  saveError?: boolean;
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
  /** A latched proof (e.g. a successful autosave before audition). */
  satisfied?: (context: LessonContext) => boolean;
}
export interface Lesson {
  id: TutorialId;
  title: string;
  area: 'performance' | 'edit';
  steps: TutorialStep[];
  observe?: (progress: Progress, event: TutorialEvent) => Progress;
}
export interface Progress {
  status: 'active' | 'skipped' | 'complete';
  step: number;
  context: LessonContext;
}

export function advance(lesson: Lesson, progress: Progress, event: TutorialEvent): Progress {
  if (progress.status !== 'active') return progress;
  const observed = lesson.observe?.(progress, event) ?? progress;
  const { context } = observed;
  const step = lesson.steps[observed.step];
  if (!step || (!step.accepts(event, context) && !step.satisfied?.(context))) return observed;
  let index = observed.step + 1;
  while (lesson.steps[index]?.satisfied?.(context)) index++;
  return { ...observed, step: index, status: index === lesson.steps.length ? 'complete' : 'active' };
}

const listeners = new Set<(event: TutorialEvent) => void>();
export function reportTutorialAction(event: TutorialEvent) {
  for (const listener of listeners) listener(event);
}
export function subscribeTutorialActions(listener: (event: TutorialEvent) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
