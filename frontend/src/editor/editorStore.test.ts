/**
 * Editor store (mix-editor 27): the session/persistence wiring that was
 * previously only exercised by hand — including the 2026-07-04 incident
 * (issue 26 comments) as a permanent regression test. Fake persistence +
 * fake timers; no DOM, no audio.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorStore } from './editorStore';
import { defaultMix } from './mixModel';
import type { PairEntry, SavedTransition } from './pairStore';

function fakePersistence(initial: Record<string, PairEntry> = {}) {
  const data = new Map(Object.entries(initial));
  const saves: { pairKey: string; entry: PairEntry | null }[] = [];
  return {
    saves,
    data,
    load: (key: string) => data.get(key),
    save: (pairKey: string, entry: PairEntry | null) => {
      saves.push({ pairKey, entry: entry ? structuredClone(entry) : null });
      if (entry) data.set(pairKey, entry);
      else data.delete(pairKey);
    },
  };
}

const edited = (uuid: string, name = 'drop swap'): SavedTransition => ({
  uuid,
  name,
  favorite: false,
  transition: { ...defaultMix().transition, durationSec: 8 },
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('the incident: merely opening pairs never writes', () => {
  it('loadPair then immediate switch materializes no save (and no delete)', () => {
    const p = fakePersistence({ '1:2': { items: [edited('u1')], active: 0 } });
    const store = new EditorStore(p);
    store.loadPair('1:2');
    store.loadPair('3:4'); // switch away with zero mutations
    vi.runAllTimers();
    store.dispose();
    expect(p.saves).toEqual([]); // '1:2' untouched — the incident wrote a delete here
    expect(p.data.get('1:2')).toBeDefined();
  });

  it('a pristine-only session saves nothing, ever', () => {
    const p = fakePersistence();
    const store = new EditorStore(p);
    store.loadPair('1:2');
    vi.runAllTimers();
    store.dispose();
    expect(p.saves).toEqual([]);
  });
});

describe('flush-before-repoint', () => {
  it('pending edits flush to the PREVIOUS pair before the next seeds', () => {
    const p = fakePersistence();
    const store = new EditorStore(p);
    store.loadPair('1:2');
    store.updateMix((m) => ({ ...m, transition: { ...m.transition, durationSec: 8 } }));
    store.loadPair('3:4'); // switch inside the debounce window
    expect(p.saves).toHaveLength(1);
    expect(p.saves[0].pairKey).toBe('1:2');
    expect(p.saves[0].entry!.items[0].transition.durationSec).toBe(8);
    vi.runAllTimers();
    expect(p.saves).toHaveLength(1); // nothing armed for 3:4
  });

  it('editing the loaded pair to all-pristine deletes it (explicit act, not a race)', () => {
    const p = fakePersistence({ '1:2': { items: [edited('u1')], active: 0 } });
    const store = new EditorStore(p);
    store.loadPair('1:2');
    store.deleteActive(); // delete the only saved item → fresh pristine session
    vi.runAllTimers();
    expect(p.saves).toEqual([{ pairKey: '1:2', entry: null }]);
  });
});

describe('debounce and dispose', () => {
  it('rapid mutations coalesce into one save', () => {
    const p = fakePersistence();
    const store = new EditorStore(p);
    store.loadPair('1:2');
    for (let i = 1; i <= 20; i++) {
      store.updateMix((m) => ({ ...m, transition: { ...m.transition, startSec: 30 + i } }));
    }
    expect(p.saves).toHaveLength(0);
    vi.advanceTimersByTime(300);
    expect(p.saves).toHaveLength(1);
    expect(p.saves[0].entry!.items[0].transition.startSec).toBe(50);
  });

  it('dispose flushes the tail', () => {
    const p = fakePersistence();
    const store = new EditorStore(p);
    store.loadPair('1:2');
    store.renameActive('bass swap');
    store.dispose();
    expect(p.saves).toHaveLength(1);
    expect(p.saves[0].entry!.items[0].name).toBe('bass swap');
  });

  it('mutations without a loaded pair never arm a save', () => {
    const p = fakePersistence();
    const store = new EditorStore(p);
    store.updateMix((m) => ({ ...m, transition: { ...m.transition, durationSec: 9 } }));
    vi.runAllTimers();
    store.dispose();
    expect(p.saves).toEqual([]);
  });
});

describe('session semantics (ported behavior)', () => {
  it('seeds from the stored entry, clamping a stale active', () => {
    const p = fakePersistence({
      '1:2': { items: [edited('u1'), edited('u2', 'other')], active: 7 },
    });
    const store = new EditorStore(p);
    store.loadPair('1:2');
    const s = store.getSnapshot();
    expect(s.session.items.map((i) => i.uuid)).toEqual(['u1', 'u2']);
    expect(s.session.active).toBe(1);
    expect(s.mix.transition.durationSec).toBe(8);
  });

  it('▶ past the end creates a fresh pristine take; leaving it evaporates it', () => {
    const p = fakePersistence({ '1:2': { items: [edited('u1')], active: 0 } });
    const store = new EditorStore(p);
    store.loadPair('1:2');
    store.navigateTransition(1); // new pristine take
    expect(store.getSnapshot().session.items).toHaveLength(2);
    expect(store.getSnapshot().session.active).toBe(1);
    store.navigateTransition(-1); // leave it untouched → evaporates
    expect(store.getSnapshot().session.items).toHaveLength(1);
    expect(store.getSnapshot().session.active).toBe(0);
  });

  it('▶ past the end is a no-op when the current take is already fresh', () => {
    const p = fakePersistence();
    const store = new EditorStore(p);
    store.loadPair('1:2');
    store.navigateTransition(1);
    expect(store.getSnapshot().session.items).toHaveLength(1);
  });

  it('delete lands on the next item; deleting the last re-inits blank', () => {
    const p = fakePersistence({
      '1:2': { items: [edited('u1'), edited('u2', 'other')], active: 0 },
    });
    const store = new EditorStore(p);
    store.loadPair('1:2');
    store.deleteActive();
    expect(store.getSnapshot().session.items.map((i) => i.uuid)).toEqual(['u2']);
    store.deleteActive();
    const s = store.getSnapshot();
    expect(s.session.items).toHaveLength(1);
    expect(s.session.items[0].name).toBe('Transition 1'); // fresh pristine
  });

  it('rename trims and ignores empty; favorite toggles', () => {
    const p = fakePersistence({ '1:2': { items: [edited('u1')], active: 0 } });
    const store = new EditorStore(p);
    store.loadPair('1:2');
    store.renameActive('  ');
    expect(store.getSnapshot().session.items[0].name).toBe('drop swap');
    store.renameActive('  double drop ');
    expect(store.getSnapshot().session.items[0].name).toBe('double drop');
    store.toggleFavorite();
    expect(store.getSnapshot().session.items[0].favorite).toBe(true);
  });

  it('fires onTransitionLoaded on pair load and session switches', () => {
    const p = fakePersistence({ '1:2': { items: [edited('u1')], active: 0 } });
    const store = new EditorStore(p);
    const loads: number[] = [];
    store.setTransitionLoadedHandler((t) => loads.push(t.durationSec));
    store.loadPair('1:2');
    store.navigateTransition(1); // fresh take (default duration)
    expect(loads).toEqual([8, defaultMix().transition.durationSec]);
  });
});

describe('view toggles', () => {
  it('snap/lock changes never arm a save', () => {
    const p = fakePersistence();
    const store = new EditorStore(p);
    store.loadPair('1:2');
    store.setSnap(false);
    store.toggleLockedWindow();
    vi.runAllTimers();
    store.dispose();
    expect(p.saves).toEqual([]);
    expect(store.getSnapshot().snap).toBe(false);
    expect(store.getSnapshot().lockedWindow).toBe(true);
  });
});
