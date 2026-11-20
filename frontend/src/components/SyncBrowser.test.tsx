// @vitest-environment jsdom
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import type { ExternalDrivePreview, ExternalDrivePreviewPlaylist } from '../api/client';
import { SyncBrowser, playlistTag, summarize, trackMarker } from './SyncBrowser';
import { classifyPlaylist } from './UnifiedSync';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

const member = (over: object = {}) => ({
  counterpart_status: 'unique-name-match' as const, counterpart_id: 7, target_token: 'tok', common: 2,
  adds_in_library: 0, adds_new: 0, removes: 0, removes_provisional: false, uncertain_members: 0, order_differs: false, ...over,
});
const pl = (over: Partial<ExternalDrivePreviewPlaylist> = {}): ExternalDrivePreviewPlaylist => ({
  id: 1, name: 'Warm Up', folder_path: '', track_count: 2, new_count: 0, present_count: 2, uncertain_count: 0,
  other_count: 0, folder_not_representable: false, track_ordinals: [0, 1], membership: member(), ...over,
});
const preview = (playlists: ExternalDrivePreviewPlaylist[], over: Partial<ExternalDrivePreview> = {}): ExternalDrivePreview => ({
  root: '/v/RB', kind: 'rekordbox', device_track_count: 2, new_count: 0, present_count: 2, uncertain_count: 0,
  duplicate_count: 0, missing_file_count: 0, default_destination: '/lib', fingerprint: 'fp', source_fingerprint: 's',
  entries: [], playlists, ...over,
});
const RB = { root: '/v/RB', kind: 'rekordbox' as const, name: 'RB', track_count: 2, written_by_manadj: false };
const EN = { root: '/v/EN', kind: 'engine' as const, name: 'EN', track_count: 5, written_by_manadj: false };
const tick = () => new Promise((r) => setTimeout(r, 10));

it('summarize counts what differs and lists the playlists to look at', () => {
  const s = summarize(preview([pl(), pl({ id: 2, name: 'Peak', membership: member({ order_differs: true }) }), pl({ id: 3, name: 'Odd', folder_path: 'RIG', folder_parts: ['RIG'], membership: member({ counterpart_status: 'candidate-name-match', counterpart_id: null, candidate_id: 9, candidate_name: 'Odd', order_differs: true }) })], { uncertain_count: 2, new_count: 1 }));
  expect(s).toMatchObject({ playlists: 3, match: 1, update: 1, look: 1, unverifiedTracks: 2, notInLibraryTracks: 1 });
  expect(s.attention.map((a) => a.name)).toEqual(['Peak', 'RIG > Odd']);
});

const ent = (ordinal: number, status: 'present' | 'new' | 'uncertain', title: string) => ({ ordinal, title, artist: 'A', bpm: 120, key: '8A', duration_secs: 200, device_path: `/x/${title}.mp3`, status, detail: null, matched_path: null });
const mount = async () => {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  await act(async () => { root.render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><SyncBrowser /></QueryClientProvider>); await tick(); await tick(); });
  return host;
};

