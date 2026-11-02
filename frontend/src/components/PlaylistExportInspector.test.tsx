// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { api, PlaylistExportRequestError } from '../api/client';
import { ExportFieldChanges, PlaylistExportEntry, PlaylistExportInspector } from './PlaylistExportInspector';
import { exportPlanFixture as plan, exportReportFixture as report } from '../test/playlistExportFixtures';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, client: QueryClient;
afterEach(() => { if (root) act(() => root.unmount()); client?.clear(); vi.restoreAllMocks(); document.body.innerHTML = ''; });
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
function button(text: string) { return [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === text)!; }
function InspectorHarness({ name, enabled }: { name: string; enabled: boolean }) {
  const [openedName, setOpenedName] = useState<string | null>(null);
  return <>{enabled ? <button onClick={() => setOpenedName(name)}>Export…</button> : <PlaylistExportEntry playlistName={name} />}
    {openedName && <PlaylistExportInspector playlistName={openedName} onClose={() => setOpenedName(null)} />}</>;
}
async function render(name = 'Night Shift', enabled = true) {
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(['app-config'], { export_enabled: enabled });
  await act(async () => { root.render(<QueryClientProvider client={client}><InspectorHarness name={name} enabled={enabled} /></QueryClientProvider>); await tick(); });
}
async function select(label: string, value: string) {
  await act(async () => { const select = document.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!; select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); await tick(); });
  await act(async () => { await tick(); });
}
async function open() { await act(async () => { button('Export…').click(); await tick(); }); }
async function acknowledge() { await act(async () => { document.querySelector<HTMLInputElement>('.pei-confirm input')!.click(); await tick(); }); }

it('opens the Library entry with captured context, visual removals/clears, then submits only its reviewed plan', async () => {
  const preview = vi.spyOn(api.playlistSync, 'previewExportPlan').mockResolvedValue(plan);
  const execute = vi.spyOn(api.playlistSync, 'executeExportPlan').mockResolvedValue(report);
  await render(); await open();
  expect(preview).not.toHaveBeenCalled();
  expect(button('Export reviewed changes').disabled).toBe(true);
  await select('Export destination', 'rekordbox');
  expect(preview).toHaveBeenCalledWith('Night Shift', 'rekordbox', 'full');
  expect(document.querySelector('.pei-member-remove')?.textContent).toContain('old.flac');
  expect(document.querySelector('.pei-clear')?.textContent).toContain('− 1 entries');
  expect(document.body.textContent).toContain('CLEAR: Hot cues, Main cue, Energy');
  expect(document.body.textContent).toContain('? Not observed');
  await act(async () => { root.render(<QueryClientProvider client={client}><InspectorHarness name="Different playlist" enabled /></QueryClientProvider>); await tick(); });
  expect(document.querySelector('[role="dialog"] h2')?.textContent).toContain('Night Shift');
  await acknowledge();
  await act(async () => { button('Export reviewed changes').click(); button('Export reviewed changes').click(); await tick(); });
  await act(async () => { await tick(); });
  expect(execute).toHaveBeenCalledTimes(1);
  expect(execute).toHaveBeenCalledWith(plan);
  expect(document.body.textContent).toContain('Needs attention');
  expect(document.body.textContent).toContain('skipped: Library has no saved grid');
  expect(document.body.textContent).toContain('Verification: writer report only');
});

it('never submits a pending/unavailable/stale plan or silently uses another target', async () => {
  let resolve!: (value: typeof plan) => void;
  vi.spyOn(api.playlistSync, 'previewExportPlan').mockImplementation(() => new Promise(r => { resolve = r; }));
  const execute = vi.spyOn(api.playlistSync, 'executeExportPlan');
  await render(); await open(); await select('Export destination', 'rekordbox');
  expect(button('Export reviewed changes').disabled).toBe(true);
  await act(async () => { resolve(plan); await tick(); }); await act(async () => { await tick(); });
  await acknowledge();
  await act(async () => { client.setQueryData(['playlist-export-plan', 'Night Shift', 'rekordbox', 'full'], plan, { updatedAt: Date.now() - 61_000 }); await tick(); });
  expect(document.body.textContent).toContain('Plan expired');
  expect(button('Export reviewed changes').disabled).toBe(true);
  await select('Export destination', 'engine');
  expect(button('Export reviewed changes').disabled).toBe(true);
  expect(execute).not.toHaveBeenCalled();
});

