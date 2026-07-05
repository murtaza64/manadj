// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { FilterProvider, useFilters } from '../contexts/FilterContext';
import { isFindChord, shouldClearSearch, useSearchKeys } from './searchKeys';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// vitest's jsdom bridge does not expose window.localStorage as a global;
// FilterProvider reads it at mount. Minimal stand-in.
const store = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  },
} as Storage;

function keydown(init: KeyboardEventInit, target: EventTarget = document.body): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

describe('isFindChord', () => {
  it('matches Cmd+F and Ctrl+F', () => {
    expect(isFindChord(new KeyboardEvent('keydown', { key: 'f', metaKey: true }))).toBe(true);
    expect(isFindChord(new KeyboardEvent('keydown', { key: 'F', ctrlKey: true }))).toBe(true);
  });

  it('rejects bare f, other chords, and extra modifiers', () => {
    expect(isFindChord(new KeyboardEvent('keydown', { key: 'f' }))).toBe(false);
    expect(isFindChord(new KeyboardEvent('keydown', { key: 'a', metaKey: true }))).toBe(false);
    expect(isFindChord(new KeyboardEvent('keydown', { key: 'f', metaKey: true, shiftKey: true }))).toBe(false);
    expect(isFindChord(new KeyboardEvent('keydown', { key: 'f', metaKey: true, altKey: true }))).toBe(false);
  });
});

describe('shouldClearSearch (the staged-Escape rule)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('clears on unfocused Escape with an active search', () => {
    expect(shouldClearSearch(keydown({ key: 'Escape' }), 'query')).toBe(true);
  });

  it('does nothing without an active search', () => {
    expect(shouldClearSearch(keydown({ key: 'Escape' }), '')).toBe(false);
  });

  it('leaves typing targets alone (their own Escape handles the field)', () => {
    const input = document.createElement('input');
    input.type = 'text';
    document.body.appendChild(input);
    expect(shouldClearSearch(keydown({ key: 'Escape' }, input), 'query')).toBe(false);
  });

  it('a focused non-typing control does not block the clear', () => {
    const box = document.createElement('input');
    box.type = 'checkbox';
    document.body.appendChild(box);
    expect(shouldClearSearch(keydown({ key: 'Escape' }, box), 'query')).toBe(true);
  });

  it('ignores other keys and modified Escape', () => {
    expect(shouldClearSearch(keydown({ key: 'Enter' }), 'query')).toBe(false);
    expect(shouldClearSearch(keydown({ key: 'Escape', metaKey: true }), 'query')).toBe(false);
  });
});

describe('useSearchKeys (mounted through FilterProvider)', () => {
  function renderHarness() {
    const filtersRef = {
      current: null as unknown as ReturnType<typeof useFilters>,
    };
    const inputRef = { current: null as HTMLInputElement | null };

    function Probe() {
      const ref = useRef<HTMLInputElement>(null);
      const filters = useFilters();
      useSearchKeys(ref);
      useEffect(() => {
        filtersRef.current = filters;
        inputRef.current = ref.current;
      });
      return <input ref={ref} type="text" />;
    }

    const container = document.createElement('div');
    document.body.appendChild(container);
    let root: Root;
    act(() => {
      root = createRoot(container);
      root.render(
        <FilterProvider>
          <Probe />
        </FilterProvider>
      );
    });
    return {
      filtersRef,
      inputRef,
      unmount: () => {
        act(() => root.unmount());
        container.remove();
      },
    };
  }

  afterEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
  });

  it('Cmd+F focuses the search input and suppresses browser find', () => {
    const { inputRef, unmount } = renderHarness();
    let event!: KeyboardEvent;
    act(() => {
      event = keydown({ key: 'f', metaKey: true });
    });
    expect(document.activeElement).toBe(inputRef.current);
    expect(event.defaultPrevented).toBe(true);
    unmount();
  });

  it('unfocused Escape clears an active search; keeps other filters', () => {
    const { filtersRef, unmount } = renderHarness();
    act(() => {
      filtersRef.current.setFilters((prev) => ({ ...prev, search: 'amen', energyMin: 3 }));
    });
    act(() => {
      keydown({ key: 'Escape' });
    });
    expect(filtersRef.current.filters.search).toBe('');
    expect(filtersRef.current.filters.energyMin).toBe(3);
    unmount();
  });

  it('Escape without an active search changes nothing', () => {
    const { filtersRef, unmount } = renderHarness();
    const before = filtersRef.current.filters;
    act(() => {
      keydown({ key: 'Escape' });
    });
    expect(filtersRef.current.filters).toBe(before);
    unmount();
  });

  it('an Escape consumed upstream (stopPropagation, modal-style) never reaches the staged clear', () => {
    const { filtersRef, unmount } = renderHarness();
    act(() => {
      filtersRef.current.setFilters((prev) => ({ ...prev, search: 'amen' }));
    });
    const consume = (e: KeyboardEvent) => {
      if (e.key === 'Escape') e.stopPropagation();
    };
    document.addEventListener('keydown', consume, { capture: true });
    act(() => {
      keydown({ key: 'Escape' });
    });
    document.removeEventListener('keydown', consume, { capture: true });
    expect(filtersRef.current.filters.search).toBe('amen');
    unmount();
  });
});
