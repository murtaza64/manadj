// @vitest-environment jsdom
import { act, useState } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import type { AppMode } from './components/TopBar';
import { isBrowseMode } from './components/browseHost';
import { useBrowseActive } from './contexts/browseActive';
import { useViewActive } from './contexts/viewActive';
import { OPEN_TAKE_EVENT } from './capture/takeReview';
import { OPEN_PAIR_EVENT } from './editor/openPair';
import { OPEN_ROUTINE_EVENT } from './routines/openRoutine';
import { OPEN_MIX_EVENT } from './routines/openMix';
import { OPEN_SESSION_EVENT } from './sessions/openSession';
import { OPEN_TUTORIAL_EVENT } from './tutorials/tutorialState';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const hardware = vi.hoisted(() => ({ toggle: undefined as (() => void) | undefined }));
vi.mock('./midi/controlRegistry', () => ({
  registerViewToggle: (toggle: () => void) => {
    hardware.toggle = toggle;
    return () => { hardware.toggle = undefined; };
  },
}));
vi.mock('./contexts/DeckContext', () => ({
  DeckProvider: ({ children }: { children: ReactNode }) => <div data-decks>{children}</div>,
}));
vi.mock('./contexts/FilterContext', () => ({
  FilterProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('./components/Toast', () => ({
  ToastProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('./components/MidiControllerBridge', () => ({ MidiControllerBridge: () => null }));
vi.mock('./components/MidiControlRegistrar', () => ({ MidiControlRegistrar: () => null }));
vi.mock('./components/MidiFeedbackBridge', () => ({ MidiFeedbackBridge: () => null }));
vi.mock('./components/MidiLevelMeterBridge', () => ({ MidiLevelMeterBridge: () => null }));
vi.mock('./components/AudioRoutingBridge', () => ({ AudioRoutingBridge: () => null }));
vi.mock('./components/VisualizerBridge', () => ({ VisualizerBridge: () => null }));
vi.mock('./tutorials/TutorialController', () => ({ TutorialController: () => null }));
vi.mock('./sets/ConductorPlanFeed', () => ({ ConductorPlanFeed: () => null }));
vi.mock('./sets/SetSpaceTransport', () => ({ SetSpaceTransport: () => null }));
vi.mock('./hooks/useAnalysisPending', () => ({ useAnalysisPendingSync: () => {} }));
vi.mock('./components/performance/PerformanceView', () => ({
  PerformanceView: () => <ModeProbe mode="performance" />,
}));
vi.mock('./editor/TransitionEditor', () => ({ default: () => <ModeProbe mode="transition" /> }));
vi.mock('./routines/RoutineEditorView', () => ({ default: () => <ModeProbe mode="routine" /> }));
vi.mock('./components/history/TakeHistoryView', () => ({
  TakeHistoryView: () => <ModeProbe mode="history" />,
}));
vi.mock('./components/SyncView', () => ({ SyncView: () => <ModeProbe mode="sync" /> }));
vi.mock('./settings/SettingsPage', () => ({
  default: ({ performance = false }: { performance?: boolean }) => (
    <div data-settings data-performance={performance}>Settings content</div>
  ),
}));
vi.mock('./components/TopBar', () => ({
  TopBar: ({ mode, onModeChange, settingsOpen, onSettingsToggle }: {
    mode: AppMode;
    onModeChange: (mode: AppMode) => void;
    settingsOpen: boolean;
    onSettingsToggle: () => void;
  }) => (
    <nav data-mode={mode}>
      {(['library', 'performance', 'transition', 'routine', 'history', 'sync'] as const).map(id => (
        <button key={id} onClick={() => onModeChange(id)}>{id}</button>
      ))}
      <button aria-label="Settings" aria-pressed={settingsOpen} onClick={onSettingsToggle}>Settings</button>
    </nav>
  ),
}));
vi.mock('./components/BrowsePanel', () => ({
  BrowsePanel: ({ mode, replacement }: { mode: AppMode; replacement?: ReactNode }) => (
    <div data-browse data-mode={mode} data-active={useBrowseActive()}
      data-replacement={replacement !== undefined} hidden={!isBrowseMode(mode)}>
      {replacement}
    </div>
  ),
}));

function ModeProbe({ mode }: { mode: string }) {
  const [count, setCount] = useState(0);
  return (
    <button data-panel={mode} data-view-active={useViewActive()}
      data-browse-active={useBrowseActive()} onClick={() => setCount(count + 1)}>
      {count}
    </button>
  );
}

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  window.history.replaceState(null, '', '/');
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mount(query = '', stored?: string) {
  window.history.replaceState(null, '', `/${query}`);
  if (stored) localStorage.setItem('manadj-app-mode', stored);
  await act(async () => root.render(<App />));
}
async function click(label: string) {
  const button = [...host.querySelectorAll('nav button')].find(node => node.textContent === label)!;
  await act(async () => (button as HTMLButtonElement).click());
}
function mode() { return host.querySelector('nav')!.getAttribute('data-mode'); }
function settingsOpen() { return host.querySelector('[aria-label="Settings"]')!.getAttribute('aria-pressed'); }
function params() { return new URLSearchParams(window.location.search); }

describe('Settings lower-panel shell', () => {
  it.each([['performance', 'performance'], ['edit', 'routine']])('opens the %s Tutorial from Settings without remounting Decks', async (area, target) => {
    await mount('?view=performance&settings=1');
    const decks = host.querySelector('[data-decks]');
    await act(async () => window.dispatchEvent(new CustomEvent(OPEN_TUTORIAL_EVENT, { detail: area })));
    expect(mode()).toBe(target);
    expect(settingsOpen()).toBe('false');
    expect(host.querySelector('[data-decks]')).toBe(decks);
  });
  it.each(['performance', 'transition', 'routine'] as const)('retains %s component state and active deck controls', async view => {
    await mount(`?view=${view}&section=mouse&other=keep`, view);
    const panel = host.querySelector<HTMLButtonElement>(`[data-panel="${view}"]`)!;
    const decks = host.querySelector('[data-decks]');
    const browse = host.querySelector('[data-browse]');
    act(() => panel.click());

    await click('Settings');
    expect(mode()).toBe(view);
    expect(host.querySelector('[data-decks]')).toBe(decks);
    expect(host.querySelector(`[data-panel="${view}"]`)).toBe(panel);
    expect(panel.textContent).toBe('1');
    expect(panel.dataset.viewActive).toBe('true');
    expect(panel.dataset.browseActive).toBe('false');
    expect(host.querySelector('[data-browse]')).toBe(browse);
    expect(browse!.getAttribute('data-active')).toBe('false');
    expect(browse!.getAttribute('data-replacement')).toBe('true');
    expect(host.querySelector('[data-settings]')!.getAttribute('data-performance')).toBe(String(view === 'performance'));
    expect(params().get('settings')).toBe('1');
    expect(localStorage.getItem('manadj-app-mode')).toBe(view);

    await click('Settings');
    expect(host.querySelector(`[data-panel="${view}"]`)).toBe(panel);
    expect(panel.textContent).toBe('1');
    expect(panel.dataset.viewActive).toBe('true');
    expect(panel.dataset.browseActive).toBe('true');
    expect(browse!.getAttribute('data-replacement')).toBe('false');
    expect(host.querySelector('[data-settings]')).toBeNull();
    expect(params().has('settings')).toBe(false);
    expect(params().get('section')).toBe('mouse');
    expect(params().get('other')).toBe('keep');
    expect(params().get('view')).toBe(view);
  });

  it('keeps Export in library mode while Settings replaces its lower body', async () => {
    await mount('?view=library');
    await click('Settings');
    expect(mode()).toBe('library');
    expect(host.querySelector('[data-panel]')).toBeNull();
    expect(host.querySelector('[data-browse]')!.getAttribute('data-replacement')).toBe('true');
    expect(host.querySelector('[data-settings]')!.getAttribute('data-performance')).toBe('false');
    await click('Settings');
    expect(mode()).toBe('library');
  });

  it.each(['history', 'sync'] as const)('replaces %s without inventing decks and restores its state', async view => {
    await mount(`?view=${view}`);
    const panel = host.querySelector<HTMLButtonElement>(`[data-panel="${view}"]`)!;
    act(() => panel.click());
    await click('Settings');
    expect(mode()).toBe(view);
    expect(panel.dataset.viewActive).toBe('false');
    expect(panel.parentElement!.style.display).toBe('none');
    expect(host.querySelector('[data-panel="performance"]')).toBeNull();
    expect(host.querySelector('[data-browse]')!.hasAttribute('hidden')).toBe(true);
    expect(host.querySelector('[data-browse]')!.getAttribute('data-replacement')).toBe('false');
    expect(host.querySelector('[data-settings]')).not.toBeNull();
    await click('Settings');
    expect(mode()).toBe(view);
    expect(host.querySelector(`[data-panel="${view}"]`)).toBe(panel);
    expect(panel.dataset.viewActive).toBe('true');
    expect(panel.textContent).toBe('1');
  });

  it('closes Settings on explicit mode selection, even the current mode', async () => {
    await mount('?view=performance&settings=1&section=mouse');
    for (const next of ['performance', 'library', 'routine', 'sync', 'history', 'transition']) {
      await click(next);
      expect(mode()).toBe(next);
      expect(settingsOpen()).toBe('false');
      expect(params().has('settings')).toBe(false);
      expect(params().get('view')).toBe(next);
      expect(params().get('section')).toBe('mouse');
      expect(localStorage.getItem('manadj-app-mode')).toBe(next);
      await click('Settings');
    }
  });

  it('uses current mode in once-bound backtick and hardware VIEW handlers', async () => {
    await mount('?view=library');
    await click('Settings');
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: '`', bubbles: true })));
    expect(mode()).toBe('performance');
    expect(settingsOpen()).toBe('false');
    await click('Settings');
    await act(async () => hardware.toggle!());
    expect(mode()).toBe('library');
    expect(settingsOpen()).toBe('false');
    expect(params().has('settings')).toBe(false);
    expect(localStorage.getItem('manadj-app-mode')).toBe('library');
  });

  it.each([
    [OPEN_TAKE_EVENT, 'transition'], [OPEN_PAIR_EVENT, 'transition'],
    [OPEN_ROUTINE_EVENT, 'routine'], [OPEN_MIX_EVENT, 'routine'],
    [OPEN_SESSION_EVENT, 'library'],
  ])('closes Settings on %s after its listener was bound', async (event, next) => {
    await mount('?view=performance');
    await click('Settings');
    await act(async () => window.dispatchEvent(new Event(event)));
    expect(mode()).toBe(next);
    expect(settingsOpen()).toBe('false');
    expect(params().get('view')).toBe(next);
    expect(params().has('settings')).toBe(false);
  });
});

describe('Settings links and remembered modes', () => {
  it.each([
    ['?view=library&settings=1&section=mouse', 'performance', 'library', true],
    ['?view=performance&settings=1', undefined, 'performance', true],
    ['?view=history&settings=1', undefined, 'history', true],
    ['?view=sync&settings=1', undefined, 'sync', true],
    ['?view=settings&section=mouse', 'library', 'performance', true],
    ['', 'settings', 'performance', true],
    ['?view=library', 'settings', 'library', false],
    ['?view=invalid', 'routine', 'routine', false],
    ['', 'performance', 'performance', false],
    ['?settings=0', undefined, 'performance', false],
    ['', undefined, 'performance', false],
  ])('parses %s with stored %s', async (query, stored, expectedMode, open) => {
    await mount(query, stored);
    expect(mode()).toBe(expectedMode);
    expect(settingsOpen()).toBe(String(open));
    expect(Boolean(host.querySelector('[data-settings]'))).toBe(open);
    await click('Settings');
    expect(params().get('view')).toBe(expectedMode);
    expect(params().get('settings')).toBe(open ? null : '1');
    expect(localStorage.getItem('manadj-app-mode')).toBe(expectedMode);
    expect(params().get('section')).toBe(new URLSearchParams(query).get('section'));
  });
});