it('lists every playlist and track with markers; selecting a playlist shows only its tracks', async () => {
  vi.spyOn(api.externalDrives, 'list').mockResolvedValue([RB]);
  vi.spyOn(api.externalDrives, 'preview').mockResolvedValue(preview(
    [pl({ track_ordinals: [0, 1] }), pl({ id: 2, name: 'Peak', track_ordinals: [2], track_count: 1, membership: member({ order_differs: true }) })],
    { entries: [ent(0, 'present', 'One'), ent(1, 'uncertain', 'Two'), ent(2, 'new', 'Three')], new_count: 1, uncertain_count: 1 }));
  vi.spyOn(api.externalDrives, 'check').mockResolvedValue({ kind: 'rekordbox', checked: true, tracks: 3, playlists: 2, analysis_files: 3, errors: [], error_count: 0 } as never);
  vi.spyOn(api.externalDrives, 'fields').mockResolvedValue({ fingerprint: 'f', tracks: [], compared: [], not_compared: {} });
  const host = await mount();
  const text = () => host.textContent ?? '';
  expect(text()).toContain('Warm Up'); expect(text()).toContain('Peak');
  expect(host.querySelector('[aria-label="Not in library"]')).not.toBeNull(); expect(text()).toContain('Unverified'); expect(text()).toContain('In library');
  expect(text()).toContain('1 track not in library'); expect(text()).toContain('1 track unverified');
  expect(text()).toContain('Not checked: cues, beatgrids, player load');
  expect(text()).toContain('Nothing chosen');
  expect(text()).toContain('Library to drive'); expect(text()).toContain('Not available yet');
  expect(text().toLowerCase()).not.toContain('healthy');
  await act(async () => { [...host.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Peak'))!.click(); });
  expect(host.querySelectorAll('.pg-tracks tbody tr').length).toBe(1);
  expect(text()).toContain('Three');
});

it('trackMarker never calls an uncertain track in sync', () => {
  expect(trackMarker(ent(0, 'uncertain', 'x')).tone).toBe('unknown');
  expect(trackMarker(ent(0, 'present', 'x')).label).toBe('In library');
});

it('a failed read stays unknown; no drives is stated; engine is labeled under construction', async () => {
  vi.spyOn(api.externalDrives, 'list').mockResolvedValue([EN]);
  vi.spyOn(api.externalDrives, 'preview').mockRejectedValue(new Error('boom'));
  const host = await mount();
  expect(host.textContent).toContain('under construction');
  expect(host.textContent).toContain('Could not read this drive (boom)');
  expect(host.textContent).toContain('Drive not read');
  expect(host.textContent).not.toContain('None found');
  document.body.innerHTML = '';
  vi.spyOn(api.externalDrives, 'list').mockResolvedValue([]);
  const h2 = await mount();
  expect(h2.textContent).toContain('No USB found');
});

it('an older read finishing late does not overwrite the newer one', async () => {
  vi.spyOn(api.externalDrives, 'list').mockResolvedValue([RB]);
  vi.spyOn(api.externalDrives, 'check').mockResolvedValue({ kind: 'rekordbox', checked: false, reason: 'x' } as never);
  vi.spyOn(api.externalDrives, 'fields').mockRejectedValue(new Error('x'));
  let first!: (p: ExternalDrivePreview) => void;
  const spy = vi.spyOn(api.externalDrives, 'preview')
    .mockImplementationOnce(() => new Promise((r) => { first = r; }))
    .mockResolvedValue(preview([pl({ name: 'Newer' })], { entries: [ent(0, 'present', 'N')] }));
  const host = await mount();
  await act(async () => { [...host.querySelectorAll('button')].find((b) => b.textContent === 'Recheck')!.click(); await tick(); });
  await act(async () => { first(preview([pl({ name: 'Older' })])); await tick(); });
  expect(spy).toHaveBeenCalledTimes(2);
  expect(host.textContent).toContain('Newer'); expect(host.textContent).not.toContain('Older');
});

it('a failed field comparison reads as unknown and a short playlist list as incomplete', async () => {
  vi.spyOn(api.externalDrives, 'list').mockResolvedValue([RB]);
  vi.spyOn(api.externalDrives, 'preview').mockResolvedValue(preview([pl({ track_count: 3, track_ordinals: [0] })], { entries: [ent(0, 'present', 'One')] }));
  vi.spyOn(api.externalDrives, 'check').mockResolvedValue({ kind: 'rekordbox', checked: false, reason: 'x' } as never);
  vi.spyOn(api.externalDrives, 'fields').mockRejectedValue(new Error('x'));
  const host = await mount();
  expect(host.textContent).toContain('Detail differences unknown');
  expect(host.textContent).toContain('1 playlist list incomplete');
  expect(host.textContent).not.toContain('None found');
});

const btn = (host: HTMLElement, text: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === text);
const click = async (host: HTMLElement, text: string) => { await act(async () => { btn(host, text)!.click(); await tick(); }); };
const DONE = { root: '/v/RB', kind: 'rekordbox', destination: '/lib', imported: 1, skipped_present: 0, skipped_uncertain: 0, skipped_duplicate: 0, skipped_missing_file: 0, skipped_unselected: 0, errors: [], track_ids: [1] };
const noCheck = () => vi.spyOn(api.externalDrives, 'check').mockResolvedValue({ kind: 'rekordbox', checked: false, reason: 'x' } as never);
const copyPl = pl({ id: 2, name: 'New Set', track_ordinals: [2], track_count: 1, new_count: 1, membership: member({ counterpart_status: 'no-local-playlist', counterpart_id: null, target_token: null }) });
const updPl = pl({ id: 3, name: 'Peak', membership: member({ order_differs: true, counterpart_id: 9, target_token: 't9' }) });
const withNew = preview([copyPl, updPl], { entries: [ent(0, 'present', 'One'), ent(1, 'present', 'Two'), ent(2, 'new', 'Fresh')], new_count: 1 });

it('playlist tags are short; the long reason is only the tooltip', () => {
  expect(playlistTag(classifyPlaylist(copyPl, true))).toEqual({ tone: 'work', label: 'Not in library' });
  expect(playlistTag(classifyPlaylist(updPl, true)).label).toBe('Differs');
  expect(playlistTag(classifyPlaylist(pl(), true)).label).toBe('Matches');
});

it('chooses whole-playlist actions, applies once with a recheck per item, nothing is written when choosing', async () => {
  vi.spyOn(api.externalDrives, 'list').mockResolvedValue([RB]);
  noCheck(); vi.spyOn(api.externalDrives, 'fields').mockResolvedValue({ fingerprint: 'f', tracks: [], compared: [], not_compared: {} });
  const previewSpy = vi.spyOn(api.externalDrives, 'preview').mockResolvedValue(withNew);
  const importSpy = vi.spyOn(api.externalDrives, 'import').mockResolvedValue(DONE as never);
  const host = await mount();
  const dot = (name: string) => [...host.querySelectorAll('.pg-pl')].find((b) => b.textContent?.startsWith(name))!;
  await act(async () => { (dot('New Set') as HTMLElement).click(); await tick(); });
  await click(host, 'Plan whole playlist');
  await act(async () => { (dot('Peak') as HTMLElement).click(); await tick(); });
  await click(host, 'Plan playlist update');
  expect(importSpy).not.toHaveBeenCalled();
  expect(host.querySelector('.pg-right')!.textContent).toContain('Plan (2)');
  const calls = previewSpy.mock.calls.length;
  await click(host, 'Review 2 planned operations'); await click(host, 'Confirm and apply plan');
  await act(async () => { await tick(); });
  expect(previewSpy.mock.calls.length).toBeGreaterThanOrEqual(calls + 2);
  expect(importSpy).toHaveBeenCalledTimes(2);
  expect(importSpy.mock.calls[0][0]).toMatchObject({ create_playlist_id: 2, preview_fingerprint: 'fp' });
  expect(importSpy.mock.calls[1][0]).toMatchObject({ update_playlist_id: 9, update_target_token: 't9' });
  expect(host.querySelector('[role="status"]')?.textContent).toContain('New Set');
});

it('an item whose playlist changed since it was chosen is held, nothing imported', async () => {
  vi.spyOn(api.externalDrives, 'list').mockResolvedValue([RB]); noCheck();
  vi.spyOn(api.externalDrives, 'fields').mockResolvedValue({ fingerprint: 'f', tracks: [], compared: [], not_compared: {} });
  const previewSpy = vi.spyOn(api.externalDrives, 'preview').mockResolvedValue(preview([updPl]));
  const importSpy = vi.spyOn(api.externalDrives, 'import');
  const host = await mount();
  await act(async () => { ([...host.querySelectorAll('.pg-pl')].find((b) => b.textContent?.startsWith('Peak')) as HTMLElement).click(); await tick(); });
  await click(host, 'Plan playlist update');
  previewSpy.mockResolvedValue(preview([{ ...updPl, track_ordinals: [1, 0] }]));
  await click(host, 'Review 1 planned operation'); await click(host, 'Confirm and apply plan'); await act(async () => { await tick(); });
  expect(importSpy).not.toHaveBeenCalled();
  expect(host.querySelector('.res-held')?.textContent).toContain('Changed since you queued it');
});

const cmp = (lib: string = 'One (old)') => ({ fingerprint: 'ffp', compared: ['title', 'bpm'], not_compared: {}, tracks: [{ ordinal: 0, track_id: 5, label: 'A - One', fields: [
  { field: 'title', drive: 'One', library: lib, applicable: true }, { field: 'bpm', drive: 128, library: 127, applicable: false }] }] });

it('detail choices: only an explicit take enters the plan, BPM never does, applied library-only with a recheck', async () => {
  vi.spyOn(api.externalDrives, 'list').mockResolvedValue([RB]); noCheck();
  vi.spyOn(api.externalDrives, 'preview').mockResolvedValue(preview([pl()], { entries: [ent(0, 'present', 'One'), ent(1, 'present', 'Two')] }));
  const fieldsSpy = vi.spyOn(api.externalDrives, 'fields').mockResolvedValue(cmp());
  const applySpy = vi.spyOn(api.externalDrives, 'applyFields').mockResolvedValue({ applied: [{ track_id: 5, field: 'title', value: 'One' }] });
  const host = await mount();
  expect(host.textContent).toContain('1 detail to decide');
  expect(host.querySelector('.pg-right')!.textContent).toContain('Nothing chosen');
  await click(host, '2 fields▾');
  await click(host, 'Keep Library');
  expect(host.querySelector('.pg-right')!.textContent).toContain('Nothing chosen');
  await click(host, "Use USB");
  expect(host.querySelector('.pg-right')!.textContent).toContain('Plan (1)');
  expect(host.querySelector('.pg-right')!.textContent).toContain('TitleOne (old)→ One');
  expect(host.querySelector('.pg-right')!.textContent).not.toContain('bpm');
  expect(applySpy).not.toHaveBeenCalled();
  await click(host, 'Review 1 planned operation'); await click(host, 'Confirm and apply plan'); await act(async () => { await tick(); });
  expect(fieldsSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
  expect(applySpy).toHaveBeenCalledWith('/v/RB', 'ffp', [{ track_id: 5, field: 'title', drive: 'One', library: 'One (old)' }]);
  expect(host.querySelector('[role="status"]')?.textContent).toContain('The drive was not changed');
});

it('a detail choice does not carry over when the library value changed after a recheck', async () => {
  vi.spyOn(api.externalDrives, 'list').mockResolvedValue([RB]); noCheck();
  vi.spyOn(api.externalDrives, 'preview').mockResolvedValue(preview([pl()], { entries: [ent(0, 'present', 'One'), ent(1, 'present', 'Two')] }));
  const fieldsSpy = vi.spyOn(api.externalDrives, 'fields').mockResolvedValue(cmp());
  const host = await mount();
  await click(host, '2 fields▾');
  await click(host, "Use USB");
  expect(host.querySelector('.pg-right')!.textContent).toContain('Plan (1)');
  fieldsSpy.mockResolvedValue(cmp('Changed elsewhere'));
  await click(host, 'Recheck'); await act(async () => { await tick(); });
  expect(host.querySelector('.pg-right')!.textContent).not.toContain('Plan (1)');
  expect(host.textContent).toContain('1 choice changed since you made them');
});

it('the plan is kept per drive across switching drives and is never applied to the other drive', async () => {
  const RB2 = { ...RB, root: '/v/RB2', name: 'RB2' };
  vi.spyOn(api.externalDrives, 'list').mockResolvedValue([RB, RB2]); noCheck();
  vi.spyOn(api.externalDrives, 'fields').mockResolvedValue({ fingerprint: 'f', tracks: [], compared: [], not_compared: {} });
  const previewSpy = vi.spyOn(api.externalDrives, 'preview').mockImplementation(async (r: string) => ({ ...withNew, root: r }));
  const importSpy = vi.spyOn(api.externalDrives, 'import').mockResolvedValue(DONE as never);
  const host = await mount();
  await act(async () => { ([...host.querySelectorAll('.pg-pl')].find((b) => b.textContent?.startsWith('New Set')) as HTMLElement).click(); await tick(); });
  await click(host, 'Plan whole playlist');
  await click(host, 'RB2'); await act(async () => { await tick(); });
  expect(host.querySelector('.pg-right')!.textContent).toContain('Nothing chosen');
  expect(host.querySelector('.pg-right')!.textContent).toContain('1 more planned on RB');
  expect(btn(host, 'Apply 1')).toBeUndefined();
  await click(host, '1 more planned on RB');
  expect(host.querySelector('.pg-right')!.textContent).toContain('Plan (1)');
  previewSpy.mockClear();
  await click(host, 'Review 1 planned operation'); await click(host, 'Confirm and apply plan'); await act(async () => { await tick(); });
  expect(previewSpy.mock.calls.every((c) => c[0] === '/v/RB')).toBe(true);
  expect(importSpy.mock.calls[0][0]).toMatchObject({ root: '/v/RB' });
});

it('All tracks lists what is missing first; a playlist keeps its drive order', async () => {
  vi.spyOn(api.externalDrives, 'list').mockResolvedValue([RB]); noCheck();
  vi.spyOn(api.externalDrives, 'fields').mockResolvedValue({ fingerprint: 'f', tracks: [], compared: [], not_compared: {} });
  vi.spyOn(api.externalDrives, 'preview').mockResolvedValue(preview([pl({ track_ordinals: [0, 1, 2], track_count: 3 })], { entries: [ent(0, 'present', 'Aaa'), ent(1, 'uncertain', 'Bbb'), ent(2, 'new', 'Ccc')], new_count: 1, uncertain_count: 1 }));
  const host = await mount();
  const titles = () => [...host.querySelectorAll('.pg-tracks tbody tr:not(.pg-diff):not(.pg-context) td:nth-child(2) .pg-title-text')].map((t) => t.textContent);
  expect(titles()).toEqual(['Ccc', 'Bbb', 'Aaa']);
  await act(async () => { ([...host.querySelectorAll('.pg-pl')].find((b) => b.textContent?.startsWith('Warm Up')) as HTMLElement).click(); await tick(); });
  expect(titles()).toEqual(['Aaa', 'Bbb', 'Ccc']);
  await click(host, 'Issues only');
  expect(titles()).toEqual(['Bbb', 'Ccc']);
});

it('conflicted details show their real reason, and choices are locked while Apply runs', async () => {
  vi.spyOn(api.externalDrives, 'list').mockResolvedValue([RB]); noCheck();
  vi.spyOn(api.externalDrives, 'preview').mockResolvedValue(preview([pl()], { entries: [ent(0, 'present', 'One'), ent(1, 'present', 'Two')] }));
  const c = cmp();
  c.tracks[0].fields.push({ field: 'key', drive: 'F', library: 'Am', applicable: false, conflict: 'Two drive tracks disagree' } as never);
  vi.spyOn(api.externalDrives, 'fields').mockResolvedValue(c);
  let release!: () => void;
  vi.spyOn(api.externalDrives, 'applyFields').mockImplementation(() => new Promise((r) => { release = () => r({ applied: [] }); }));
  const host = await mount();
  expect(host.querySelector('.pg-diff-toggle')?.getAttribute('title')).toContain('Two drive tracks disagree');
  await click(host, '3 fields▾');
  await click(host, "Use USB");
  await click(host, 'Review 1 planned operation'); await click(host, 'Confirm and apply plan');
  expect(btn(host, 'Keep Library')!.disabled).toBe(true);
  expect(btn(host, "Planned ✓")!.disabled).toBe(true);
  await act(async () => { release(); await tick(); });
  expect(btn(host, 'Applying…')).toBeUndefined();
});

it('Rekordbox desktop is a separate source from removable drives', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({source:'rekordbox',status:'not_configured',tracks:[]})));
  vi.spyOn(api.externalDrives, 'list').mockResolvedValue([RB]);
  vi.spyOn(api.externalDrives, 'preview').mockResolvedValue(preview([], {}) as never);
  vi.spyOn(api.externalDrives, 'check').mockResolvedValue({ kind: 'rekordbox', checked: false, reason: 'x' } as never);
  vi.spyOn(api.externalDrives, 'fields').mockRejectedValue(new Error('x'));
  vi.spyOn(api.playlistSync, 'getCoverage').mockResolvedValue({ sources: { manadj: { status: 'read', reason: null, read_at: '2026-11-19T18:00:00Z', playlist_count: 0 }, engine: { status: 'not_configured', reason: null, read_at: '', playlist_count: 0 }, rekordbox: { status: 'not_configured', reason: null, read_at: '', playlist_count: 0 } }, playlists: [] });
  const host = document.createElement('div'); document.body.append(host);
  await act(async () => { createRoot(host).render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><SyncBrowser /></QueryClientProvider>); });
  await act(async () => {});
  await act(async () => { [...host.querySelectorAll('button')].find((b) => b.textContent === 'Rekordbox desktop')!.click(); });
  await act(async () => { await tick(); await tick(); });
  expect(host.textContent).toContain('not configured');
  expect(host.querySelector('[aria-label^="USB"]')).toBeNull();
});


