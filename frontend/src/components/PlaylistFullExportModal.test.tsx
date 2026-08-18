// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';

import { api } from '../api/client';
import { PlaylistFullExportModal } from './PlaylistFullExportModal';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

it('exports to selected destinations and renders the report', async () => {
  vi.spyOn(api.playlistSync, 'previewExportPerformance').mockResolvedValue({
    playlist_name: 'Alien',
    previews: [],
  });
  vi.spyOn(api.playlistSync, 'exportPerformance').mockResolvedValue({
    playlist_name: 'Alien',
    results: [{
      target: 'rekordbox',
      status: 'partial',
      playlist_created: false,
      tracks_total: 2,
      tracks_exported: 1,
      tracks_skipped: 0,
      tracks_failed: 1,
      tracks: [{
        track_id: 7,
        title: 'Tracer',
        status: 'failed',
        fields: { playlist: 'exported', beatgrid: 'failed: no ANLZ' },
        reason: 'failed: no ANLZ',
      }],
    }],
  });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  act(() => root.render(
    <QueryClientProvider client={client}>
      <PlaylistFullExportModal playlistName="Alien" onClose={() => undefined} />
    </QueryClientProvider>,
  ));

  const engine = host.querySelector<HTMLInputElement>('input[value="engine"]')!;
  act(() => engine.click());
  const exportButton = [...host.querySelectorAll('button')]
    .find(button => button.textContent === 'Export all data')!;
  await act(async () => {
    exportButton.click();
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  expect(api.playlistSync.exportPerformance).toHaveBeenCalledWith('Alien', ['rekordbox']);
  expect(host.textContent).toContain('1 exported, 1 failed');
  expect(host.textContent).toContain('Tracer');
  expect(host.textContent).toContain('failed: no ANLZ');
  act(() => root.unmount());
});

it('previews the plan for each destination before exporting', async () => {
  vi.spyOn(api.playlistSync, 'previewExportPerformance').mockResolvedValue({
    playlist_name: 'Alien',
    previews: [
      {
        target: 'rekordbox',
        available: true,
        playlist_exists: true,
        tracks_total: 35,
        tracks_matched: 33,
        tracks_to_add: 3,
        tracks_to_remove: 1,
        tracks_moved: 4,
        unmatched: ['ghost.flac', 'lost.flac'],
      },
      {
        target: 'engine',
        available: true,
        playlist_exists: false,
        tracks_total: 35,
        tracks_matched: 35,
        tracks_to_add: 35,
        tracks_to_remove: 0,
        tracks_moved: 0,
        unmatched: [],
      },
    ],
  });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <PlaylistFullExportModal playlistName="Alien" onClose={() => undefined} />
      </QueryClientProvider>,
    );
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  expect(api.playlistSync.previewExportPerformance).toHaveBeenCalledWith('Alien');
  expect(host.textContent).toContain('replaces playlist: adds 3, removes 1, moves 4');
  expect(host.textContent).toContain('overwrites data for 33 tracks');
  expect(host.textContent).toContain('2 unmatched');
  expect(host.textContent).toContain('creates playlist (35 tracks)');
  act(() => root.unmount());
});
