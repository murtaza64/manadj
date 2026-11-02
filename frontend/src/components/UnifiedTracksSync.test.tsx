// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import { UnifiedTracksSync } from './UnifiedTracksSync';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

it('applies a track reconciliation plan once and does not present dismissal as in-flight cancellation', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({
    surfaces_available: ['engine', 'rekordbox'],
    counts: { 'missing-downstream': 1, diverged: 0, 'not-in-library': 0, unimported: 0, 'in-sync': 0 },
    rows: [{ path: '/fixture/a.flac', title: 'A', artist: 'Fixture', track_id: 1,
      presence: { library: true, disk: true, engine: false, rekordbox: true },
      status: 'missing-downstream', unprocessed: false, archived: false, diverged: [], warnings: [] }],
  })));
  let resolve!: (r: Awaited<ReturnType<typeof api.trackSync.exportToEngine>>) => void;
  const write = vi.spyOn(api.trackSync, 'exportToEngine').mockImplementation(() => new Promise(r => { resolve = r; }));
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['app-config'], { export_enabled: true });
  const tick = () => new Promise(r => setTimeout(r, 10));
  const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === text)!;
  try {
    await act(async () => { root.render(<QueryClientProvider client={client}><UnifiedTracksSync /></QueryClientProvider>); await tick(); });
    await act(async () => { await tick(); });
    act(() => button('Export all → Engine').click());
    await act(async () => { button('Apply').click(); button('Apply').click(); await tick(); });
    expect(write).toHaveBeenCalledTimes(1);
    expect(button('Applying…').disabled).toBe(true);
    expect(button('Dismiss plan').disabled).toBe(true);
    await act(async () => { resolve({ exported_to_target: 1 } as Awaited<ReturnType<typeof api.trackSync.exportToEngine>>); await tick(); });
    await act(async () => { await tick(); });
    expect(button('Applying…')).toBeUndefined();
    expect(host.textContent).toContain('Exported 1 tracks to Engine DJ');
  } finally { act(() => root.unmount()); client.clear(); }
});