it('playlist rows start compact and reveal the full compared diff without choosing a write', async () => {
  vi.spyOn(api.externalDrives, 'list').mockResolvedValue([RB]); noCheck();
  vi.spyOn(api.externalDrives, 'preview').mockResolvedValue(preview([pl()], { entries: [ent(0, 'present', '001 Ascension'), ent(1, 'new', 'Different copy')] }));
  vi.spyOn(api.externalDrives, 'fields').mockResolvedValue(cmp('Ascension'));
  const applySpy = vi.spyOn(api.externalDrives, 'applyFields');
  const host = await mount();
  await act(async () => { (host.querySelector('.pg-pl') as HTMLElement).click(); });
  expect(host.querySelectorAll('.pg-diff')).toHaveLength(0);
  const toggle = host.querySelector<HTMLButtonElement>('[aria-label="Differences for 001 Ascension"]')!;
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  await act(async () => toggle.click());
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(host.querySelectorAll('.pg-diff')).toHaveLength(2);
  expect(host.textContent).toContain('Read only · analysis');
  expect(host.textContent).toContain('Match needed');
  expect(host.querySelector('.pg-right')!.textContent).toContain('Nothing chosen');
  expect(applySpy).not.toHaveBeenCalled();
  await act(async () => toggle.click());
  expect(host.querySelectorAll('.pg-diff')).toHaveLength(0);
});

