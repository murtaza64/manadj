// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import { fieldReview, FieldRequestError, type FieldContext, type FieldPlan, type FieldReceipt } from '../api/fieldReview';
import { openSyncWorkspace, setSyncWorkspaceBusy, takeSyncWorkspace } from '../sync/openWorkspace';
import { SyncView } from './SyncView';
import { FieldReviewEntry } from './FieldReviewInspector';
import { PlaylistExportEntry } from './PlaylistExportInspector';
import { exportPlanFixture, exportReportFixture } from '../test/playlistExportFixtures';
import type { Track } from '../types';

vi.mock('./acquisition/useAcquisitionAvailable', () => ({ useAcquisitionAvailable: () => false }));
vi.mock('./UnifiedTracksSync', () => ({ UnifiedTracksSync: () => <p>Tracks inbox</p> }));
vi.mock('./PlaylistSync', () => ({ PlaylistSync: () => <p>Playlist inbox</p> }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, client: QueryClient;
const tick = () => new Promise(resolve => setTimeout(resolve, 10));
const tracks = [1, 2, 3].map(id => ({ id, title: `Track ${id}`, artist: 'Fixture', filename: `/fixture/${id}.flac`, key: id, tags: [] } as unknown as Track));
function button(text: string) { return [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === text)!; }
async function choose(label: string, value: string) {
  await act(async () => { const select = document.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!; select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); await tick(); });
}
function plan(context: FieldContext): FieldPlan {
  return { ...context, token: 'fixture-token', destination: '/fixture/engine', executable: !context.track_ids.includes(3), warnings: [], tracks: context.track_ids.map(id => ({ track_id: id, title: `Track ${id}`, filename: `/fixture/${id}.flac`, fields: context.fields.map(field => ({ field, before: 1, after: id, before_known: true, action: id === 3 ? 'blocked' : 'consent', reason: 'Fixture observation' })) })) };
}
beforeEach(() => {
  takeSyncWorkspace(); setSyncWorkspaceBusy(false);
  vi.spyOn(api.tracks, 'list').mockResolvedValue({ items: tracks, total: 3 });
  vi.spyOn(api.playlists, 'list').mockResolvedValue([{ id: 7, name: 'Night Shift' }]);
  vi.spyOn(api.playlists, 'get').mockResolvedValue({ id: 7, name: 'Night Shift', tracks });
  vi.spyOn(fieldReview, 'plan').mockImplementation(async context => plan(context));
});
afterEach(() => { if (root) act(() => root.unmount()); client?.clear(); setSyncWorkspaceBusy(false); takeSyncWorkspace(); vi.restoreAllMocks(); document.body.innerHTML = ''; });
async function render() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(['app-config'], { export_enabled: true });
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => { root.render(<QueryClientProvider client={client}><FieldReviewEntry scopes={{ selected: async () => [2] }} initialFields={['key']} /><PlaylistExportEntry playlistName="Night Shift" /><SyncView /></QueryClientProvider>); await tick(); });
  await act(async () => { await tick(); });
}

it('opens captured Library context in actual Sync workspace, not another Library modal', async () => {
  await render();
  await act(async () => { button('Review fields…').click(); await tick(); });
  expect(document.querySelector('.sync-view-tab.active')?.textContent).toBe('Workspace');
  expect(document.querySelector('[role=dialog]')).toBeNull();
  expect(document.querySelector('[aria-label="Review scope"]')?.textContent).toContain('Captured selected · 1 tracks');
  await act(async () => { button('Recheck plan').click(); await tick(); });
  expect(fieldReview.plan).toHaveBeenLastCalledWith({ track_ids: [2], scope: 'selected', surface: 'engine', direction: 'export', fields: ['key'] });
  expect(button('USB · unavailable').disabled).toBe(true);
  expect([...document.querySelectorAll('a')].map(link => link.getAttribute('href'))).toContain('?view=settings&section=phone-sync');
  expect(document.querySelector('.Library')).toBeNull();
});

