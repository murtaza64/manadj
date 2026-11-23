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
const stored = (id: string): LibraryCloudSnapshot => ({ snapshotId: id, state: 'committed', bytes: 200, parts: 1, createdAt: '2026-11-22T18:00:00Z' });
function bridge(state = summary()): LibraryCloudBridge {
  return { state: vi.fn(async () => ok(state)), connect: vi.fn(async () => ok(state)), resume: vi.fn(async () => ok(state)),
    disconnect: vi.fn(async () => ok(state)), review: vi.fn(async () => ok(summary('review'))),
    upload: vi.fn(async () => ok(summary('verified'))), cancel: vi.fn(async () => ok(state)),
    snapshots: vi.fn(async (): Promise<LibraryCloudSnapshotsResult> => ({ ok: true, value: [stored('12345678-1234-4234-8234-123456789012')] })),
    deleteSnapshot: vi.fn(async (): Promise<LibraryCloudDeleteResult> => ({ ok: true, value: { deleted: { snapshotId: '12345678-1234-4234-8234-123456789012', parts: 1, bytes: 200 }, snapshots: [] } })) };
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

it('lists stored snapshots and deletes only after an explicit confirm, with verified readback', async () => {
  const b = bridge(); window.manadjLibraryCloud = b; await render();
  expect(node.textContent).toContain('Stored cloud snapshots'); expect(node.textContent).toContain('committed');
  expect(b.deleteSnapshot).not.toHaveBeenCalled();
  await click('Delete'); expect(node.textContent).toContain('Delete permanently?'); expect(b.deleteSnapshot).not.toHaveBeenCalled();
  await click('Confirm delete');
  expect(b.deleteSnapshot).toHaveBeenCalledExactlyOnceWith({ snapshotId: '12345678-1234-4234-8234-123456789012' });
  expect(node.textContent).toContain('verified absent'); expect(node.textContent).toContain('None stored.');
});
it('delete can be kept before confirming and shows a safe failure without claiming deletion', async () => {
  const b = bridge(); window.manadjLibraryCloud = b; await render();
  await click('Delete'); await click('Keep'); expect(b.deleteSnapshot).not.toHaveBeenCalled();
  b.deleteSnapshot = vi.fn(async (): Promise<LibraryCloudDeleteResult> => ({ ok: false, error: 'cloud_delete_readback_failed' }));
  await click('Delete'); await click('Confirm delete');
  expect(node.querySelector('[role=alert]')?.textContent).toContain('could not be verified');
  expect(node.textContent).not.toContain('verified absent');
});