const setupRows = () => {
  vi.spyOn(api.externalDrives, 'list').mockResolvedValue([RB]); noCheck();
  vi.spyOn(api.externalDrives, 'preview').mockResolvedValue(preview([pl({ track_ordinals: [0, 1, 2] })], { entries: [ent(0, 'new', 'New'), ent(1, 'uncertain', 'Uncertain'), ent(2, 'present', 'Existing')], new_count: 1 }));
  vi.spyOn(api.externalDrives, 'fields').mockResolvedValue({ fingerprint: 'f', tracks: [], compared: [], not_compared: {} });
};
it('checkbox selection stays separate from expansion; mixed top actions stage only eligible selected audio', async () => {
  setupRows(); const imports = vi.spyOn(api.externalDrives, 'import').mockResolvedValue({ imported: 1 } as never);
  const host = await mount();
  const checkbox = (name: string) => host.querySelector<HTMLInputElement>(`input[aria-label="Select ${name}"]`)!;
  await act(async () => { checkbox('New').click(); checkbox('Uncertain').click(); });
  expect(host.querySelector('.pg-context')).toBeNull();
  expect(host.querySelector('.pg-selected-actions')!.textContent).toContain('2 selected1 importable · 1 excluded');
  await click(host, 'Plan imports');
  expect(imports).not.toHaveBeenCalled();
  expect(host.querySelector('.pg-right')!.textContent).toContain('Import New');
  expect(host.querySelector('.pg-right')!.textContent).not.toContain('Import Uncertain');
  await click(host, 'Review 1 planned operation');
  expect(imports).not.toHaveBeenCalled();
  await click(host, 'Confirm and apply plan');
  expect(imports.mock.calls[0][0]).toMatchObject({ ordinals: [0] });
});
it('hover and keyboard focus preview Library results without staging or writing', async () => {
  setupRows(); vi.spyOn(api.externalDrives, 'preview').mockResolvedValue(preview([pl()], { entries: [ent(0, 'present', 'One')] }));
  vi.spyOn(api.externalDrives, 'fields').mockResolvedValue(cmp());
  const writes = vi.spyOn(api.externalDrives, 'applyFields'); const host = await mount();
  await click(host, '2 fields▾'); const action = btn(host, 'Use USB')!;
  await act(async () => { action.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); });
  expect(host.querySelector('.pg-result-preview')!.textContent).toContain('Library result One');
  expect(host.querySelector('.pg-right')!.textContent).toContain('Nothing chosen');
  await act(async () => { action.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })); });
  expect(host.querySelector('.pg-result-preview')).toBeNull();
  await act(async () => { action.focus(); });
  expect(host.querySelector('.pg-result-preview')).not.toBeNull();
  expect(writes).not.toHaveBeenCalled();
  await act(async () => { action.blur(); }); expect(host.querySelector('.pg-result-preview')).toBeNull();
});
it('review gate invalidates when a planned field is removed', async () => {
  setupRows(); vi.spyOn(api.externalDrives, 'preview').mockResolvedValue(preview([pl()], { entries: [ent(0, 'present', 'One')] }));
  vi.spyOn(api.externalDrives, 'fields').mockResolvedValue(cmp());
  const host = await mount(); await click(host, '2 fields▾'); await click(host, 'Use USB');
  await click(host, 'Review 1 planned operation'); expect(host.querySelector('[aria-label="Confirm reviewed plan"]')).not.toBeNull();
  await click(host, 'Remove this field'); expect(host.querySelector('[aria-label="Confirm reviewed plan"]')).toBeNull();
});
it('individually staged audio imports survive the first item changing from new to present', async () => {
  setupRows();
  const a = ent(0, 'new', 'A'), b = ent(1, 'new', 'B'); let completed = false;
  vi.spyOn(api.externalDrives, 'preview').mockImplementation(async () => preview([pl()], { entries: [completed ? { ...a, status: 'present' } : a, b], new_count: completed ? 1 : 2 }));
  const imports = vi.spyOn(api.externalDrives, 'import').mockImplementation(async () => { completed = true; return { imported: 1 } as never; });
  const host = await mount();
  const actions = [...host.querySelectorAll<HTMLButtonElement>('.pg-row-action')];
  await act(async () => { actions[0].click(); }); await act(async () => { actions[1].click(); });
  await click(host, 'Review 2 planned operations'); await click(host, 'Confirm and apply plan');
  expect(imports.mock.calls.map(call => call[0].ordinals)).toEqual([[0], [1]]);
});

