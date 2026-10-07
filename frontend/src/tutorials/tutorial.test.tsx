// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { advance, reportTutorialAction, type Progress } from './engine';
import { keyboardLesson } from './keyboardLesson';
import { TutorialController } from './TutorialController';
import { acceptTutorialEvent, activeTutorial, finishBonus, skipTutorial, startTutorial, tutorialProgress, TUTORIAL_STATE_KEY } from './tutorialState';
import { setTourArea } from '../tour/tourState';
import { hasKeyboardOverlay } from '../components/performance/performanceKeys';

vi.mock('./DeckTutorialObserver', () => ({ DeckTutorialObserver: () => null }));
vi.mock('../settings/persistedSettings', () => ({ writeSetting: (key: string, value: string) => localStorage.setItem(key, value) }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v) });
  setTourArea('performance');
  startTutorial('keyboard');
});
afterEach(() => {
  act(() => root?.unmount()); root = undefined;
  skipTutorial(); document.body.innerHTML = '';
  vi.useRealTimers();
});

it('ignores unrelated/wrong-deck evidence and has no generic next action', () => {
  const p: Progress = { status: 'active', step: 1, context: { deck: 'A', peer: 'B' } };
  for (const event of [{ type: 'next' }, { type: 'play', deck: 'B' as const }, { type: 'seek', deck: 'A' as const }]) {
    expect(advance(keyboardLesson, p, event)).toBe(p);
  }
  expect(advance(keyboardLesson, p, { type: 'play', deck: 'A' }).step).toBe(2);
});

it('requires every action in order, through the bonus and completion', () => {
  const decks = ['A','A','A','A','A','A',undefined,'B','A','B','B','B','B','B','A','B','B','B'] as const;
  let p: Progress = { status: 'active', step: 0, context: { deck: 'A', peer: 'B' } };
  keyboardLesson.steps.forEach((step, i) => {
    p = advance(keyboardLesson, p, { type: step.id, deck: decks[i] });
    expect(p.step).toBe(i + 1);
  });
  expect(p.status).toBe('complete');
  expect(advance(keyboardLesson, p, { type: 'load', deck: 'A' })).toBe(p);
});

it('persists cursor/context, records skip, and replay resets only that lesson', () => {
  startTutorial('keyboard', 'D');
  acceptTutorialEvent({ type: 'load', deck: 'D' });
  expect(JSON.parse(localStorage.getItem(TUTORIAL_STATE_KEY)!).keyboard).toMatchObject({ step: 1, context: { deck: 'D', peer: 'A' } });
  skipTutorial();
  expect(activeTutorial()).toBeNull();
  expect(tutorialProgress('keyboard')?.status).toBe('skipped');
  startTutorial('keyboard');
  expect(tutorialProgress('keyboard')).toMatchObject({ step: 0, status: 'active' });
});

it('cannot skip required tasks with the bonus finish action', () => {
  finishBonus();
  expect(tutorialProgress('keyboard')?.status).toBe('active');
});

it('leaves shortcuts and targets usable; raw keys do not advance', () => {
  const host = document.createElement('div'); document.body.append(host);
  act(() => { root = createRoot(host); root.render(<TutorialController />); });
  expect(hasKeyboardOverlay()).toBe(false);
  expect(document.querySelector('[role="dialog"], [role="menu"], input')).toBeNull();
  expect([...document.querySelectorAll('button')].some(b => b.textContent === 'Next')).toBe(false);
  for (const key of ['Enter', 'ArrowRight', 'Tab', 'd', 'Escape']) {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    document.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  }
  expect(tutorialProgress('keyboard')?.step).toBe(0);
  act(() => reportTutorialAction({ type: 'load', deck: 'A' }));
  expect(document.querySelector('h2')?.textContent).toBe('Start the music');
});

it('waits for future anchors and pauses evidence outside the lesson or under dialogs', () => {
  vi.useFakeTimers();
  const host = document.createElement('div'); document.body.append(host);
  act(() => { root = createRoot(host); root.render(<TutorialController />); });
  act(() => vi.advanceTimersByTime(500));
  expect(tutorialProgress('keyboard')?.step).toBe(0);
  const anchor = document.createElement('div'); anchor.dataset.tour = 'performance.browse'; document.body.append(anchor);
  act(() => vi.advanceTimersByTime(200));
  expect(anchor.classList.contains('tutorial-target')).toBe(true);
  act(() => setTourArea('edit'));
  act(() => reportTutorialAction({ type: 'load', deck: 'A' }));
  expect(tutorialProgress('keyboard')?.step).toBe(0);
  act(() => setTourArea('performance'));
  const modal = document.createElement('div'); modal.setAttribute('role', 'dialog'); document.body.append(modal);
  act(() => reportTutorialAction({ type: 'load', deck: 'A' }));
  expect(tutorialProgress('keyboard')?.step).toBe(0);
});
