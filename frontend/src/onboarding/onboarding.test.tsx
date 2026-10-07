// @vitest-environment jsdom
// First run + Rekordbox import wizard (#275) at the HTTP seam: fetch is
// faked with canned backend responses (ADR 0002 — the backend is the seam).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { RekordboxImportGuide } from './RekordboxImportGuide';
import { FirstRunWelcome } from './FirstRunWelcome';
import { guideStatus, SETUP_STATE_KEY } from '../setup/guides';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PREVIEW = {
  library_dir: '/snap',
  tracks_total: 12,
  tracks_importable: 10,
  tracks_already_imported: 0,
  tracks_missing_file: 2,
  tracks_streaming: 0,
  hotcues: 30,
  saved_loops: 1,
  grids: 10,
  keys: 9,
  tag_categories: 2,
  tags: 5,
  tag_assignments: 14,
  genres: 3,
  playlists: 4,
  smart_playlists: 0,
  smart_playlists_skipped: 0,
};

const SUMMARY = {
  tracks_imported: 10,
  tracks_already_imported: 0,
  tracks_missing_file: 2,
  tracks_streaming: 0,
  hotcues_applied: 8,
  beatgrids_applied: 10,
  maincues_applied: 6,
  keys_applied: 9,
  pending_conflicts: 0,
  tag_categories_created: 3,
  tags_created: 5,
  tag_assignments_added: 14,
  genre_tags_created: 3,
  genre_assignments_added: 10,
  playlists_created: 4,
  playlist_entries_added: 20,
  playlists_already_present: 0,
  smart_playlists_snapshotted: 0,
  smart_playlists_skipped: 0,
  dropped_memory_cues: 7,
  dropped_loops: 1,
};

interface Backend {
  libraryTotal: number;
  found: boolean;
  statuses: unknown[]; // consumed in order; last one repeats
  importBodies: unknown[];
}

function installFetch(b: Backend) {
  const ok = (body: unknown) => ({ ok: true, json: async () => body }) as Response;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/tracks/')) return ok({ library_total: b.libraryTotal, items: [] });
      if (url.endsWith('/rekordbox/detect'))
        return ok({ found: b.found, library_dir: b.found ? '/rb' : null });
      if (url.endsWith('/rekordbox/preview')) return ok(PREVIEW);
      if (url.endsWith('/rekordbox/import')) {
        b.importBodies.push(JSON.parse(String(init?.body)));
        return ok({ task_id: 1 });
      }
      if (url.endsWith('/rekordbox/status'))
        return ok(b.statuses.length > 1 ? b.statuses.shift() : b.statuses[0]);
      if (url.includes('/settings')) return ok({});
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
}

const NONE = { state: 'none', progress: null, summary: null, error: null };

let container: HTMLElement;
let root: Root;

function fakeStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (k: string) => values.get(k) ?? null,
    key: (i: number) => [...values.keys()][i] ?? null,
    removeItem: (k: string) => void values.delete(k),
    setItem: (k: string, v: string) => void values.set(k, v),
  };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', fakeStorage());
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function flush(ms = 0) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

function button(label: string): HTMLButtonElement {
  const b = [...container.querySelectorAll('button')].find((el) => el.textContent?.includes(label));
  if (!b) throw new Error(`no button "${label}" in: ${container.textContent}`);
  return b as HTMLButtonElement;
}