it.each(['success', 'error', 'removed'] as const)('USB throbber tracks a pending read and stops on %s', async (outcome) => {
  const list = vi.spyOn(api.externalDrives, 'list').mockResolvedValue([RB]);
  noCheck();
  vi.spyOn(api.externalDrives, 'fields').mockResolvedValue({ fingerprint: 'f', tracks: [], compared: [], not_compared: {} });
  let resolve!: (p: ExternalDrivePreview) => void;
  let reject!: (e: Error) => void;
  vi.spyOn(api.externalDrives, 'preview').mockImplementation(() => new Promise((yes, no) => { resolve = yes; reject = no; }));
  const host = await mount();
  expect(host.querySelector('.pg-read-spinner')?.getAttribute('aria-hidden')).toBe('true');
  expect(host.querySelector('.pg-browser')?.getAttribute('aria-busy')).toBe('true');
  expect(host.querySelector('[role="status"]')?.textContent).toBe('Reading RB USB…');
  if (outcome === 'removed') {
    list.mockResolvedValue([]);
    await click(host, 'Detect drives');
    // A late response must not bring back a removed USB's loading UI.
    await act(async () => { resolve(preview([])); await tick(); });
  } else {
    await act(async () => { if (outcome === 'success') resolve(preview([])); else reject(new Error('unplugged')); await tick(); });
  }
  expect(host.querySelector('.pg-read-spinner')).toBeNull();
  expect(host.querySelector('.pg-browser')?.getAttribute('aria-busy')).not.toBe('true');
  if (outcome === 'error') expect(host.querySelector('[role="alert"]')?.textContent).toContain('unplugged');
});

