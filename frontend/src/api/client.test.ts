import { afterEach, describe, expect, it, vi } from 'vitest';

import { api, detailToMessage } from './client';


describe('playlistSync', () => {
  afterEach(() => vi.restoreAllMocks());

  it('renders structured per-target sync failures', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      detail: {
        message: '1 of 2 syncs failed',
        results: [
          { target: 'engine', success: true, error: null },
          { target: 'rekordbox', success: false, error: '2 tracks not found' },
        ],
      },
    }), { status: 400 }));

    await expect(api.playlistSync.sync('Test', {
      source: 'manadj',
      ignore_missing_tracks: false,
      dry_run: false,
    }))
      .rejects.toThrow('1 of 2 syncs failed: rekordbox: 2 tracks not found');
  });

  it('exports a playlist to selected performance-data destinations', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      playlist_name: 'Alien & Friends',
      results: [],
    })));

    await api.playlistSync.exportPerformance('Alien & Friends', ['rekordbox', 'engine']);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8127/api/sync/export/playlists/Alien%20%26%20Friends/performance',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targets: ['rekordbox', 'engine'] }),
      },
    );
  });
});

describe('detailToMessage', () => {
  it('joins FastAPI validation messages', () => {
    expect(detailToMessage([
      { loc: ['body', 'source'], msg: 'Field required', type: 'missing' },
      { loc: ['body', 'target'], msg: 'Invalid target', type: 'value_error' },
    ], 'Request failed')).toBe('Field required; Invalid target');
  });
});