it('keeps the pending inspector open and preserves unknown outcomes rather than offering a retry', async () => {
  vi.spyOn(api.playlistSync, 'previewExportPlan').mockResolvedValue(plan);
  let reject!: (e: Error) => void;
  vi.spyOn(api.playlistSync, 'executeExportPlan').mockImplementation(() => new Promise((_resolve, r) => { reject = r; }));
  await render(); await open(); await select('Export destination', 'rekordbox'); await acknowledge();
  await act(async () => { button('Export reviewed changes').click(); await tick(); });
  expect(button('Close').disabled).toBe(true);
  act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  await act(async () => { reject(new PlaylistExportRequestError('Connection lost', 'unknown')); await tick(); }); await act(async () => { await tick(); });
  expect(document.body.textContent).toContain('Outcome unknown');
  expect(document.body.textContent).not.toContain('Retry export');
  await act(async () => { button('Close').click(); await tick(); }); await open();
  expect(document.body.textContent).toContain('Outcome unknown');
});

it('shows the export-off explanation without opening a write surface', async () => {
  await render('Night Shift', false);
  expect(document.body.textContent).toContain('External export off');
  expect(button('Export…')).toBeUndefined();
});

it('reviews record additions/omissions and retains confirmed additions beside native failures', async () => {
  const combined = structuredClone(plan);
  combined.tracks[2].record_action = 'create';
  combined.tracks[1].record_action = 'blocked';
  combined.tracks[1].record_reason = 'Source audio unavailable';
  vi.spyOn(api.playlistSync, 'previewExportPlan').mockResolvedValue(combined);
  const partial = structuredClone(report);
  partial.results[0].status = 'partial';
  partial.results[0].tracks_added = ['c.flac'];
  partial.results[0].tracks_exported = 1;
  partial.results[0].tracks_failed = 2;
  partial.results[0].tracks[1] = { ...partial.results[0].tracks[1], status: 'failed', reason: 'Source audio unavailable', fields: { playlist: 'failed' } };
  partial.results[0].tracks[2].status = 'failed';
  partial.results[0].tracks[2].fields.hotcues = 'failed: Cue DB committed; native DAT/EXT not synchronized';
  partial.results[0].tracks[2].reason = 'Cue DB committed; native DAT/EXT not synchronized';
  vi.spyOn(api.playlistSync, 'executeExportPlan').mockResolvedValue(partial);
  await render(); await open(); await select('Export destination', 'rekordbox');
  expect(document.body.textContent).toContain('ADD DESTINATION RECORD');
  expect(document.body.textContent).toContain('UNAVAILABLE · omitted');
  expect(document.body.textContent).toContain('Source audio unavailable');
  expect(button('Export reviewed changes').disabled).toBe(true);
  await acknowledge();
  await act(async () => { button('Export reviewed changes').click(); await tick(); });
  await act(async () => { await tick(); });
  expect(document.body.textContent).toContain('Added 1 destination library record');
  expect(document.body.textContent).toContain('c.flac');
  expect(document.body.textContent).toContain('Cue DB committed; native DAT/EXT not synchronized');
  expect(document.body.textContent).toContain('Needs attention');
});

it('keeps an unavailable preview non-executable and rechecks after a prerequisite is fixed', async () => {
  const preview = vi.spyOn(api.playlistSync, 'previewExportPlan').mockRejectedValue(new Error('Destination unavailable'));
  await render(); await open(); await select('Export destination', 'rekordbox');
  expect(document.body.textContent).toContain('Plan unavailable: Destination unavailable');
  expect(button('Export reviewed changes').disabled).toBe(true);
  preview.mockResolvedValue(plan);
  await act(async () => { button('Recheck plan').click(); await tick(); });
  await act(async () => { await tick(); });
  expect(document.body.textContent).not.toContain('Plan unavailable');
  await acknowledge();
  expect(button('Export reviewed changes').disabled).toBe(false);
});

it('presents scalar deltas as colored key values and collapses same-value rewrites without hiding clear intent', () => {
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  act(() => root.render(<ExportFieldChanges changes={[
    { field: 'key', before_known: true, before: 7, after: 8, action: 'replace', reason: null },
    { field: 'energy', before_known: true, before: 4, after: null, action: 'clear', reason: null },
    { field: 'title', before_known: true, before: 'Same', after: 'Same', action: 'unchanged', reason: null },
  ]} />));
  const key = host.querySelector('[aria-label="Key change"]')!;
  expect(key.querySelectorAll('.key-display')).toHaveLength(2);
  expect((key.querySelector('.key-display') as HTMLElement).style.color).not.toBe('');
  expect(host.querySelector('[aria-label="Energy change"]')?.textContent).toContain('∅ Empty');
  expect(host.querySelector('[aria-label="Energy change"]')?.textContent).toContain('CLEAR');
  expect(host.querySelector<HTMLDetailsElement>('.pei-unchanged')?.open).toBe(false);
  expect(host.querySelector('.pei-unchanged summary')?.textContent).toContain('still rewritten');
});