it('uses Library waveform identity only for confirmed present audio and keeps title disclosure separate', async () => {
  vi.spyOn(api.externalDrives, 'list').mockResolvedValue([RB]); noCheck();
  vi.spyOn(api.externalDrives, 'fields').mockResolvedValue({ fingerprint: 'f', tracks: [], compared: [], not_compared: {} });
  const waveform = vi.spyOn(api.waveforms, 'getPreview').mockResolvedValue(null);
  const long = 'A very long title '.repeat(8);
  vi.spyOn(api.externalDrives, 'preview').mockResolvedValue(preview([], { entries: [
    { ...ent(0, 'present', long), matched_track_id: 42 },
    { ...ent(1, 'new', 'Unverified copy'), matched_track_id: 999, candidates: [{ track_id: 777 }] },
  ] as never }));
  const host = await mount();
  expect(waveform.mock.calls.map(call => call[0])).toEqual([42]);
  expect(host.querySelector('.pg-track-name')).toBeNull();
  const title = [...host.querySelectorAll<HTMLElement>('.pg-title-text')].find(el => el.textContent === long)!;
  expect(title.title).toBe(long); // no destructive truncation of the actual value
  expect(host.querySelector('.pg-context')).toBeNull();
  await act(async () => { host.querySelector<HTMLButtonElement>(`[aria-label="Details for ${long}"]`)!.click(); });
  expect(host.querySelector('.pg-context')).not.toBeNull();
  expect(host.querySelector('.pg-title-text')?.closest('tr')?.querySelector('details')).toBeNull();
  expect(host.textContent).toContain('Nothing chosen');
});

