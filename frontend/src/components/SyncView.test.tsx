// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const gate = vi.hoisted(() => ({ connected: false }));
vi.mock('./acquisition/useAcquisitionAvailable', () => ({ useAcquisitionAvailable: () => gate.connected }));
vi.mock('./PlaylistSync', () => ({ PlaylistSync: () => null }));
vi.mock('./UnifiedTracksSync', () => ({ UnifiedTracksSync: () => null }));
vi.mock('./SyncWorkspace', () => ({ SyncWorkspace: () => <div data-testid="workspace" /> }));
vi.mock('./acquisition/AcquisitionView', () => ({ AcquisitionView: () => <div data-testid="acquisition" /> }));

import { SyncView } from './SyncView';
import { api } from '../api/client';
import { openUsbSync, takeUsbSyncFocus } from '../sync/openUsbSync';

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  takeUsbSyncFocus();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const tabs = () => [...host.querySelectorAll('.sync-view-tab')].map((t) => t.textContent);
const tick = () => new Promise((r) => setTimeout(r, 10));

it('hides Acquisition until a Supplier is configured (setup-guides #290, gh#342)', () => {
  gate.connected = false;
  act(() => root.render(<SyncView />));
  expect(tabs()).toEqual(['Workspace', 'Tracks', 'Playlists', 'USB drives', 'Rekordbox import']);

  gate.connected = true;
  act(() => root.render(<SyncView />));
  expect(tabs()).toEqual(['Workspace', 'Tracks', 'Playlists', 'USB drives', 'Acquisition', 'Rekordbox import']);
  act(() => (host.querySelectorAll('.sync-view-tab')[4] as HTMLButtonElement).click()); // Acquisition (after USB drives)
  expect(host.querySelector('[data-testid="acquisition"]')).not.toBeNull();

  // disconnecting while on the tab falls back to Tracks
  gate.connected = false;
  act(() => root.render(<SyncView />));
  expect(host.querySelector('[data-testid="acquisition"]')).toBeNull();
  expect(host.querySelector('.sync-view-tab.active')?.textContent).toBe('Workspace');
});

it('lands on USB drives when a playlist surface asks for a USB sync', async () => {
  vi.spyOn(api.externalDrives, 'list').mockResolvedValue([]);
  await act(async () => {
    root.render(<SyncView />);
    await tick();
  });
  expect(host.querySelector('.sync-view-tab.active')?.textContent).toBe('Workspace');
  await act(async () => {
    openUsbSync('Warm Up');
    await tick();
  });
  expect(host.querySelector('.sync-view-tab.active')?.textContent).toBe('USB drives');
  expect(takeUsbSyncFocus()).toBeNull(); // live event consumed, cannot replay on remount
});

it('consumes a USB sync request that fired before the view mounted', async () => {
  vi.spyOn(api.externalDrives, 'list').mockResolvedValue([]);
  openUsbSync('Warm Up');
  await act(async () => {
    root.render(<StrictMode><SyncView /></StrictMode>);
    await tick();
  });
  expect(host.querySelector('.sync-view-tab.active')?.textContent).toBe('USB drives');
});
