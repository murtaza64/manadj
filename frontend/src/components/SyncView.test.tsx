// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const gate = vi.hoisted(() => ({ connected: false }));
vi.mock('../setup/soundcloud/soundcloudApi', () => ({ useSoundCloudConnected: () => gate.connected }));
vi.mock('./PlaylistSync', () => ({ PlaylistSync: () => null }));
vi.mock('./UnifiedTracksSync', () => ({ UnifiedTracksSync: () => null }));
vi.mock('./Acquisition', () => ({ Acquisition: () => <div data-testid="acquisition" /> }));

import { SyncView } from './SyncView';

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const tabs = () => [...host.querySelectorAll('.sync-view-tab')].map((t) => t.textContent);

it('hides Acquisition until SoundCloud is connected (setup-guides #290)', () => {
  gate.connected = false;
  act(() => root.render(<SyncView />));
  expect(tabs()).toEqual(['Tracks', 'Playlists', 'Rekordbox import']);

  gate.connected = true;
  act(() => root.render(<SyncView />));
  expect(tabs()).toEqual(['Tracks', 'Playlists', 'Acquisition', 'Rekordbox import']);
  act(() => (host.querySelectorAll('.sync-view-tab')[2] as HTMLButtonElement).click());
  expect(host.querySelector('[data-testid="acquisition"]')).not.toBeNull();

  // disconnecting while on the tab falls back to Tracks
  gate.connected = false;
  act(() => root.render(<SyncView />));
  expect(host.querySelector('[data-testid="acquisition"]')).toBeNull();
  expect(host.querySelector('.sync-view-tab.active')?.textContent).toBe('Tracks');
});
