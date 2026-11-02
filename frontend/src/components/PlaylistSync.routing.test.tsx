// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import { PlaylistSync } from './PlaylistSync';
import { browseSession } from './browseStore';
import { selectSet, getSelectedSetId } from '../sets/setStore';
import { selectSession, getSelectedSessionUuid } from '../sessions/openSession';
import { clearLibraryPlaylistRequest, peekLibraryPlaylistRequest } from '../library/openPlaylist';
import { peekSyncWorkspace, takeSyncWorkspace } from '../sync/openWorkspace';
import type { UnifiedPlaylist } from '../types';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, client: QueryClient;
afterEach(() => { if (root) act(() => root.unmount()); client?.clear(); clearLibraryPlaylistRequest(); takeSyncWorkspace(); vi.restoreAllMocks(); document.body.innerHTML = ''; });
const tick = () => new Promise(r => setTimeout(r, 10));
async function render(playlist: UnifiedPlaylist) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(['playlistSync'], [playlist]); client.setQueryData(['playlistSyncStats'], {});
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => { root.render(<QueryClientProvider client={client}><PlaylistSync /></QueryClientProvider>); await tick(); });
}

it('routes exact playlist context to Sync without replacing the Library browse selection', async () => {
  vi.spyOn(api.playlists, 'list').mockResolvedValue([{ id: 7, name: 'Night Shift' }]);
  selectSet(9); selectSession('previous-session');
  const previous = [browseSession().view, browseSession().playlistId, getSelectedSetId(), getSelectedSessionUuid()];
  await render({ name: 'Night Shift', manadj: [], engine: [], rekordbox: [], synced: true });
  await act(async () => { document.querySelector<HTMLTableRowElement>('tbody tr')!.click(); await tick(); });
  expect(peekSyncWorkspace()).toMatchObject({ kind: 'playlist', playlistName: 'Night Shift' });
  expect(peekLibraryPlaylistRequest()).toBeNull();
  expect([browseSession().view, browseSession().playlistId, getSelectedSetId(), getSelectedSessionUuid()]).toEqual(previous);
  expect(document.querySelector('.playlist-detail-container')).toBeNull();
});

it('imports external-only membership into Library explicitly before routing, never to other externals', async () => {
  vi.spyOn(api.playlists, 'list').mockResolvedValueOnce([]).mockResolvedValue([{ id: 22, name: 'Guest Set' }]);
  const sync = vi.spyOn(api.playlistSync, 'sync').mockResolvedValue({ target: 'manadj', success: true, tracks_synced: 1, tracks_unmatched: [], created: true });
  await render({ name: 'Guest Set', manadj: null, engine: [{ filename: 'a.flac' }], rekordbox: null, synced: false });
  act(() => document.querySelector<HTMLTableRowElement>('tbody tr')!.click());
  expect(document.body.textContent).toContain('does not import performance data or copy audio');
  const importButton = [...document.querySelectorAll('button')].find(b => b.textContent?.startsWith('Import 1 entries'))!;
  await act(async () => { importButton.click(); await tick(); });
  expect(sync).toHaveBeenCalledWith('Guest Set', { source: 'engine', target: 'manadj', ignore_missing_tracks: false, dry_run: false });
  expect(peekSyncWorkspace()).toMatchObject({ kind: 'playlist', playlistName: 'Guest Set' });
});

it('refuses ambiguous Library names instead of selecting the first playlist', async () => {
  vi.spyOn(api.playlists, 'list').mockResolvedValue([{ id: 1, name: 'Same' }, { id: 2, name: 'Same' }]);
  await render({ name: 'Same', manadj: [], engine: null, rekordbox: null, synced: true });
  await act(async () => { document.querySelector<HTMLTableRowElement>('tbody tr')!.click(); await tick(); });
  expect(document.querySelector('[role=alert]')?.textContent).toContain('ambiguous');
  expect(peekLibraryPlaylistRequest()).toBeNull();
  expect(peekSyncWorkspace()).toBeNull();
});
