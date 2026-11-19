// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import { ExportImpact } from './ExportImpact';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });
const tick = () => new Promise((r) => setTimeout(r, 10));

it('previews a rebuild without offering to run it, and says what leaves the index', async () => {
  vi.spyOn(api.playlists, 'list').mockResolvedValue([{ id: 1, name: 'Set A' }] as never);
  const spy = vi.spyOn(api.externalDrives, 'exportImpact').mockResolvedValue({
    root: '/v/RB', mode: 'rebuild', selected: [{ id: 1, name: 'Set A', tracks: 3, missing_audio: 1 }],
    drive: { read: true, tracks: 9, playlists: 2, dropped_playlists: ['Old Mix'] }, one_library_present: false, is_mount: true,
    gate_enabled: false, rewrites: [], adds: [], deletes: [], executable: false, blocked_reason: 'x',
  });
  const host = document.createElement('ul'); document.body.append(host);
  const root = createRoot(host);
  await act(async () => { root.render(<ExportImpact root="/v/RB" />); await tick(); });
  await act(async () => { [...host.querySelectorAll('button')].find((b) => b.textContent === 'Preview a rebuild')!.click(); await tick(); });
  await act(async () => { host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click(); await tick(); });
  expect(spy).toHaveBeenCalledWith('/v/RB', [1]);
  const t = host.textContent ?? '';
  expect(t).toContain('Rebuilds the drive library');
  expect(t).toContain('Leaves the index (matched by name only): Old Mix');
  expect(t).toContain('No audio deleted');
  expect(t).not.toContain('Nothing deleted');
  expect(t).toContain('Anything kept only on the drive');
  expect(t).toContain('kept name is still rebuilt');
  expect(t).toContain('1 track skipped, audio missing');
  expect(t).toContain('Not enabled');
  expect([...host.querySelectorAll('button')].some((b) => /export|run|apply/i.test(b.textContent ?? '') && b.textContent !== 'Hide preview')).toBe(false);
});
