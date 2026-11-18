// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  applyWallpaperOverrides,
  clearWallpaperOverrides,
  disableWallpaperTheme,
  enableWallpaperTheme,
  isWallpaperThemeEnabled,
} from './wallpaperSource';

const PALETTE = {
  version: 'wal-palette/1',
  colors: {
    background: '#0d0f14',
    foreground: '#d5dbe5',
    cursor: '#d5dbe5',
    ansi: ['#14161d', '#ff5370', '#7bd88f', '#ffcb6b', '#82aaff', '#c792ea', '#89ddff', '#d5dbe5',
      '#3b3f4c', '#ff5370', '#7bd88f', '#ffcb6b', '#82aaff', '#c792ea', '#89ddff', '#ffffff'],
  },
};

function mockFetchSequence(...bodies: Array<{ palette: unknown; mtime: number } | null>) {
  const queue = [...bodies];
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    // The persisted-settings seam fire-and-forgets PUTs through the same
    // global fetch; answer them without consuming the palette queue.
    if (init?.method === 'PUT' || !String(input).includes('wallpaper-palette')) {
      return { ok: true, status: 204, json: async () => ({}) } as Response;
    }
    const body = queue.shift() ?? null;
    if (body === null) return { ok: false, status: 404, json: async () => ({}) } as Response;
    return { ok: true, status: 200, json: async () => body } as Response;
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  document.documentElement.style.cssText = '';
  localStorage.clear();
});

afterEach(() => {
  disableWallpaperTheme();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('wallpaper source', () => {
  it('applies mapped overrides and persists opt-in', async () => {
    vi.stubGlobal('fetch', mockFetchSequence({ palette: PALETTE, mtime: 100 }));
    enableWallpaperTheme();
    await vi.advanceTimersByTimeAsync(0);
    expect(isWallpaperThemeEnabled()).toBe(true);
    const bg = document.documentElement.style.getPropertyValue('--base');
    expect(bg).not.toBe('');
  });

  it('keeps current theme on backend refusal (404/422)', async () => {
    vi.stubGlobal('fetch', mockFetchSequence(null));
    enableWallpaperTheme();
    await vi.advanceTimersByTimeAsync(0);
    expect(document.documentElement.style.getPropertyValue('--base')).toBe('');
  });

  it('re-polls on mtime change and re-applies new palette', async () => {
    const darker = { ...PALETTE, colors: { ...PALETTE.colors, background: '#05060a' } };
    vi.stubGlobal('fetch', mockFetchSequence(
      { palette: PALETTE, mtime: 100 },
      { palette: darker, mtime: 200 },
    ));
    enableWallpaperTheme();
    await vi.advanceTimersByTimeAsync(0);
    const first = document.documentElement.style.getPropertyValue('--base');
    await vi.advanceTimersByTimeAsync(3000);
    const second = document.documentElement.style.getPropertyValue('--base');
    expect(first).not.toBe('');
    expect(second).not.toBe('');
    expect(second).not.toBe(first);
  });

  it('skips re-apply when colors are unchanged (even with newer mtime)', async () => {
    const fetchMock = mockFetchSequence({ palette: PALETTE, mtime: 100 }, { palette: PALETTE, mtime: 200 });
    vi.stubGlobal('fetch', fetchMock);
    enableWallpaperTheme();
    await vi.advanceTimersByTimeAsync(0);
    document.documentElement.style.setProperty('--base', 'sentinel');
    await vi.advanceTimersByTimeAsync(3000);
    expect(document.documentElement.style.getPropertyValue('--base')).toBe('sentinel');
  });

  it('refuses invalid contract palette without touching the theme', async () => {
    vi.stubGlobal('fetch', mockFetchSequence({ palette: { version: 'wal-palette/1' }, mtime: 5 }));
    enableWallpaperTheme();
    await vi.advanceTimersByTimeAsync(0);
    expect(document.documentElement.style.getPropertyValue('--base')).toBe('');
  });

  it('disable restores base values and clears opt-in', async () => {
    vi.stubGlobal('fetch', mockFetchSequence({ palette: PALETTE, mtime: 100 }));
    enableWallpaperTheme();
    await vi.advanceTimersByTimeAsync(0);
    disableWallpaperTheme();
    expect(isWallpaperThemeEnabled()).toBe(false);
    const bg = document.documentElement.style.getPropertyValue('--base');
    expect(bg === '' || bg === '#0d0f14').toBe(false); // restored to base token or unset
  });
});

describe('wallpaper source lifecycle guards', () => {
  it('never stacks overlapping polls on a slow backend', async () => {
    let resolveFetch: ((v: unknown) => void) | null = null;
    const fetchMock = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'PUT' || !String(input).includes('wallpaper-palette')) {
          return Promise.resolve({ ok: true, status: 204, json: async () => ({}) });
        }
        return new Promise((resolve) => {
          resolveFetch = resolve;
        });
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    const paletteCalls = () =>
      fetchMock.mock.calls.filter(([input]) => String(input).includes('wallpaper-palette')).length;
    enableWallpaperTheme();
    await vi.advanceTimersByTimeAsync(9000); // three poll ticks while first fetch hangs
    expect(paletteCalls()).toBe(1);
    resolveFetch!({ ok: true, status: 200, json: async () => ({ palette: PALETTE, mtime: 1 }) });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(3000);
    expect(paletteCalls()).toBe(2);
    // Resolve the last outstanding poll so module state is clean for later tests.
    resolveFetch!({ ok: true, status: 200, json: async () => ({ palette: PALETTE, mtime: 1 }) });
    await vi.advanceTimersByTimeAsync(0);
  });

  it('applies a replaced palette even when its mtime is older', async () => {
    // Real tools can rewrite colors.json preserving or rewinding mtime; the
    // content, not the timestamp, decides.
    const first = { palette: PALETTE, mtime: 300 };
    const replaced = { palette: { ...PALETTE, colors: { ...PALETTE.colors, background: '#05060a' } }, mtime: 100 };
    vi.stubGlobal('fetch', mockFetchSequence(first, replaced));
    enableWallpaperTheme();
    await vi.advanceTimersByTimeAsync(0);
    const initial = document.documentElement.style.getPropertyValue('--base');
    await vi.advanceTimersByTimeAsync(3000);
    const afterReplace = document.documentElement.style.getPropertyValue('--base');
    expect(afterReplace).not.toBe('');
    expect(afterReplace).not.toBe(initial);
  });

  it('never lets a refused palette overwrite applied state', async () => {
    vi.stubGlobal('fetch', mockFetchSequence(
      { palette: PALETTE, mtime: 1 },
      { palette: { version: 'wal-palette/1' }, mtime: 2 }, // malformed
    ));
    enableWallpaperTheme();
    await vi.advanceTimersByTimeAsync(0);
    const good = document.documentElement.style.getPropertyValue('--base');
    expect(good).not.toBe('');
    await vi.advanceTimersByTimeAsync(3000);
    expect(document.documentElement.style.getPropertyValue('--base')).toBe(good);
  });
});
