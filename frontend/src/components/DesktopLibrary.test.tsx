// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from '../api/client';
import { DesktopLibrary, diffLists, markerFor, buildRows } from './DesktopLibrary';
import type { PlaylistCoverage } from '../types';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });
async function mount() { const host = document.createElement('div'); document.body.append(host); await act(async () => { createRoot(host).render(<DesktopLibrary />); }); await act(async () => {}); return host; }

const src = (status: 'read' | 'not_configured' | 'failed', reason: string | null = null) => ({ status, reason, read_at: '2026-11-19T18:00:00Z', playlist_count: 0 });
const entry = (files: string[]) => [{ id: '1', tracks: files.map((filename) => ({ filename, track_id: null })) }];
const cov = (rb: 'read' | 'not_configured' | 'failed', playlists: PlaylistCoverage['playlists'] = [], reason: string | null = null): PlaylistCoverage => ({
  sources: { manadj: src('read'), engine: src('not_configured'), rekordbox: src(rb, reason) }, playlists,
});
const pl = (name: string, m: string[] | null, r: string[] | null) => ({ name, path: [name], entries: { manadj: m ? entry(m) : [], engine: [], rekordbox: r ? entry(r) : [] } });

describe('markers', () => {
  it('never says synced and qualifies equal lists', () => {
    const m = markerFor(buildRows(cov('read', [pl('A', ['/a.wav'], ['/a.wav'])]))[0], true);
    expect(m.label).toBe('Same paths');
    expect(m.tone).toBe('none');
    expect(m.hint).toContain('not compared');
  });
  it('flags missing, differing, order and unknown', () => {
    const rows = buildRows(cov('read', [pl('M', ['/a'], null), pl('D', ['/a'], ['/b']), pl('O', ['/a', '/b'], ['/b', '/a']), pl('R', null, ['/a'])]));
    expect(rows.map((r) => markerFor(r, true).label)).toEqual(['Not in Rekordbox', 'Tracks differ', 'Order differs', 'Only in Rekordbox']);
    expect(markerFor(rows[0], false).label).toBe('Unknown');
  });
  it('unresolved identity never allows export review, whatever the copy says', () => {
    const rows = buildRows(cov('read', [pl('C', ['/m/A.wav'], ['/m/a.wav']), pl('K', ['/m/A.wav', '/m/a.wav'], ['/m/A.wav', '/m/a.wav']), pl('Ok', ['/m/a'], ['/m/a']), pl('Gone', ['/m/a'], null)]));
    expect(rows.map((r) => markerFor(r, true).canReviewExport)).toEqual([false, false, true, true]);
    expect(markerFor(rows[1], true).label).toBe('Unclear');
    expect(markerFor(rows[0], false).canReviewExport).toBe(false);
  });
  it('duplicate names are unclear, not guessed', () => {
    const p = pl('X', ['/a'], ['/a']); p.entries.rekordbox = [...entry(['/a']), ...entry(['/b'])];
    expect(markerFor(buildRows(cov('read', [p]))[0], true).label).toBe('Unclear');
  });
  it('path compare ignores slash style only, and case-only differences are unclear', () => {
    expect(diffLists(['C:\\Music\\A.wav'], ['C:/Music/A.wav']).sameOrder).toBe(true);
    expect(diffLists(['/m/A.wav'], ['/m/a.wav']).sameOrder).toBe(false);
    expect(markerFor(buildRows(cov('read', [pl('C', ['/m/A.wav'], ['/m/a.wav'])]))[0], true).label).toBe('Unclear');
  });
});

describe('DesktopLibrary', () => {
  it('shows missing config as its own state', async () => {
    vi.spyOn(api.playlistSync, 'getCoverage').mockResolvedValue(cov('not_configured'));
    const h = await mount();
    expect(h.textContent).toContain('not set up');
    expect(h.textContent).not.toContain('Not in Rekordbox');
  });
  it('a failed read makes absence unknown', async () => {
    vi.spyOn(api.playlistSync, 'getCoverage').mockResolvedValue(cov('failed', [], 'OperationalError'));
    expect((await mount()).textContent).toContain('none are shown as missing');
  });
  it('lists playlists, missing first, and offers only a review of the export', async () => {
    vi.spyOn(api.playlistSync, 'getCoverage').mockResolvedValue(cov('read', [pl('Same', ['/a'], ['/a']), pl('Gone', ['/a'], null)]));
    const h = await mount();
    const items = [...h.querySelectorAll<HTMLButtonElement>('button.pg-pl')];
    expect(items[0].textContent).toContain('Gone');
    await act(async () => { items[0].click(); });
    expect(h.textContent).toContain('Review export');
    expect(h.textContent).not.toMatch(/Apply/);
    expect(h.textContent?.toLowerCase()).not.toContain('synced');
  });
  it('a duplicate-name playlist shows no table and no export', async () => {
    const p = pl('X', ['/a'], ['/a']); p.entries.rekordbox = [...entry(['/a']), ...entry(['/b'])];
    vi.spyOn(api.playlistSync, 'getCoverage').mockResolvedValue(cov('read', [p]));
    const h = await mount();
    await act(async () => { h.querySelector<HTMLButtonElement>('button.pg-pl')!.click(); });
    expect(h.querySelector('.pg-tracks')).toBeNull();
    expect(h.textContent).not.toContain('Review export');
    expect(h.textContent).toContain('1 playlist unclear');
  });
});