it('marks title divergence neutrally and reveals it only in the shared track expansion', async () => {
  vi.spyOn(api.externalDrives, 'list').mockResolvedValue([RB]); noCheck();
  vi.spyOn(api.externalDrives, 'preview').mockResolvedValue(preview([], { entries: [ent(0, 'present', 'USB title')] }));
  vi.spyOn(api.externalDrives, 'fields').mockResolvedValue({ fingerprint: 'f', compared: ['title'], not_compared: {}, tracks: [{ ordinal: 0, track_id: 42, label: 'USB title', fields: [{ field: 'title', drive: 'USB title', library: 'Library title', applicable: true }] }] } as never);
  const host = await mount();
  const marker = host.querySelector('.pg-title-divergence svg')!;
  expect(marker.getAttribute('aria-label')).toContain('newer source unknown');
  expect(marker.getAttribute('data-newer')).toBe('unknown');
  expect(host.querySelector('.pg-track-title details')).toBeNull();
  expect(host.querySelector('.pg-context')).toBeNull();
  await act(async () => { host.querySelector<HTMLButtonElement>('[aria-label="Details for USB title"]')!.click(); });
  expect(host.querySelectorAll('.pg-context')).toHaveLength(1);
  expect(host.querySelectorAll('.pg-diff')).toHaveLength(1);
  expect(host.querySelector('.pg-diff')?.textContent).toContain('Library title');
  expect(host.querySelector('.pg-track-facts')?.textContent).toContain('USB:');
  await act(async () => { host.querySelector<HTMLButtonElement>('[aria-label="Differences for USB title"]')!.click(); });
  expect(host.querySelector('.pg-context')).toBeNull();
  expect(host.textContent).toContain('Nothing chosen');
});

const similarFixture = () => {
  vi.spyOn(api.externalDrives, 'list').mockResolvedValue([RB]); noCheck();
  vi.spyOn(api.externalDrives, 'preview').mockResolvedValue(preview([pl({ track_count: 4, track_ordinals: [0, 1, 2, 4] })], {
    entries: [ent(0, 'present', 'Seed'), ent(1, 'present', 'Eligible'), ent(2, 'uncertain', 'Unverified'), ent(3, 'present', 'Outside'), ent(4, 'present', 'Conflict')],
  }));
  const data = { fingerprint: 'similar', compared: ['title', 'bpm'], not_compared: {}, tracks: [0, 1, 2, 3, 4].map(ordinal => ({
    ordinal, track_id: 10 + ordinal, label: ['Seed', 'Eligible', 'Unverified', 'Outside', 'Conflict'][ordinal], fields: [
      { field: 'title', drive: `USB ${ordinal}`, library: `Library ${ordinal}`, applicable: ordinal !== 4 },
      { field: 'bpm', drive: 128, library: 127, applicable: false },
    ],
  })) };
  const fieldsSpy = vi.spyOn(api.externalDrives, 'fields').mockResolvedValue(data);
  const applySpy = vi.spyOn(api.externalDrives, 'applyFields').mockResolvedValue({ applied: [] });
  return { data, fieldsSpy, applySpy };
};
const chooseSeed = async (host: HTMLElement, choice = 'Use USB') => {
  await act(async () => { host.querySelector<HTMLButtonElement>('[aria-label="Details for Seed"]')!.click(); });
  await click(host, choice);
};

