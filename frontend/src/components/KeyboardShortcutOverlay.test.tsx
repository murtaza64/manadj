// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { KeyboardShortcutOverlay } from './KeyboardShortcutOverlay';
import { KEYBOARD_ROWS, keyboardActions } from './keyboardShortcutModel';
import { _resetKeyboardHelpForTests, isKeyboardHelpOpen } from './keyboardHelpStore';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  _resetKeyboardHelpForTests();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(<KeyboardShortcutOverlay mode="performance" />));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  _resetKeyboardHelpForTests();
});

const press = (key: string, target: EventTarget = document) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  act(() => target.dispatchEvent(event));
  return event;
};

it('opens app-wide with ?, renders the whole keyboard, changes scope and closes', () => {
  expect(press('?').defaultPrevented).toBe(true);
  expect(host.querySelector('[role="dialog"][aria-label="Keyboard shortcuts"]')).not.toBeNull();
  expect(host.querySelectorAll('.keyboard-map-key')).toHaveLength(
    KEYBOARD_ROWS.reduce((count, row) => count + row.length, 0)
  );
  expect(host.textContent).toContain('FX target A');
  const library = [...host.querySelectorAll<HTMLButtonElement>('nav button')]
    .find((button) => button.textContent === 'Export')!;
  act(() => library.click());
  expect(host.textContent).toContain('Hot cue 1');
  expect(press('Escape').defaultPrevented).toBe(true);
  expect(isKeyboardHelpOpen()).toBe(false);
  expect(host.querySelector('[role="dialog"]')).toBeNull();
});

it('does not open while typing', () => {
  const input = document.createElement('input');
  input.type = 'text';
  host.append(input);
  press('?', input);
  expect(isKeyboardHelpOpen()).toBe(false);
});

it('reserves app shortcuts while open but leaves Tab available', () => {
  press('?');
  expect(press('`').defaultPrevented).toBe(true);
  expect(press('Tab').defaultPrevented).toBe(false);
});

it('keeps the keyboard legend and effect handler on one shared number-row map', () => {
  const actions = keyboardActions('performance');
  expect(actions.get('1')?.map((action) => action.action)).toContain('FX target A');
  expect(actions.get('5')?.map((action) => action.action)).toContain('FX target MST');
  expect(actions.get('6')?.map((action) => action.action)).toContain('FX length ÷2');
  expect(actions.get('7')?.map((action) => action.action)).toContain('FX length ×2');
  expect(actions.get('-')?.map((action) => action.action)).toContain('FX on/off');
  expect(actions.get('8')?.map((action) => action.action)).toContain('FX type previous');
  expect(actions.get('9')?.map((action) => action.action)).toContain('FX type next');
  expect(actions.get('0')?.map((action) => action.action)).toContain('FX depth + mouse');
  expect(actions.get('=')?.map((action) => action.action)).toContain('Quantize');
});

it('lists the Perform browse-panel keys on a Track browsing tab (#337)', () => {
  const actions = keyboardActions('browse');
  const legends = (id: string) => (actions.get(id) ?? []).map((a) => `${a.modifier ? `${a.modifier}:` : ''}${a.action}`);
  expect(legends('ArrowDown')).toContain('Next track');
  expect(legends('ArrowLeft')).toContain('Decks:Load focused left');
  expect(legends('Tab')).toContain('Library keyboard ↔ decks');
  expect(legends('F')).toEqual(expect.arrayContaining(['Cmd/Ctrl:Focus search', 'Lib:Follow parameters']));
  expect(legends('/')).toContain('Lib:Search');
  expect(legends('C')).toEqual(expect.arrayContaining(['Lib:Load onto C', 'Lib+Shift:Follow C']));
  expect(legends('N')).toContain('Lib:Known only');
  press('?');
  const tab = [...host.querySelectorAll<HTMLButtonElement>('nav button')]
    .find((button) => button.textContent === 'Track browsing')!;
  act(() => tab.click());
  expect(host.textContent).toContain('Load onto A');
});

it('opens on Track browsing while Perform has library keyboard focus', () => {
  const scope = document.createElement('div');
  scope.className = 'perf-keyboard-scope';
  scope.dataset.libraryFocus = 'true';
  document.body.append(scope);
  try {
    act(() => root.render(<KeyboardShortcutOverlay mode="performance" />));
    press('?');
    expect(host.querySelector('nav button[aria-pressed="true"]')!.textContent).toBe('Track browsing');
  } finally {
    scope.remove();
  }
});
