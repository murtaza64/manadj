// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import type { SyncResult } from '../types';
import { PlaylistDetailView } from './PlaylistDetailView';

vi.mock('../settings/useAppConfig', () => ({ useExportEnabled: () => true }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

async function syncAndRender(result: SyncResult | SyncResult[]) {
  vi.spyOn(api.playlistSync, 'sync').mockResolvedValue(result);
  const confirm = vi.spyOn(window, 'confirm');
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  act(() => root.render(<QueryClientProvider client={client}>
    <PlaylistDetailView playlist={{ name: 'Alien', manadj: [], engine: [], rekordbox: null, synced: false }} onBack={() => undefined} />
  </QueryClientProvider>));
  await act(async () => {
    [...host.querySelectorAll('button')].find(button => button.textContent === 'Engine DJ')!.click();
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(confirm).not.toHaveBeenCalled();
  expect(api.playlistSync.sync).toHaveBeenCalledWith('Alien', expect.objectContaining({ source: 'engine', target: 'manadj' }));
  return { host, root };
}

it('shows actual library additions and all track failures for a single target', async () => {
  const { host, root } = await syncAndRender({
    target: 'engine', success: true, created: false, tracks_synced: 2,
    tracks_to_add: ['planned-only.flac'], tracks_added: ['new.flac'],
    tracks_unmatched: ['missing.flac', 'broken.flac'],
    track_errors: { 'broken.flac': 'Cannot decode audio', 'error-only.flac': 'Insert failed' },
  });
  expect(host.textContent).toContain('engine: partially synced');
  expect(host.textContent).toContain('Added 1 destination library record');
  expect(host.textContent).toContain('new.flac');
  expect(host.textContent).not.toContain('planned-only.flac');
  expect(host.textContent).toContain('3 unavailable / failed');
  expect(host.textContent).toContain('missing.flac: Audio unavailable or track could not be prepared');
  expect(host.textContent).toContain('broken.flac: Cannot decode audio');
  expect(host.textContent).toContain('error-only.flac: Insert failed');
  expect(host.querySelectorAll('.sync-status-success')).toHaveLength(0);
  act(() => root.unmount());
});

it('shows per-target failures and supports omitted optional default fields', async () => {
  const { host, root } = await syncAndRender([
    { target: 'engine', success: false, created: false, tracks_synced: 0,
      tracks_unmatched: [], error: 'Database locked', track_errors: { 'bad.flac': 'Write failed' } },
    { target: 'rekordbox', success: true, created: true, tracks_synced: 3, tracks_unmatched: [] },
  ]);
  expect(host.textContent).toContain('engine: sync failed');
  expect(host.textContent).toContain('Database locked');
  expect(host.textContent).toContain('bad.flac: Write failed');
  expect(host.textContent).toContain('rekordbox: synced · 3 tracks synced (created)');
  expect(host.querySelectorAll('.sync-status-error')).toHaveLength(1);
  expect(host.querySelectorAll('.sync-status-success')).toHaveLength(1);
  act(() => root.unmount());
});
