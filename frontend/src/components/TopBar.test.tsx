// @vitest-environment jsdom
import { act, StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TopBar } from './TopBar';
import type { AppMode } from './TopBar';
import { isQuantizeOn, setQuantize } from '../playback/quantizeStore';
import { writeSetting } from '../settings/persistedSettings';
import { PerformanceKeyboard } from './performance/PerformanceKeyboard';
import { stealsFocus } from '../focus/noFocusRule';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('./AudioRoutingPicker', () => ({ AudioRoutingPicker: () => null }));
vi.mock('./AudioOwnershipChip', () => ({ AudioOwnershipChip: () => null }));
vi.mock('./TasksWidget', () => ({ TasksWidget: () => null }));
vi.mock('./MasterRecorderControl', () => ({ MasterRecorderControl: () => null }));
vi.mock('./VisualizerControlModal', () => ({ VisualizerControlModal: () => null }));
vi.mock('../visualizer/windowControl', () => ({ isVisualizerOpen: () => false, toggleVisualizer: vi.fn() }));
vi.mock('../settings/persistedSettings', () => ({ writeSetting: vi.fn() }));
vi.mock('./performance/DeckKeys', () => ({ DeckKeys: () => null }));
vi.mock('../contexts/DeckContext', () => ({ DeckScope: ({ children }: { children: ReactNode }) => children }));
vi.mock('../hooks/useDeck', () => ({ useDecks: () => ({}) }));

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const onModeChange = vi.fn();
const onSettingsToggle = vi.fn();
beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  setQuantize(false);
  vi.clearAllMocks();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function render(settingsOpen: boolean, mode: AppMode = 'performance') {
  act(() => root.render(<TopBar mode={mode} onModeChange={onModeChange}
    settingsOpen={settingsOpen} onSettingsToggle={onSettingsToggle} />));
}

it('places the dedicated Settings segment immediately before overflow, not in its menu or tooltip', () => {
  render(false);
  const settings = host.querySelector<HTMLButtonElement>('[aria-label="Settings"]')!;
  const overflow = host.querySelector<HTMLButtonElement>('.topbar-segment-overflow')!;
  expect(settings.nextElementSibling).toBe(overflow);
  expect(settings.classList.contains('topbar-segment')).toBe(true);
  expect(overflow.title).not.toContain('Settings');
  act(() => overflow.click());
  expect(host.querySelector('[role="menu"]')!.textContent).toContain('HISTORY');
  expect(host.querySelector('[role="menu"]')!.textContent).not.toContain('SETTINGS');
  act(() => settings.click());
  expect(onSettingsToggle).toHaveBeenCalledOnce();
  expect(onModeChange).not.toHaveBeenCalled();
  expect(host.querySelector('[role="menu"]')).toBeNull();
});

it('lights Settings independently while keeping the underlying mode selected', () => {
  render(false);
  const settings = host.querySelector('[aria-label="Settings"]')!;
  const perform = host.querySelector('[title="Performance"]')!;
  expect(settings.getAttribute('aria-pressed')).toBe('false');
  expect(perform.getAttribute('aria-pressed')).toBe('true');
  render(true);
  expect(settings.getAttribute('aria-pressed')).toBe('true');
  expect(settings.classList.contains('active')).toBe(true);
  expect(perform.getAttribute('aria-pressed')).toBe('true');
  expect(perform.classList.contains('active')).toBe(true);
  render(false);
  expect(settings.classList.contains('active')).toBe(false);
  expect(perform.classList.contains('active')).toBe(true);
});

it('retains overflow mode selection and navigation while Settings is open', () => {
  render(true, 'history');
  const overflow = host.querySelector<HTMLButtonElement>('.topbar-segment-overflow')!;
  expect(overflow.classList.contains('active')).toBe(true);
  expect(overflow.textContent).toContain('HISTORY');
  act(() => overflow.click());
  act(() => host.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click());
  expect(onModeChange).toHaveBeenCalledWith('history');
  expect(onSettingsToggle).not.toHaveBeenCalled();
});

function key(options: KeyboardEventInit = {}, target: EventTarget = document.body, type = 'keydown') {
  const event = new KeyboardEvent(type, { key: 'Q', code: 'KeyQ', shiftKey: true, bubbles: true, cancelable: true, ...options });
  act(() => { target.dispatchEvent(event); });
  return event;
}

it.each(['q', 'Q'])('toggles once on fresh Shift+%s and claims repeats without toggling', value => {
  render(false);
  const laterCapture = vi.fn();
  const bubble = vi.fn();
  document.addEventListener('keydown', laterCapture, true);
  document.addEventListener('keydown', bubble);
  try {
    expect(key({ key: value }).defaultPrevented).toBe(true);
    expect(isQuantizeOn()).toBe(true);
    expect(key({ key: value, repeat: true }).defaultPrevented).toBe(true);
    expect(key({ key: value, repeat: true }).defaultPrevented).toBe(true);
    expect(writeSetting).toHaveBeenCalledExactlyOnceWith('manadj-quantize', 'true');
    expect(laterCapture).not.toHaveBeenCalled();
    expect(bubble).not.toHaveBeenCalled();
    expect(key({}, document.body, 'keyup').defaultPrevented).toBe(false);
    key({ key: value });
    expect(isQuantizeOn()).toBe(false);
    expect(writeSetting).toHaveBeenCalledTimes(2);
  } finally {
    document.removeEventListener('keydown', laterCapture, true);
    document.removeEventListener('keydown', bubble);
  }
});

