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