it('Apply to similar previews same-field undecided exact audio in this playlist, then stages without applying', async () => {
  const { applySpy } = similarFixture();
  const host = await mount();
  await chooseSeed(host);
  expect(btn(host, 'Apply to similar…')).toBeUndefined(); // Never whole-library scope.
  await act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent?.startsWith('Warm Up'))!.click(); });
  await click(host, 'Apply to similar…');
  const review = host.querySelector('[aria-label="Review similar choices"]')!;
  expect(review.textContent).toContain('1 additional track');
  expect(review.textContent).toContain('Eligible');
  expect(review.textContent).toContain('Library: Library 1');
  expect(review.textContent).toContain('USB: USB 1');
  expect(review.textContent).not.toContain('Outside');
  expect(review.textContent).not.toContain('Unverified');
  expect(review.textContent).not.toContain('Conflict');
  expect(host.querySelector('.pg-right')!.textContent).not.toContain('USB 1');
  await click(host, 'Add these choices to plan');
  expect(host.querySelector('[aria-label="Review similar choices"]')).toBeNull();
  const plan = host.querySelector('.pg-right')!.textContent!;
  expect(plan).toContain('USB 0'); expect(plan).toContain('USB 1');
  expect(plan).not.toContain('USB 2'); expect(plan).not.toContain('USB 3'); expect(plan).not.toContain('USB 4');
  expect(host.querySelector('.pg-plan-tracks')!.textContent).not.toContain('BPM');
  expect(applySpy).not.toHaveBeenCalled();
  await click(host, 'Review 1 planned operation');
  expect(applySpy).not.toHaveBeenCalled();
  await click(host, 'Confirm and apply plan'); await act(async () => { await tick(); });
  expect(applySpy).toHaveBeenCalledWith('/v/RB', 'similar', [
    { track_id: 10, field: 'title', drive: 'USB 0', library: 'Library 0' },
    { track_id: 11, field: 'title', drive: 'USB 1', library: 'Library 1' },
  ]);

});

it('Apply to similar preserves explicit opposite choices and cancellation stages nothing', async () => {
  similarFixture();
  const host = await mount();
  await act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent?.startsWith('Warm Up'))!.click(); });
  await chooseSeed(host);
  await click(host, 'Apply to similar…'); await click(host, 'Cancel');
  expect(host.querySelector('.pg-right')!.textContent).not.toContain('USB 1');
  await act(async () => { host.querySelector<HTMLButtonElement>('[aria-label="Details for Eligible"]')!.click(); });
  const fieldRow = [...host.querySelectorAll('.pg-diff')].find(row => row.textContent?.startsWith('Title') && row.textContent?.includes('Library 1'))!;
  await act(async () => { [...fieldRow.querySelectorAll('button')].find(b => b.textContent === 'Keep Library')!.click(); });
  expect(btn(host, 'Apply to similar…')).toBeUndefined();
  expect(host.querySelector('.pg-right')!.textContent).not.toContain('USB 1');
});

it('Apply to similar Keep Library marks only those fields decided without queuing writes', async () => {
  const { applySpy } = similarFixture();
  const host = await mount();
  await act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent?.startsWith('Warm Up'))!.click(); });
  await chooseSeed(host, 'Keep Library');
  await click(host, 'Apply to similar…');
  expect(host.querySelector('[aria-label="Review similar choices"]')!.textContent).toContain('Keep Library value: Library 1');
  await click(host, 'Keep Library for these tracks');
  expect(host.querySelector('.pg-right')!.textContent).toContain('Nothing chosen');
  await act(async () => { host.querySelector<HTMLButtonElement>('[aria-label="Details for Eligible"]')!.click(); });
  const row = [...host.querySelectorAll('.pg-diff')].find(r => r.textContent?.startsWith('Title') && r.textContent?.includes('Library 1'))!;
  expect([...row.querySelectorAll('button')].find(b => b.textContent === 'Keep Library')!.getAttribute('aria-pressed')).toBe('true');
  expect(applySpy).not.toHaveBeenCalled();
});

it('rechecking or switching playlist invalidates the similar preview rather than carrying stale values', async () => {
  const { fieldsSpy, data } = similarFixture();
  const host = await mount();
  await act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent?.startsWith('Warm Up'))!.click(); });
  await chooseSeed(host); await click(host, 'Apply to similar…');
  fieldsSpy.mockResolvedValue({ ...data, tracks: data.tracks.map(t => ({ ...t, fields: t.fields.map(f => ({ ...f, library: 'Changed' })) })) });
  await click(host, 'Recheck'); await act(async () => { await tick(); });
  expect(host.querySelector('[aria-label="Review similar choices"]')).toBeNull();
  expect(host.querySelector('.pg-right')!.textContent).toContain('Nothing chosen');
  await click(host, 'Use USB'); await click(host, 'Apply to similar…');
  await act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent?.startsWith('All tracks'))!.click(); });
  expect(host.querySelector('[aria-label="Review similar choices"]')).toBeNull();
});
