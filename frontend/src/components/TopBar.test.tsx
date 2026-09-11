// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TopBar } from './TopBar';
import type { AppMode } from './TopBar';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('./AudioRoutingPicker', () => ({ AudioRoutingPicker: () => null }));
vi.mock('./AudioOwnershipChip', () => ({ AudioOwnershipChip: () => null }));
vi.mock('./TasksWidget', () => ({ TasksWidget: () => null }));
vi.mock('./MasterRecorderControl', () => ({ MasterRecorderControl: () => null }));
vi.mock('./VisualizerControlModal', () => ({ VisualizerControlModal: () => null }));
vi.mock('../visualizer/windowControl', () => ({ isVisualizerOpen: () => false, toggleVisualizer: vi.fn() }));
vi.mock('../playback/quantizeStore', () => ({
  subscribeQuantize: () => () => {}, isQuantizeOn: () => false, setQuantize: vi.fn(),
}));

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const onModeChange = vi.fn();
const onSettingsToggle = vi.fn();
beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
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
