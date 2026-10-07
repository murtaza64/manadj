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
    .find((button) => button.textContent === 'Library')!;
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
