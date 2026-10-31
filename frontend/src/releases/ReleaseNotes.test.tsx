// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReleaseNotes, ReleaseNotesButton, type Release } from './ReleaseNotes';

const release: Release = {
  schema: 1, release_id: 'a'.repeat(64), version: '1.2.3', source_revision: 'b'.repeat(40),
  notes_sha256: 'c'.repeat(64), body: '<script>unsafe()</script>\nNotes — café', seen: false,
};
let root: Root;
let host: HTMLDivElement;
let seen: boolean;
let posts: string[];

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  seen = false;
  posts = [];
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true,
    value: function (this: HTMLDialogElement) { this.setAttribute('open', ''); },
  });
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') { posts.push(String(init.body)); seen = true; return new Response('{"seen":true}'); }
    return new Response(JSON.stringify({ release: { ...release, seen } }));
  }));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function mount(id = release.release_id) {
  await act(async () => { root.render(<><ReleaseNotes loadedId={id} /><ReleaseNotesButton /></>); });
}
async function click(text: string) {
  const button = [...host.querySelectorAll('button')].find((b) => b.textContent === text)!;
  await act(async () => button.click());
}

describe('loaded release notes', () => {
  it('opens first launch, persists ack, stays closed on restart, manually reopens', async () => {
    await mount();
    expect(host.querySelector('dialog[open]')?.textContent).toContain('1.2.3');
    expect(host.querySelector('script')).toBeNull();
    expect(host.textContent).toContain('<script>unsafe()</script>');
    expect(posts).toEqual([]);
    await click('Done');
    expect(posts).toEqual([JSON.stringify({ release_id: release.release_id })]);
    expect(host.querySelector('dialog')).toBeNull();
    await act(async () => root.unmount());
    root = createRoot(host);
    await mount();
    expect(host.querySelector('dialog')).toBeNull();
    await click('Release notes');
    expect(host.querySelector('dialog[open]')).not.toBeNull();
  });

  it('never uses metadata for a different frontend or fabricates a missing release', async () => {
    await mount('d'.repeat(64));
    expect(host.querySelector('dialog')).toBeNull();
    await click('Release notes');
    expect(host.textContent).toContain('No release notes for this loaded build.');
    await click('Done');
    expect(posts).toEqual([]);
  });

  it('shows failed/stale acknowledgement without dismissing or marking seen', async () => {
    await mount();
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 409 }));
    await click('Done');
    expect(host.querySelector('dialog[open]')).not.toBeNull();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('another release');
    expect(seen).toBe(false);
    await click('Close without marking seen');
    expect(host.querySelector('dialog')).toBeNull();
  });

  it('suppresses a delayed startup response after interaction; no polling', async () => {
    let finish!: (value: Response) => void;
    vi.mocked(fetch).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    await mount();
    window.dispatchEvent(new Event('pointerdown'));
    await act(async () => finish(new Response(JSON.stringify({ release }))));
    expect(host.querySelector('dialog')).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    await click('Release notes');
    expect(host.querySelector('dialog[open]')).not.toBeNull();
  });

  it('does not open automatically after the launch window or over an existing dialog', async () => {
    vi.useFakeTimers();
    let finish!: (value: Response) => void;
    vi.mocked(fetch).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    await mount();
    await act(async () => { vi.advanceTimersByTime(1501); });
    await act(async () => finish(new Response(JSON.stringify({ release }))));
    expect(host.querySelector('dialog')).toBeNull();
    vi.useRealTimers();
    await act(async () => root.unmount());
    root = createRoot(host);
    const existing = document.createElement('div');
    existing.setAttribute('role', 'dialog');
    document.body.append(existing);
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ release })));
    try {
      await mount();
      expect(host.querySelector('dialog')).toBeNull();
      await click('Release notes');
      expect(host.querySelector('dialog[open]')).not.toBeNull();
    } finally { existing.remove(); }
  });

  it('does not fetch or acknowledge without a declared frontend identity', async () => {
    await mount('');
    expect(fetch).not.toHaveBeenCalled();
    expect(host.querySelector('dialog')).toBeNull();
    await click('Release notes');
    expect(host.textContent).toContain('No release notes for this loaded build.');
    await click('Done');
    expect(fetch).not.toHaveBeenCalled();
  });
});
