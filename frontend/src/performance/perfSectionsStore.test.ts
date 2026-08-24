/**
 * Performance-section visibility store (perf-layout 12 / gh#68) — boot
 * restore and persist+notify, against a fake localStorage at the true
 * seam (quantizeStore test idiom).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'manadj-perf-sections';

function fakeStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  } as Storage;
}

/** Fresh module instance per test (the store is a module-level singleton). */
async function loadStore(stored?: string) {
  vi.resetModules();
  vi.stubGlobal('localStorage', fakeStorage(stored ? { [STORAGE_KEY]: stored } : {}));
  return await import('./perfSectionsStore');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('perfSectionsStore', () => {
  it('defaults to both sections shown with nothing persisted', async () => {
    const store = await loadStore();
    expect(store.isPerfSectionShown('waveforms')).toBe(true);
    expect(store.isPerfSectionShown('decks')).toBe(true);
  });

  it('restores persisted hidden sections independently on boot', async () => {
    const store = await loadStore(JSON.stringify({ waveforms: false, decks: true }));
    expect(store.isPerfSectionShown('waveforms')).toBe(false);
    expect(store.isPerfSectionShown('decks')).toBe(true);
  });

  it('treats garbage as the default (shown) — only explicit false hides', async () => {
    for (const stored of ['not json', '42', '"decks"', JSON.stringify({ decks: 'nope' })]) {
      const store = await loadStore(stored);
      expect(store.isPerfSectionShown('waveforms')).toBe(true);
      expect(store.isPerfSectionShown('decks')).toBe(true);
    }
  });

  it('setPerfSectionShown persists and notifies; same-value writes are no-ops', async () => {
    const store = await loadStore();
    let calls = 0;
    store.subscribePerfSections(() => {
      calls += 1;
    });
    store.setPerfSectionShown('decks', true); // already shown
    expect(calls).toBe(0);
    store.setPerfSectionShown('decks', false);
    expect(calls).toBe(1);
    expect(store.isPerfSectionShown('decks')).toBe(false);
    // The other section is untouched — independent toggles.
    expect(store.isPerfSectionShown('waveforms')).toBe(true);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({
      waveforms: true,
      decks: false,
    });
  });

  it('togglePerfSection flips and round-trips through storage', async () => {
    const store = await loadStore();
    store.togglePerfSection('waveforms');
    expect(store.isPerfSectionShown('waveforms')).toBe(false);
    const rebooted = await loadStore(localStorage.getItem(STORAGE_KEY)!);
    expect(rebooted.isPerfSectionShown('waveforms')).toBe(false);
    expect(rebooted.isPerfSectionShown('decks')).toBe(true);
  });
});
