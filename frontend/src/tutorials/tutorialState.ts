import { writeSetting } from '../settings/persistedSettings';
import { advance, type DeckId, type Lesson, type Progress, type TutorialEvent, type TutorialId } from './engine';
import { keyboardLesson } from './keyboardLesson';

export const TUTORIAL_STATE_KEY = 'manadj-tutorial-state';
export const OPEN_TUTORIAL_EVENT = 'manadj:open-tutorial';
export const lessons: Lesson[] = [keyboardLesson];
let progress: Partial<Record<TutorialId, Progress>> = {};
try {
  const stored = JSON.parse(localStorage.getItem(TUTORIAL_STATE_KEY) ?? '{}');
  for (const id of ['keyboard', 'transition'] as const) {
    const p = stored?.[id];
    if (p && ['active', 'skipped', 'complete'].includes(p.status) && Number.isInteger(p.step) && p.step >= 0
      && ['A', 'B', 'C', 'D'].includes(p.context?.deck) && ['A', 'B', 'C', 'D'].includes(p.context?.peer)) progress[id] = p;
  }
} catch { /* Fresh/corrupt preference: not started. */ }
let active: TutorialId | null = null;
let version = 0;
let feedback = '';
const listeners = new Set<() => void>();
const notify = () => { version++; listeners.forEach(fn => fn()); };
function persist() { writeSetting(TUTORIAL_STATE_KEY, JSON.stringify(progress)); notify(); }
export const tutorialVersion = () => version;
export function subscribeTutorial(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
export const tutorialProgress = (id: TutorialId) => progress[id];
export const activeTutorial = () => active;
export const tutorialFeedback = () => feedback;
export const lessonById = (id: TutorialId) => lessons.find(l => l.id === id)!;
export function requestTutorial(id: TutorialId) {
  startTutorial(id);
  window.dispatchEvent(new CustomEvent(OPEN_TUTORIAL_EVENT, { detail: lessonById(id).area }));
}
export function resumeTutorialInArea(area: string | null) {
  if (active) return;
  const lesson = lessons.find(l => l.area === area && progress[l.id]?.status === 'active');
  if (lesson) startTutorial(lesson.id, progress[lesson.id]!.context.deck, false);
}
export function startTutorial(id: TutorialId, deck: DeckId = 'A', replay = true) {
  const lesson = lessonById(id);
  if (!lesson) return;
  if (replay || !progress[id] || progress[id]!.step >= lesson.steps.length) {
    progress[id] = { status: 'active', step: 0, context: { deck, peer: deck === 'A' || deck === 'C' ? 'B' : 'A' } };
  }
  active = id;
  feedback = '';
  persist();
}
export function acceptTutorialEvent(event: TutorialEvent) {
  if (!active) return;
  const p = progress[active]!;
  const lesson = lessonById(active);
  const next = advance(lesson, p, event);
  if (next === p) return;
  feedback = `${lesson.steps[p.step].copy(p.context).title} — done`;
  progress[active] = next;
  persist();
}
export function skipTutorial() {
  if (active && progress[active]?.status === 'active') {
    progress[active] = { ...progress[active]!, status: 'skipped' };
  }
  active = null; feedback = ''; persist();
}
export function finishBonus() {
  if (!active) return;
  const p = progress[active]!;
  if (!lessonById(active).steps[p.step]?.bonus) return;
  progress[active] = { ...p, status: 'complete' }; persist();
}
