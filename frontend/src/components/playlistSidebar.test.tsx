// @vitest-environment jsdom
/**
 * Sidebar restructure (library-sidebar gh#174): pinned "All tracks" over
 * ONE fluid list of collapsible sections (Tracks / Playlists / Sets), and
 * a unified "+ New…" button whose kind-picker popup starts the existing
 * inline-create flows. Assertions are the feature's contract: section
 * collapse hides rows and persists (sidebarSectionsStore → localStorage),
 * the popup offers Set/Playlist, and picking a kind expands the section
 * and opens its inline name form. The API client is faked at the true
 * seam (ADR 0002); everything above it is real.
 */
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PlaylistSidebar from './PlaylistSidebar';
import { ToastProvider } from './Toast';
import { setSidebarSectionCollapsed } from './sidebarSectionsStore';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// vitest's jsdom bridge does not expose window.localStorage as a global,
// and sidebarSectionsStore reads it at module scope — install the
// stand-in BEFORE imports run (perfSectionToggles.test idiom).
vi.hoisted(() => {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    get length() {
      return store.size;
    },
  } as Storage;
});

vi.mock('../api/client', () => ({
  api: {
    playlists: {
      list: vi.fn(async () => [
        { id: 10, name: 'Warmup', color: '#ff0000', display_order: 0 },
        { id: 11, name: 'Peak', color: null, display_order: 1 },
      ]),
      create: vi.fn(async ({ name }: { name: string }) => ({ id: 12, name, color: null })),
    },
    sets: {
      list: vi.fn(async () => [
        { id: 7, name: 'Friday', color: null, has_archived_tracks: false },
      ]),
      create: vi.fn(async ({ name }: { name: string }) => ({ id: 8, name, color: null })),
    },
  },
}));

let root: Root | null = null;

async function mount() {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root!.render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <PlaylistSidebar
            selectedView="all"
            selectedPlaylistId={null}
            onSelectView={() => {}}
            onSelectPlaylist={() => {}}
            onTrackDrop={() => {}}
            selectedSetId={null}
            onSelectSet={() => {}}
          />
        </ToastProvider>
      </QueryClientProvider>
    );
  });
  // Second pass: react-query delivers the resolved lists on a macrotask
  // (its notifyManager batches on setTimeout), one act-round after mount.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return host;
}

function unmount() {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = '';
}

afterEach(() => {
  unmount();
  // The store is a module singleton — reset for the next test.
  act(() => {
    setSidebarSectionCollapsed('tracks', false);
    setSidebarSectionCollapsed('playlists', false);
    setSidebarSectionCollapsed('sets', false);
  });
  localStorage.clear();
});

const row = (host: Element, key: string) => host.querySelector(`[data-entry-key="${key}"]`);
const header = (host: Element, id: string) =>
  host.querySelector<HTMLElement>(`[data-section-header="${id}"]`);
const createButton = (host: Element) =>
  Array.from(host.querySelectorAll('button')).find((b) => b.textContent === '+ New…')!;
const menuItem = (label: string) =>
  Array.from(document.querySelectorAll<HTMLElement>('.context-menu-item')).find(
    (el) => el.textContent === label
  );

