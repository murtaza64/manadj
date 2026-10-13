import { expect, it } from 'vitest';
import { advance, type Progress, type TutorialEvent } from './engine';
import { transitionLesson } from './transitionLesson';

const initial = (): Progress => ({ status: 'active', step: 0, context: { deck: 'A', peer: 'B' } });
function throughAutomation(): Progress {
  let p = initial();
  for (const event of [
    { type: 'transition-pick-a' }, { type: 'transition-pick-b' },
    { type: 'transition-created', artifact: 'lesson' },
    { type: 'transition-edited', artifact: 'lesson', version: 2 },
    { type: 'transition-slide', artifact: 'lesson' },
    { type: 'transition-edited', artifact: 'lesson', version: 3 },
    { type: 'transition-automation', artifact: 'lesson' },
  ]) p = advance(transitionLesson, p, event);
  expect(p.step).toBe(5);
  return p;
}
it('cannot adopt a restored artifact or a creation before the taught selections', () => {
  const p = initial();
  expect(advance(transitionLesson, p, { type: 'transition-created', artifact: 'unrelated' })).toBe(p);
  expect(advance(transitionLesson, p, { type: 'transition-restored', artifact: 'unrelated', version: 2 })).toBe(p);
});
it('scopes every edit, audition and save to the lesson artifact', () => {
  const p = throughAutomation();
  for (const type of ['transition-edited', 'transition-saved', 'transition-audition']) {
    expect(advance(transitionLesson, p, { type, artifact: 'other', version: 99 })).toBe(p);
  }
});
it('latches a save before audition without requiring a second edit', () => {
  let p = throughAutomation();
  p = advance(transitionLesson, p, { type: 'transition-saved', artifact: 'lesson', version: 3 });
  expect(p.step).toBe(5);
  p = advance(transitionLesson, p, { type: 'transition-audition', artifact: 'lesson' });
  expect(p.status).toBe('complete');
});
it('waits for latest-version save, not an older response or a failed request', () => {
  let p = throughAutomation();
  p = advance(transitionLesson, p, { type: 'transition-audition', artifact: 'lesson' });
  expect(p.step).toBe(6);
  for (const event of [
    { type: 'transition-saved', artifact: 'lesson', version: 2 },
    { type: 'transition-save-failed', artifact: 'lesson', version: 3 },
    { type: 'next' },
  ] satisfies TutorialEvent[]) {
    p = advance(transitionLesson, p, event);
    expect(p.status).toBe('active');
  }
  p = advance(transitionLesson, p, { type: 'transition-saved', artifact: 'lesson', version: 3 });
  expect(p.status).toBe('complete');
});
it('invalidates the prior save proof when another edit occurs', () => {
  let p = throughAutomation();
  p = advance(transitionLesson, p, { type: 'transition-saved', artifact: 'lesson', version: 3 });
  p = advance(transitionLesson, p, { type: 'transition-edited', artifact: 'lesson', version: 4 });
  p = advance(transitionLesson, p, { type: 'transition-audition', artifact: 'lesson' });
  expect(p.status).toBe('active');
});

it('reopening an older saved draft requires automation and audition again', () => {
  let p = throughAutomation();
  p = advance(transitionLesson, p, { type: 'transition-saved', artifact: 'lesson', version: 2 });
  p = advance(transitionLesson, p, { type: 'transition-restored', artifact: 'lesson', version: 10 });
  expect(p.step).toBe(4);
  p = advance(transitionLesson, p, { type: 'transition-audition', artifact: 'lesson' });
  expect(p.status).toBe('active');
});

it('settles the current save task from already-confirmed restored evidence', () => {
  const p: Progress = { status: 'active', step: 6, context: { deck: 'A', peer: 'B', artifact: 'lesson', editedVersion: 3, savedVersion: 3 } };
  const next = advance(transitionLesson, p, { type: 'transition-restored', artifact: 'lesson', version: 1 });
  expect(next.status).toBe('complete');
});