it('clears stale plan/consent on target/scope changes and refuses incomplete implicit scopes', async () => {
  await render();
  await act(async () => { button('Review fields…').click(); await tick(); });
  await act(async () => { button('Recheck plan').click(); await tick(); });
  await act(async () => { document.querySelector<HTMLInputElement>('.field-replacement input')!.click(); await tick(); });
  expect(button('Apply 1 fields').disabled).toBe(false);
  await choose('Review scope', 'all');
  expect(button('Apply 0 fields').disabled).toBe(true);
  expect(document.querySelector('.field-replacement')).toBeNull();
  await act(async () => { client.setQueryData(['tracks', 'sync-workspace'], { items: tracks, total: 9 }); await tick(); });
  const calls = vi.mocked(fieldReview.plan).mock.calls.length;
  await act(async () => { button('Recheck plan').click(); await tick(); });
  expect(document.body.textContent).toContain('Library scope is incomplete');
  expect(fieldReview.plan).toHaveBeenCalledTimes(calls);
});

it('locks captured context while pending, excludes duplicate apply and preserves unknown receipt', async () => {
  let reject!: (error: Error) => void;
  const execute = vi.spyOn(fieldReview, 'execute').mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
  await render();
  await act(async () => { button('Review fields…').click(); await tick(); });
  await act(async () => { button('Recheck plan').click(); await tick(); });
  await act(async () => { document.querySelector<HTMLInputElement>('.field-replacement input')!.click(); await tick(); });
  await act(async () => { button('Apply 1 fields').click(); button('Apply 1 fields').click(); await tick(); });
  expect(execute).toHaveBeenCalledTimes(1);
  expect(button('Rekordbox desktop').matches(':disabled')).toBe(true);
  expect([...document.querySelectorAll<HTMLButtonElement>('.sync-view-tab')].every(tab => tab.disabled)).toBe(true);
  expect(document.activeElement?.hasAttribute('data-review-panel')).toBe(true);
  expect(openSyncWorkspace({ kind: 'playlist', playlistName: 'Other' })).toBe(false);
  act(() => document.querySelector<HTMLTableRowElement>('[data-track-id="1"]')!.click());
  expect(execute.mock.calls[0][0].track_ids).toEqual([2]);
  await act(async () => { reject(new FieldRequestError('Lost receipt', 'unknown')); await tick(); });
  expect(document.body.textContent).toContain('Outcome unknown');
  expect(button('Inspect destination, then recheck')).toBeTruthy();
});

it('routes the playlist entry to a target/scope-bound embedded inspector', async () => {
  vi.spyOn(api.playlistSync, 'previewExportPlan').mockImplementation(async (name, target, scope) => ({ ...exportPlanFixture, playlist_name: name, target, scope }));
  vi.spyOn(api.playlistSync, 'executeExportPlan').mockResolvedValue(exportReportFixture);
  await render();
  await act(async () => { button('Export…').click(); await tick(); });
  expect(document.querySelector('[role=dialog]')).toBeNull();
  expect(api.playlistSync.previewExportPlan).toHaveBeenLastCalledWith('Night Shift', 'engine', 'full');
  await act(async () => { button('Rekordbox desktop').click(); await tick(); });
  expect(api.playlistSync.previewExportPlan).toHaveBeenLastCalledWith('Night Shift', 'rekordbox', 'full');
  await choose('Playlist export scope', 'order');
  expect(api.playlistSync.previewExportPlan).toHaveBeenLastCalledWith('Night Shift', 'rekordbox', 'order');
});

