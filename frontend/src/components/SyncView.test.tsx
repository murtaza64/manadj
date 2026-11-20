// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const gate = vi.hoisted(() => ({ connected: false }));
vi.mock('./acquisition/useAcquisitionAvailable', () => ({ useAcquisitionAvailable: () => gate.connected }));
vi.mock('./SyncBrowser', () => ({ SyncBrowser: ({ toolbar }: { toolbar?: React.ReactNode }) => <div data-testid="unified">{toolbar}</div> }));
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
const openTools = () => act(() => { (host.querySelector('.sync-tools > button[aria-expanded]') as HTMLButtonElement).click(); });
const tools = () => [...host.querySelectorAll('.sync-tool')].map((t) => t.textContent);
const pick = (label: string) => act(() => { ([...host.querySelectorAll('.sync-tool')].find((t) => t.textContent === label) as HTMLButtonElement).click(); });
const title = () => host.querySelector('.sync-nav-title')?.textContent;
const tick = () => new Promise((r) => setTimeout(r, 10));

it('keeps Acquisition discoverable without a connected source and after disconnect', () => {
  gate.connected = false;
  act(() => root.render(<SyncView />));
  expect(host.querySelector('.sync-view-tab')).toBeNull();
  expect(host.querySelector('.sync-nav')).toBeNull();
  expect(host.querySelector('.sync-tools > button')?.textContent).toBe('Acquisition');
  openTools();
  expect(tools()).toContain('Acquisition');
  pick('Acquisition');
  expect(host.querySelector('[data-testid="acquisition"]')).not.toBeNull();
  expect(title()).toBe('Acquisition');
  gate.connected = false;
  act(() => root.render(<SyncView />));
  expect(host.querySelector('[data-testid="acquisition"]')).not.toBeNull();
});

it('a tool has a way back to Sync', () => {
  gate.connected = false;
  act(() => root.render(<SyncView />));
  openTools(); pick('Playlists');
  expect(title()).toBe('Playlists');
  act(() => (host.querySelector('.sync-back') as HTMLButtonElement).click());
  expect(host.querySelector('.sync-nav')).toBeNull();
});

it('lands on USB drives when a playlist surface asks for a USB sync', async () => {
  vi.spyOn(api.externalDrives, 'list').mockResolvedValue([]);
  await act(async () => {
    root.render(<SyncView />);
    await tick();
  });
  expect(host.querySelector('.sync-nav')).toBeNull();
  await act(async () => {
    openUsbSync('Warm Up');
    await tick();
  });
  expect(title()).toBe('USB tracks');
  expect(takeUsbSyncFocus()).toBeNull(); // live event consumed, cannot replay on remount
});

it('consumes a USB sync request that fired before the view mounted', async () => {
  vi.spyOn(api.externalDrives, 'list').mockResolvedValue([]);
  openUsbSync('Warm Up');
  await act(async () => {
    root.render(<StrictMode><SyncView /></StrictMode>);
    await tick();
  });
  expect(title()).toBe('USB tracks');
});