describe('sidebar structure (gh#174)', () => {
  it('renders pinned All tracks, one create button, and the three sections', async () => {
    const host = await mount();
    expect(row(host, 'view:all')).not.toBeNull();
    // Section order (gh#189): Sets above Playlists.
    const headers = Array.from(
      host.querySelectorAll<HTMLElement>('[data-section-header]')
    ).map((el) => el.textContent);
    expect(headers).toEqual(['▾Tracks', '▾Sets', '▾Playlists']);
    // Section rows all present, in their sections.
    const expected = [
      'view:unprocessed',
      'view:needs-attention',
      'view:archived',
      'view:session',
      'playlist:10',
      'playlist:11',
      'set:7',
    ];
    const missing = expected.filter((key) => row(host, key) === null);
    expect(missing).toEqual([]);
    // ONE create button — the per-section New buttons are gone.
    const buttons = Array.from(host.querySelectorAll('button')).map((b) => b.textContent);
    expect(buttons).toContain('+ New…');
    expect(buttons).not.toContain('+ New Playlist');
    expect(buttons).not.toContain('+ New Set');
    // "+ New…" sits at the bottom of the sidebar (gh#189): every section
    // header precedes it in document order.
    const newButton = createButton(host);
    for (const id of ['tracks', 'sets', 'playlists']) {
      expect(
        header(host, id)!.compareDocumentPosition(newButton) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    }
  });
});

describe('section collapse persistence (gh#174)', () => {
  it('collapsing Playlists hides its rows, persists, and survives a remount', async () => {
    let host = await mount();
    act(() => header(host, 'playlists')!.click());

    expect(row(host, 'playlist:10')).toBeNull();
    expect(row(host, 'playlist:11')).toBeNull();
    expect(header(host, 'playlists')!.getAttribute('aria-expanded')).toBe('false');
    // Neighbors untouched.
    expect(row(host, 'view:unprocessed')).not.toBeNull();
    expect(row(host, 'set:7')).not.toBeNull();
    // Persisted for the next boot.
    expect(JSON.parse(localStorage.getItem('manadj-sidebar-sections')!)).toEqual({
      tracks: false,
      playlists: true,
      sets: false,
    });

    unmount();
    host = await mount();
    expect(row(host, 'playlist:10')).toBeNull();
    expect(header(host, 'playlists')!.getAttribute('aria-expanded')).toBe('false');

    act(() => header(host, 'playlists')!.click());
    expect(row(host, 'playlist:10')).not.toBeNull();
  });

  it('collapsing Tracks hides the track views but never pinned All tracks', async () => {
    const host = await mount();
    act(() => header(host, 'tracks')!.click());
    expect(row(host, 'view:unprocessed')).toBeNull();
    expect(row(host, 'view:session')).toBeNull();
    expect(row(host, 'view:all')).not.toBeNull();
  });

  it('collapsing Sets hides the set rows', async () => {
    const host = await mount();
    act(() => header(host, 'sets')!.click());
    expect(row(host, 'set:7')).toBeNull();
    expect(JSON.parse(localStorage.getItem('manadj-sidebar-sections')!)).toMatchObject({
      sets: true,
    });
  });

  it('boots collapsed from persisted state (fresh store instance)', async () => {
    localStorage.setItem('manadj-sidebar-sections', JSON.stringify({ sets: true }));
    vi.resetModules();
    const fresh = await import('./sidebarSectionsStore');
    expect(fresh.isSidebarSectionCollapsed('sets')).toBe(true);
    expect(fresh.isSidebarSectionCollapsed('playlists')).toBe(false);
  });
});

describe('unified create popup (gh#174)', () => {
  it('opens a kind picker with Set and Playlist', async () => {
    const host = await mount();
    act(() => createButton(host).click());
    const labels = Array.from(document.querySelectorAll('.context-menu-item')).map(
      (el) => el.textContent
    );
    expect(labels).toEqual(['Set', 'Playlist']);
  });

  it('picking Playlist expands the section and opens the inline name form', async () => {
    const host = await mount();
    act(() => header(host, 'playlists')!.click()); // collapsed first
    act(() => createButton(host).click());
    act(() => menuItem('Playlist')!.click());

    expect(header(host, 'playlists')!.getAttribute('aria-expanded')).toBe('true');
    expect(host.querySelector('input[placeholder="Playlist name"]')).not.toBeNull();
    // Leaf select closed the popup.
    expect(document.querySelector('.context-menu')).toBeNull();
  });

  it('picking Set expands the section and opens the inline name form', async () => {
    const host = await mount();
    act(() => header(host, 'sets')!.click()); // collapsed first
    act(() => createButton(host).click());
    act(() => menuItem('Set')!.click());

    expect(header(host, 'sets')!.getAttribute('aria-expanded')).toBe('true');
    expect(host.querySelector('input[placeholder="Set name"]')).not.toBeNull();
    expect(row(host, 'set:7')).not.toBeNull();
  });
});