it('keyboard rows inspect exact IDs; empty selection cannot expand to all Library', async () => {
  await render();
  await act(async () => {
    const row = document.querySelector<HTMLTableRowElement>('[data-track-id="1"]')!;
    row.focus(); row.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); await tick();
  });
  expect(document.activeElement?.getAttribute('data-track-id')).toBe('2');
  expect(document.querySelector<HTMLSelectElement>('[aria-label="Review scope"]')?.value).toBe('selected');
  await act(async () => { document.querySelector<HTMLTableRowElement>('[data-track-id="2"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })); await tick(); });
  await act(async () => { button('Recheck plan').click(); await tick(); });
  expect(document.body.textContent).toContain('No tracks in this scope');
  expect(fieldReview.plan).not.toHaveBeenCalled();
});

it('keeps a keyboard entry row when filtering hides the focused track', async () => {
  await render();
  await act(async () => { document.querySelector<HTMLTableRowElement>('[data-track-id="2"]')!.click(); await tick(); });
  await act(async () => {
    const input = document.querySelector<HTMLInputElement>('[aria-label="Filter workspace tracks"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Track 1');
    input.dispatchEvent(new Event('input', { bubbles: true })); await tick();
  });
  expect(document.querySelectorAll('.sw-track-table tbody tr')).toHaveLength(1);
  expect(document.querySelector<HTMLTableRowElement>('[data-track-id="1"]')!.tabIndex).toBe(0);
});

it('rejects duplicate Library identities instead of treating the list as a complete scope', async () => {
  vi.mocked(api.tracks.list).mockResolvedValue({ items: [tracks[0], tracks[0]], total: 2 });
  await render();
  expect(document.body.textContent).toContain('Library data unavailable');
  await choose('Review scope', 'all');
  await act(async () => { button('Recheck plan').click(); await tick(); });
  expect(document.body.textContent).toContain('Library scope is incomplete');
  expect(fieldReview.plan).not.toHaveBeenCalled();
});

it('rejects malformed playlist tracks without crashing the workspace', async () => {
  vi.mocked(api.playlists.get).mockResolvedValue({ id: 7, name: 'Night Shift', tracks: null } as unknown as Awaited<ReturnType<typeof api.playlists.get>>);
  vi.spyOn(api.playlistSync, 'previewExportPlan').mockImplementation(async (name, target, scope) => ({ ...exportPlanFixture, playlist_name: name, target, scope }));
  await render();
  await act(async () => { button('Export…').click(); await tick(); });
  expect(document.body.textContent).toContain('Library data unavailable');
  expect(document.querySelector('.sync-workspace')).not.toBeNull();
});

it.each((['filtered', 'all'] as const).flatMap(scope => (['success', 'error', 'unknown'] as const).map(outcome => ({ scope, outcome }))))('retains $scope operation and $outcome outcome across passive scope refreshes', async ({ scope, outcome }) => {
  let resolve!: (value: FieldReceipt) => void, reject!: (error: Error) => void;
  const execute = vi.spyOn(fieldReview, 'execute').mockImplementation(() => new Promise((ok, fail) => { resolve = ok; reject = fail; }));
  await render();
  await choose('Review scope', scope);
  act(() => client.setQueryData(['tracks', 'sync-workspace'], { items: tracks.slice(0, 2), total: 2 }));
  await act(async () => { await tick(); button('Recheck plan').click(); await tick(); });
  await act(async () => { document.querySelectorAll<HTMLInputElement>('.field-replacement input').forEach(input => input.click()); await tick(); });
  await act(async () => { button('Apply 6 fields').click(); await tick(); });
  const panel = document.querySelector('[data-review-panel]');
  await act(async () => { client.setQueryData(['tracks', 'sync-workspace'], { items: tracks, total: 3 }); await tick(); });
  expect(document.querySelector('[data-review-panel]')).toBe(panel);
  expect(button('Recheck plan').disabled).toBe(true);
  expect(button('Clear review').disabled).toBe(true);
  expect(execute.mock.calls[0][0].track_ids).toEqual([1, 2]);
  const expected = outcome === 'success' ? 'Field receipt' : outcome === 'error' ? 'Operation not started' : 'Outcome unknown';
  await act(async () => {
    if (outcome === 'success') {
      const submitted = execute.mock.calls[0][0];
      resolve({ ...submitted, status: 'complete', verification: 'Fixture receipt', tracks: submitted.tracks.map(track => ({ ...track, fields: submitted.fields.map(field => ({ field, status: 'applied' })) })) });
    } else reject(new FieldRequestError('Original operation outcome', outcome === 'unknown' ? 'unknown' : 'rejected'));
    await tick();
  });
  expect(document.body.textContent).toContain(expected);
  await act(async () => { client.setQueryData(['tracks', 'sync-workspace'], { items: tracks.slice().reverse(), total: 3 }); await tick(); });
  expect(document.querySelector('[data-review-panel]')).toBe(panel);
  expect(document.body.textContent).toContain(expected);
  await act(async () => { button('Inspect destination, then recheck').click(); await tick(); });
  expect(vi.mocked(fieldReview.plan).mock.calls.at(-1)![0].track_ids).toEqual([3, 2, 1]);
});

it('invalidates an unapplied implicit plan on passive scope change without replacing its owner', async () => {
  await render();
  await act(async () => { client.setQueryData(['tracks', 'sync-workspace'], { items: tracks.slice(0, 2), total: 2 }); await tick(); button('Recheck plan').click(); await tick(); });
  const panel = document.querySelector('[data-review-panel]');
  await act(async () => { document.querySelectorAll<HTMLInputElement>('.field-replacement input').forEach(input => input.click()); await tick(); });
  expect(button('Apply 6 fields').disabled).toBe(false);
  await act(async () => { client.setQueryData(['tracks', 'sync-workspace'], { items: tracks, total: 3 }); await tick(); });
  expect(document.querySelector('[data-review-panel]')).toBe(panel);
  expect(button('Apply 6 fields').disabled).toBe(true);
  expect(document.body.textContent).toContain('Scope changed since this plan');
});

it.each(['success', 'error'] as const)('retains submitted playlist owner and %s outcome when Library and playlist caches change', async outcome => {
  vi.spyOn(api.playlistSync, 'previewExportPlan').mockImplementation(async (name, target, scope) => ({ ...exportPlanFixture, playlist_name: name, target, scope }));
  let resolve!: (value: typeof exportReportFixture) => void, reject!: (error: Error) => void;
  vi.spyOn(api.playlistSync, 'executeExportPlan').mockImplementation(() => new Promise((ok, fail) => { resolve = ok; reject = fail; }));
  await render();
  await act(async () => { button('Export…').click(); await tick(); });
  await act(async () => { document.querySelector<HTMLInputElement>('.pei-confirm input')!.click(); await tick(); });
  await act(async () => { button('Export reviewed changes').click(); await tick(); });
  const panel = document.querySelector('[data-review-panel]');
  await act(async () => {
    client.setQueryData(['tracks', 'sync-workspace'], { items: tracks.slice().reverse(), total: 3 });
    client.setQueryData(['playlists'], []); await tick();
  });
  expect(document.querySelector('[data-review-panel]')).toBe(panel);
  expect(button('Clear review').disabled).toBe(true);
  await act(async () => { if (outcome === 'success') resolve(exportReportFixture); else reject(new Error('Lost playlist receipt')); await tick(); });
  expect(document.querySelector('[data-review-panel]')).toBe(panel);
  expect(document.body.textContent).toContain(outcome === 'success' ? 'Export receipt' : 'Lost playlist receipt');
  await act(async () => { button('Clear review').click(); await tick(); });
  expect(document.querySelector('[data-review-panel]')).toBeNull();
});

it.each((['filtered', 'all'] as const).flatMap(scope => [3, 1, -1, NaN, 10001].map(total => ({ scope, total }))))('invalidates $scope authority for same IDs with total=$total until explicit recheck', async ({ scope, total }) => {
  const execute = vi.spyOn(fieldReview, 'execute');
  await render();
  await choose('Review scope', scope);
  await act(async () => { client.setQueryData(['tracks', 'sync-workspace'], { items: tracks.slice(0, 2), total: 2 }); await tick(); button('Recheck plan').click(); await tick(); });
  await act(async () => { document.querySelectorAll<HTMLInputElement>('.field-replacement input').forEach(input => input.click()); await tick(); });
  expect(button('Apply 6 fields').disabled).toBe(false);
  const panel = document.querySelector('[data-review-panel]');
  await act(async () => { client.setQueryData(['tracks', 'sync-workspace'], { items: tracks.slice(0, 2), total }); await tick(); });
  expect(button('Apply 6 fields').disabled).toBe(true);
  await act(async () => { button('Apply 6 fields').click(); await tick(); });
  expect(execute).not.toHaveBeenCalled();
  expect(document.querySelector('[data-review-panel]')).toBe(panel);
  await act(async () => { client.setQueryData(['tracks', 'sync-workspace'], { items: tracks.slice(0, 2), total: 2 }); await tick(); });
  expect(button('Apply 6 fields').disabled).toBe(true);
  await act(async () => { button('Recheck plan').click(); await tick(); });
  expect(button('Apply 0 fields').disabled).toBe(true);
  expect(fieldReview.plan).toHaveBeenCalledTimes(2);
  expect(document.querySelector('[data-review-panel]')).toBe(panel);
});

it.each(['selected', 'captured'] as const)('keeps exact %s authority when unrelated total changes', async scope => {
  await render();
  await act(async () => { button('Review fields…').click(); await tick(); });
  if (scope === 'selected') await choose('Review scope', 'selected');
  await act(async () => { button('Recheck plan').click(); await tick(); });
  await act(async () => { document.querySelector<HTMLInputElement>('.field-replacement input')!.click(); await tick(); });
  expect(button('Apply 1 fields').disabled).toBe(false);
  const panel = document.querySelector('[data-review-panel]');
  await act(async () => { client.setQueryData(['tracks', 'sync-workspace'], { items: tracks, total: 4 }); await tick(); });
  expect(button('Apply 1 fields').disabled).toBe(false);
  expect(document.querySelector('[data-review-panel]')).toBe(panel);
  expect(vi.mocked(fieldReview.plan).mock.calls[0][0].track_ids).toEqual([2]);
});

it.each(['filtered', 'all'] as const)('retains pending %s receipt when unchanged IDs lose completeness', async scope => {
  let reject!: (error: Error) => void;
  const execute = vi.spyOn(fieldReview, 'execute').mockImplementation(() => new Promise((_ok, fail) => { reject = fail; }));
  await render();
  await choose('Review scope', scope);
  await act(async () => { client.setQueryData(['tracks', 'sync-workspace'], { items: tracks.slice(0, 2), total: 2 }); await tick(); button('Recheck plan').click(); await tick(); });
  await act(async () => { document.querySelectorAll<HTMLInputElement>('.field-replacement input').forEach(input => input.click()); await tick(); button('Apply 6 fields').click(); await tick(); });
  const panel = document.querySelector('[data-review-panel]');
  await act(async () => { client.setQueryData(['tracks', 'sync-workspace'], { items: tracks.slice(0, 2), total: 3 }); await tick(); });
  expect(document.querySelector('[data-review-panel]')).toBe(panel);
  expect(button('Recheck plan').disabled).toBe(true);
  expect(execute.mock.calls[0][0].track_ids).toEqual([1, 2]);
  await act(async () => { reject(new FieldRequestError('Original outcome retained', 'unknown')); await tick(); });
  expect(document.body.textContent).toContain('Outcome unknown');
  await act(async () => { client.setQueryData(['tracks', 'sync-workspace'], { items: tracks.slice(0, 2), total: 2 }); await tick(); });
  expect(document.querySelector('[data-review-panel]')).toBe(panel);
  expect(document.body.textContent).toContain('Outcome unknown');
});

it.each(['filtered', 'all'] as const)('invalidates %s authority after failed refetch despite retained complete data', async scope => {
  vi.mocked(api.tracks.list).mockResolvedValue({ items: tracks.slice(0, 2), total: 2 });
  await render();
  await choose('Review scope', scope);
  await act(async () => { button('Recheck plan').click(); await tick(); });
  await act(async () => { document.querySelectorAll<HTMLInputElement>('.field-replacement input').forEach(input => input.click()); await tick(); });
  const panel = document.querySelector('[data-review-panel]');
  let fail!: (error: Error) => void;
  vi.mocked(api.tracks.list).mockImplementation(() => new Promise((_ok, reject) => { fail = reject; }));
  await act(async () => { void client.refetchQueries({ queryKey: ['tracks', 'sync-workspace'] }); await tick(); });
  expect(document.querySelector('[data-review-panel]')).toBe(panel);
  await act(async () => { fail(new Error('Scope refetch failed')); await tick(); });
  expect(button('Apply 6 fields').disabled).toBe(true);
  expect(document.body.textContent).toContain('Library data unavailable');
  const calls = vi.mocked(fieldReview.plan).mock.calls.length;
  await act(async () => { button('Recheck plan').click(); await tick(); });
  expect(fieldReview.plan).toHaveBeenCalledTimes(calls);
  expect(document.body.textContent).toContain('Library scope is incomplete');
});
