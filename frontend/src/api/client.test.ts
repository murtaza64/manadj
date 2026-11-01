import { afterEach, describe, expect, it, vi } from 'vitest';

import { api, detailToMessage, PlaylistExportRequestError } from './client';
import { exportPlanFixture, exportReportFixture } from '../test/playlistExportFixtures';


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
      'http://localhost:8127/api/sync/export/playlists/performance?playlist=Alien%20%26%20Friends',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targets: ['rekordbox', 'engine'] }),
      },
    );
  });

  it('routes playlist syncs with slashes in the name through a query param', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({})));

    await api.playlistSync.sync('scb/halloween', {
      source: 'manadj',
      ignore_missing_tracks: false,
      dry_run: false,
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8127/api/sync/playlists/sync?playlist=scb%2Fhalloween',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('submits exactly the reviewed target, scope and freshness token', async () => {
    const report = structuredClone(exportReportFixture);
    report.playlist_name = 'A / B';
    report.results[0].target = 'engine';
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(report)));
    await api.playlistSync.executeExportPlan({ ...exportPlanFixture, playlist_name: 'A / B', target: 'engine', scope: 'order' });
    expect(fetch).toHaveBeenCalledWith('http://localhost:8127/api/sync/export/playlists/execute?playlist=A%20%2F%20B', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'engine', scope: 'order', token: 'fixture-plan-token' }),
    });
  });

  it('distinguishes revalidation rejection from an unknown write outcome', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ detail: { code: 'stale_plan', message: 'Changed; recheck' } }), { status: 409 }));
    await expect(api.playlistSync.executeExportPlan(exportPlanFixture)).rejects.toMatchObject({ code: 'stale_plan', message: 'Changed; recheck' });
    fetch.mockResolvedValue(new Response('server disconnected', { status: 502 }));
    await expect(api.playlistSync.executeExportPlan(exportPlanFixture)).rejects.toMatchObject({ code: 'unknown' });
    fetch.mockRejectedValue(new TypeError('offline'));
    await expect(api.playlistSync.executeExportPlan(exportPlanFixture)).rejects.toBeInstanceOf(PlaylistExportRequestError);
  });

  it.each([
    ['empty', () => ({ playlist_name: 'Night Shift', results: [] })],
    ['non-array', () => ({ playlist_name: 'Night Shift', results: {} })],
    ['wrong playlist', () => ({ ...exportReportFixture, playlist_name: 'Other' })],
    ['wrong target', () => {
      const report = structuredClone(exportReportFixture); report.results[0].target = 'engine'; return report;
    }],
    ['missing track', () => {
      const report = structuredClone(exportReportFixture); report.results[0].tracks.pop(); return report;
    }],
    ['duplicate track', () => {
      const report = structuredClone(exportReportFixture); report.results[0].tracks[2] = report.results[0].tracks[0]; return report;
    }],
    ['missing field', () => {
      const report = structuredClone(exportReportFixture); delete report.results[0].tracks[0].fields.key; return report;
    }],
    ['malformed field', () => {
      const report = structuredClone(exportReportFixture); return { ...report, results: [{ ...report.results[0], tracks: [{ ...report.results[0].tracks[0], fields: { playlist: 12 } }] }] };
    }],
    ['wrong counters', () => {
      const report = structuredClone(exportReportFixture); report.results[0].tracks_total = 4; return report;
    }],
    ['invalid track status', () => {
      const report = structuredClone(exportReportFixture); return { ...report, results: [{ ...report.results[0], tracks: [{ ...report.results[0].tracks[0], status: 'done' }] }] };
    }],
    ['missing membership outcome', () => {
      const report = structuredClone(exportReportFixture); delete report.results[0].tracks[0].fields.playlist; return report;
    }],
  ])('treats %s HTTP200 receipts as unknown, not success or safe rejection', async (_name, body) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body())));
    await expect(api.playlistSync.executeExportPlan(exportPlanFixture)).rejects.toMatchObject({ code: 'unknown' });
  });

  it('accepts complete per-field receipts including skips and failures', async () => {
    const report = structuredClone(exportReportFixture);
    report.results[0].status = 'partial';
    report.results[0].tracks[0].status = 'failed';
    report.results[0].tracks[0].fields.key = 'failed: generated fixture';
    report.results[0].tracks_failed = 1;
    report.results[0].tracks_exported = 2;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(report)));
    await expect(api.playlistSync.executeExportPlan(exportPlanFixture)).resolves.toEqual(report);
  });

  it.each(['result', 'track'])('rejects an array-valued %s status as an unknown outcome', async where => {
    const report = structuredClone(exportReportFixture);
    const node = where === 'result' ? report.results[0] : report.results[0].tracks[0];
    Object.assign(node, { status: [node.status] });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(report)));
    await expect(api.playlistSync.executeExportPlan(exportPlanFixture)).rejects.toMatchObject({ code: 'unknown' });
  });

  it('accepts an explicitly aborted track without inventing later field outcomes', async () => {
    const report = structuredClone(exportReportFixture);
    report.results[0].status = 'partial';
    report.results[0].tracks[0] = { ...report.results[0].tracks[0], status: 'failed', fields: { playlist: 'exported' }, reason: 'Writer aborted before remaining fields' };
    report.results[0].tracks_failed = 1;
    report.results[0].tracks_exported = 2;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(report)));
    await expect(api.playlistSync.executeExportPlan(exportPlanFixture)).resolves.toEqual(report);
  });

  it('accepts a complete empty-playlist receipt, but not an empty result list', async () => {
    const plan = { ...exportPlanFixture, tracks: [] };
    const report = structuredClone(exportReportFixture);
    Object.assign(report.results[0], { tracks: [], tracks_total: 0, tracks_exported: 0 });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(report)));
    await expect(api.playlistSync.executeExportPlan(plan)).resolves.toEqual(report);
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

describe('Take promotion errors', () => {
  afterEach(() => vi.restoreAllMocks());

  it('surfaces the backend conflict detail', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      detail: "promoted Transition must match Take's ordered track pair",
    }), { status: 409 }));
    await expect(api.takes.setPromoted('take', 'transition'))
      .rejects.toThrow("promoted Transition must match Take's ordered track pair");
  });

  it('keeps the status fallback for non-JSON failures', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('unavailable', { status: 503 }));
    await expect(api.takes.setPromoted('take', 'transition'))
      .rejects.toThrow('Failed to set take promotion (503)');
  });
});