describe('RekordboxImportGuide', () => {
  it('detect → preview → run with progress → summary → done', async () => {
    const b: Backend = {
      libraryTotal: 0,
      found: true,
      statuses: [
        NONE,
        { state: 'running', progress: { phase: 'performance', done: 5, total: 10 }, summary: null, error: null },
        { state: 'done', progress: null, summary: SUMMARY, error: null },
      ],
      importBodies: [],
    };
    installFetch(b);
    const onDone = vi.fn();
    act(() => root.render(<RekordboxImportGuide onDone={onDone} onSkip={() => {}} pollMs={5} />));
    await flush();
    expect(container.textContent).toContain('Hot cues');
    expect(container.textContent).toContain('Missing on disk: 2');

    // Genre toggle off is carried to the run request.
    const genre = container.querySelector('input[type=checkbox]') as HTMLInputElement;
    act(() => genre.click());
    await act(async () => button('Import 10 new tracks').click());
    expect(b.importBodies).toEqual([{ include_genre: false }]);

    expect(container.querySelector('[data-testid=import-progress]')).not.toBeNull();
    await flush(50);
    const summary = container.querySelector('[data-testid=import-summary]');
    expect(summary?.textContent).toContain('Memory cues beyond the first: 7');
    act(() => button('Done').click());
    expect(onDone).toHaveBeenCalled();
  });

  it('a stale detect (StrictMode double-run) never undoes a started import', async () => {
    const b: Backend = {
      libraryTotal: 0,
      found: true,
      statuses: [NONE],
      importBodies: [],
    };
    installFetch(b);
    // First preview resolves late — after the user already clicked Import.
    const base = globalThis.fetch as unknown as (url: string, init?: RequestInit) => Promise<Response>;
    let previews = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith('/rekordbox/preview') && ++previews === 1) {
          await new Promise((r) => setTimeout(r, 40));
        }
        return base(url, init);
      }),
    );
    act(() =>
      root.render(
        <StrictMode>
          <RekordboxImportGuide onDone={() => {}} pollMs={10000} />
        </StrictMode>,
      ),
    );
    await flush(5);
    await act(async () => button('new tracks').click());
    await flush(80);
    expect(previews).toBe(2);
    expect(container.querySelector('[data-testid=import-progress]')).not.toBeNull();
  });

  it('resumes watching an import already in flight', async () => {
    installFetch({
      libraryTotal: 0,
      found: true,
      statuses: [{ state: 'running', progress: { phase: 'tracks', done: 1, total: 10 }, summary: null, error: null }],
      importBodies: [],
    });
    act(() => root.render(<RekordboxImportGuide onDone={() => {}} pollMs={1000} />));
    await flush();
    expect(container.textContent).toContain('1 / 10');
  });

  it('standalone mount has no Skip; not-found offers Look again', async () => {
    installFetch({ libraryTotal: 5, found: false, statuses: [NONE], importBodies: [] });
    act(() => root.render(<RekordboxImportGuide onDone={() => {}} />));
    await flush();
    expect(container.textContent).toContain('No Rekordbox library was found');
    expect(() => button('Skip')).toThrow();
    button('Look again');
  });
});

describe('FirstRunWelcome', () => {
  it('shows on an empty Library, and Skip records the status', async () => {
    installFetch({ libraryTotal: 0, found: true, statuses: [NONE], importBodies: [] });
    act(() => root.render(<FirstRunWelcome />));
    await flush();
    const overlay = container.querySelector('[data-testid=first-run-welcome]');
    expect(overlay).not.toBeNull();
    expect(overlay?.hasAttribute('data-tour-suppress')).toBe(true);
    act(() => button('Skip').click());
    expect(container.querySelector('[data-testid=first-run-welcome]')).toBeNull();
    expect(guideStatus('welcome')).toBe('skipped');
  });

  it('stays hidden for a non-empty Library', async () => {
    installFetch({ libraryTotal: 3, found: true, statuses: [NONE], importBodies: [] });
    act(() => root.render(<FirstRunWelcome />));
    await flush();
    expect(container.querySelector('[data-testid=first-run-welcome]')).toBeNull();
  });

  it('stays hidden once First run was finished or skipped', async () => {
    localStorage.setItem(SETUP_STATE_KEY, JSON.stringify({ welcome: 'done' }));
    installFetch({ libraryTotal: 0, found: true, statuses: [NONE], importBodies: [] });
    act(() => root.render(<FirstRunWelcome />));
    await flush();
    expect(container.querySelector('[data-testid=first-run-welcome]')).toBeNull();
  });

  it('Import from Rekordbox opens the wizard', async () => {
    installFetch({ libraryTotal: 0, found: true, statuses: [NONE], importBodies: [] });
    act(() => root.render(<FirstRunWelcome />));
    await flush();
    act(() => button('Import from Rekordbox').click());
    await flush();
    expect(container.querySelector('[data-testid=rekordbox-import-guide]')).not.toBeNull();
  });
});