it('reads current state before React repaints and exposes the hint, name and on state', () => {
  render(false);
  const button = host.querySelector<HTMLButtonElement>('[aria-label="Quantize"]')!;
  expect(button.querySelector('kbd')?.textContent).toBe('Shift+Q');
  expect(button.title).toContain('Shift+Q');
  expect(button.getAttribute('aria-keyshortcuts')).toBe('Shift+Q');
  expect(stealsFocus(button.querySelector('kbd'))).toBe(true);
  act(() => {
    setQuantize(true);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Q', shiftKey: true, bubbles: true }));
  });
  expect(isQuantizeOn()).toBe(false);
  act(() => button.click());
  expect(isQuantizeOn()).toBe(true);
  expect(button.classList.contains('on')).toBe(true);
  expect(button.getAttribute('aria-pressed')).toBe('true');
});

it.each(['library', 'performance', 'transition', 'routine', 'history', 'sync'] as const)(
  'works in %s and while Settings is open', mode => {
    render(false, mode); key(); expect(isQuantizeOn()).toBe(true);
    render(true, mode); key(); expect(isQuantizeOn()).toBe(false);
  }
);

it.each([{ shiftKey: false }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }, { key: 'W' }])(
  'ignores other chords and composing events: %j', options => {
    render(false);
    expect(key(options).defaultPrevented).toBe(false);
    expect(writeSetting).not.toHaveBeenCalled();
  }
);

it('leaves an already-claimed shortcut alone', () => {
  render(false);
  const event = new KeyboardEvent('keydown', { key: 'Q', shiftKey: true, bubbles: true, cancelable: true });
  event.preventDefault();
  act(() => { document.body.dispatchEvent(event); });
  expect(writeSetting).not.toHaveBeenCalled();
});

it.each(['checkbox', 'range', 'select'])('works from non-text Settings control %s', kind => {
  render(true);
  const control = document.createElement(kind === 'select' ? 'select' : 'input');
  if (control instanceof HTMLInputElement) control.type = kind;
  host.append(control);
  expect(key({}, control).defaultPrevented).toBe(true);
  expect(isQuantizeOn()).toBe(true);
});

it.each(['text', 'search', 'number', 'textarea', 'contenteditable', 'nested', 'plaintext-only'])(
  'does not toggle while editing %s', kind => {
    render(true);
    const editor = document.createElement(kind === 'textarea' ? 'textarea' : ['contenteditable', 'nested', 'plaintext-only'].includes(kind) ? 'div' : 'input');
    if (editor instanceof HTMLInputElement) editor.type = kind;
    else if (kind !== 'textarea') editor.setAttribute('contenteditable', kind === 'plaintext-only' ? kind : 'true');
    const target = kind === 'nested' ? editor.appendChild(document.createElement('span')) : editor;
    host.append(editor);
    expect(key({}, target).defaultPrevented).toBe(false);
    expect(writeSetting).not.toHaveBeenCalled();
  }
);

it.each(['dialog', 'menu', 'modal-overlay'])('respects visible %s overlays but not hidden ones', kind => {
  render(false);
  const overlay = document.createElement('div');
  if (kind === 'modal-overlay') overlay.className = 'filter-modal-overlay';
  else overlay.setAttribute('role', kind);
  host.append(overlay);
  expect(key().defaultPrevented).toBe(false);
  expect(writeSetting).not.toHaveBeenCalled();
  overlay.hidden = true;
  expect(key().defaultPrevented).toBe(true);
  expect(isQuantizeOn()).toBe(true);
});

it('binds once through StrictMode/rerenders and removes the handler on unmount', () => {
  const view = <StrictMode><TopBar mode="performance" onModeChange={onModeChange}
    settingsOpen={false} onSettingsToggle={onSettingsToggle} /></StrictMode>;
  act(() => root.render(view));
  key(); expect(writeSetting).toHaveBeenCalledTimes(1);
  act(() => root.render(view));
  key(); expect(writeSetting).toHaveBeenCalledTimes(2);
  act(() => root.render(null));
  expect(key().defaultPrevented).toBe(false);
  expect(writeSetting).toHaveBeenCalledTimes(2);
  act(() => root.render(view));
  key(); expect(writeSetting).toHaveBeenCalledTimes(3);
});

it.each([false, true])('works with library-focus capture registered before TopBar: %s', mountLate => {
  const view = (topbar: boolean) => <>
    <PerformanceKeyboard deckCount={4} left="A" right="B" onLoad={vi.fn()} />
    {topbar && <TopBar mode="performance" onModeChange={onModeChange} settingsOpen={false} onSettingsToggle={onSettingsToggle} />}
  </>;
  act(() => root.render(view(!mountLate)));
  key({ key: 'Tab', code: 'Tab', shiftKey: false });
  key({ key: 'Tab', code: 'Tab', shiftKey: false }, document.body, 'keyup');
  if (mountLate) act(() => root.render(view(true)));
  expect(host.querySelector('.perf-keyboard-scope')?.getAttribute('data-library-focus')).toBe('true');
  expect(key().defaultPrevented).toBe(true);
  expect(isQuantizeOn()).toBe(true);
  expect(writeSetting).toHaveBeenCalledTimes(1);
  expect(key({ repeat: true }).defaultPrevented).toBe(true);
  expect(writeSetting).toHaveBeenCalledTimes(1);
  key({ key: '?', code: 'Slash' });
  key(); expect(writeSetting).toHaveBeenCalledTimes(1);
});
