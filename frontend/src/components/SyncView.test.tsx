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
const openTools = () => act(() => { (host.querySelector('.sync-tools > button') as HTMLButtonElement).click(); });
const tools = () => [...host.querySelectorAll('.sync-tool')].map((t) => t.textContent);
const pick = (label: string) => act(() => { ([...host.querySelectorAll('.sync-tool')].find((t) => t.textContent === label) as HTMLButtonElement).click(); });
const title = () => host.querySelector('.sync-nav-title')?.textContent;
const tick = () => new Promise((r) => setTimeout(r, 10));

it('keeps one Sync view; the other tools sit in a Tools menu and Acquisition stays hidden until a Supplier is configured (setup-guides #290, gh#342)', () => {
  gate.connected = false;
  act(() => root.render(<SyncView />));
  expect(host.querySelector('.sync-view-tab')).toBeNull();
  expect(host.querySelector('.sync-nav')).toBeNull();
  openTools();
  expect(tools()).toEqual(['Field review', 'Tracks', 'Playlists', 'USB tracks', 'Rekordbox import']);

  gate.connected = true;
  act(() => root.render(<SyncView />));
  expect(tools()).toEqual(['Field review', 'Tracks', 'Playlists', 'USB tracks', 'Acquisition', 'Rekordbox import']);
  pick('Acquisition');
  expect(host.querySelector('[data-testid="acquisition"]')).not.toBeNull();
  expect(title()).toBe('Acquisition');

  // disconnecting while on the tool falls back to Sync
  gate.connected = false;
  act(() => root.render(<SyncView />));
  expect(host.querySelector('[data-testid="acquisition"]')).toBeNull();
  expect(host.querySelector('.sync-nav')).toBeNull();
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
