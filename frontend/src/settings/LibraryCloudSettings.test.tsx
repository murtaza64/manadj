// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import LibraryCloudSettings from './LibraryCloudSettings';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let node: HTMLDivElement, root: Root;
const summary = (phase = 'idle'): LibraryCloudSummary => ({
  connection: { enabled: true, phase: 'connected', destination: 'https://synthetic.example' },
  upload: { phase, error: null, ...(phase === 'idle' ? {} : { snapshotId: 'synthetic-snapshot', destination: 'https://synthetic.example',
    bytes: 200, partCount: 1, rowCounts: { tracks: 2 }, omissions: ['Audio and stems excluded.'], reviewID: 'a'.repeat(48), reviewedSha256: 'b'.repeat(64) }) },
});
const ok = (value: LibraryCloudSummary): LibraryCloudResult => ({ ok: true, value });
beforeEach(() => { node = document.createElement('div'); document.body.appendChild(node); root = createRoot(node); });
afterEach(() => { act(() => root.unmount()); node.remove(); delete window.manadjLibraryCloud; });
function bridge(state = summary()): LibraryCloudBridge {
  return { state: vi.fn(async () => ok(state)), connect: vi.fn(async () => ok(state)), resume: vi.fn(async () => ok(state)),
    disconnect: vi.fn(async () => ok(state)), review: vi.fn(async () => ok(summary('review'))),
    upload: vi.fn(async () => ok(summary('verified'))), cancel: vi.fn(async () => ok(state)) };
}
const button = (label: string) => [...node.querySelectorAll('button')].find(b => b.textContent === label)!;
async function render() { await act(async () => { root.render(<LibraryCloudSettings />); }); }
async function click(label: string) { await act(async () => { button(label).click(); }); }
it('has no effect controls outside desktop or when compiled disabled', async () => {
  await render(); expect(node.textContent).toContain('disabled in this build'); expect(node.querySelector('button')).toBeNull();
  window.manadjLibraryCloud = bridge({ connection: { enabled: false, phase: 'disabled', destination: null }, upload: { phase: 'idle', error: null } });
  await render(); expect(node.querySelector('button')).toBeNull();
});
it('requires a real review, shows exact summary and sends only reviewed identifiers', async () => {
  const b = bridge(); window.manadjLibraryCloud = b; await render();
  expect(button('Upload reviewed snapshot')).toBeUndefined();
  await click('Review snapshot'); expect(node.textContent).toContain('tracks: 2 rows');
  expect(node.textContent).toContain('200 bytes'); expect(node.textContent).toContain('Audio and stems excluded.');
  expect(b.upload).not.toHaveBeenCalled(); await click('Upload reviewed snapshot');
  expect(b.upload).toHaveBeenCalledExactlyOnceWith({ reviewID: 'a'.repeat(48), reviewedSha256: 'b'.repeat(64) });
  expect(node.textContent).toContain('Uploaded and read back');
});
it('keeps a failed review for an explicit exact retry, without auto-upload', async () => {
  const b = bridge(summary('failed')); b.upload = vi.fn(async (): Promise<LibraryCloudResult> => ({ ok: false, error: 'cloud_network_unavailable' }));
  window.manadjLibraryCloud = b; await render(); await click('Retry reviewed upload');
  expect(b.upload).toHaveBeenCalledTimes(1); expect(node.querySelector('[role=alert]')).not.toBeNull();
  expect(button('Retry reviewed upload')).toBeDefined();
});
it('does not show raw provider errors', async () => {
  const b = bridge(); b.review = vi.fn(async (): Promise<LibraryCloudResult> => ({ ok: false, error: 'synthetic-private-label' }));
  window.manadjLibraryCloud = b; await render(); await click('Review snapshot');
  expect(node.textContent).not.toContain('synthetic-private-label');
});
