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

describe('jump events (transition-takes 01)', () => {
  it('adding a jump is a real edit: it persists with the transition', () => {
    const p = fakePersistence();
    const store = new EditorStore(p);
    store.loadPair('1:2');
    store.addJump(0.5);
    vi.runAllTimers();
    expect(p.saves).toHaveLength(1);
    expect(p.saves[0].entry!.items[0].transition.jumps).toEqual([{ x: 0.5, deltaSec: 0 }]);
  });

  it('update and remove address jumps by stable index', () => {
    const p = fakePersistence();
    const store = new EditorStore(p);
    store.loadPair('1:2');
    store.addJump(0.75);
    store.addJump(0.25);
    // Updating the FIRST-added jump's x must not re-key the second.
    store.updateJump(0, { deltaSec: -8 });
    store.updateJump(1, { x: 0.3 });
    expect(store.getSnapshot().mix.transition.jumps).toEqual([
      { x: 0.75, deltaSec: -8 },
      { x: 0.3, deltaSec: 0 },
    ]);
    store.removeJump(0);
    expect(store.getSnapshot().mix.transition.jumps).toEqual([{ x: 0.3, deltaSec: 0 }]);
  });

  it('jumps survive the reload round trip (persisted entry → loaded mix)', () => {
    const withJumps: SavedTransition = {
      ...edited('u1'),
      transition: { ...edited('u1').transition, jumps: [{ x: 0.5, deltaSec: -8 }] },
    };
    const p = fakePersistence({ '1:2': { items: [withJumps], active: 0 } });
    const store = new EditorStore(p);
    store.loadPair('1:2');
    expect(store.getSnapshot().mix.transition.jumps).toEqual([{ x: 0.5, deltaSec: -8 }]);
  });

  it('add clamps x into the window (0..1)', () => {
    const p = fakePersistence();
    const store = new EditorStore(p);
    store.loadPair('1:2');
    store.addJump(1.4);
    store.addJump(-0.2);
    expect(store.getSnapshot().mix.transition.jumps).toEqual([
      { x: 1, deltaSec: 0 },
      { x: 0, deltaSec: 0 },
    ]);
  });
});

describe('take drafts (transition-takes 03)', () => {
  const draftTransition = { ...defaultMix().transition, startSec: 60, durationSec: 15 };

  it('stamping a take draft arms no save (browsing costs nothing)', () => {
    const p = fakePersistence();
    const store = new EditorStore(p);
    store.loadPair('1:2');
    store.stampTakeDraft('take-1', draftTransition);
    vi.runAllTimers();
    store.dispose();
    expect(p.saves).toEqual([]);
    expect(store.getSnapshot().mix.transition.startSec).toBe(60);
  });

  it('edits persist the session but never the unpromoted draft', () => {
    const p = fakePersistence({ '1:2': { items: [edited('u1')], active: 0 } });
    const store = new EditorStore(p);
    store.loadPair('1:2');
    store.stampTakeDraft('take-1', draftTransition);
    store.updateMix((m) => ({ ...m, transition: { ...m.transition, durationSec: 30 } }));
    vi.runAllTimers();
    expect(p.saves).toHaveLength(1);
    const items = p.saves[0].entry!.items;
    expect(items.map((i) => i.uuid)).toEqual(['u1']); // draft filtered out
  });

  it('promotion persists the draft (with edits) and reports the reference pair', () => {
    const p = fakePersistence();
    const store = new EditorStore(p);
    store.loadPair('1:2');
    store.stampTakeDraft('take-1', draftTransition);
    store.updateMix((m) => ({ ...m, transition: { ...m.transition, durationSec: 30 } }));
    const ref = store.promoteTakeDraft()!;
    expect(ref.takeUuid).toBe('take-1');
    expect(p.saves.length).toBeGreaterThan(0);
    const items = p.saves[p.saves.length - 1].entry!.items;
    expect(items).toHaveLength(1);
    expect(items[0].uuid).toBe(ref.transitionUuid);
    expect(items[0].transition.durationSec).toBe(30); // tweak-then-promote kept
    expect(store.getSnapshot().takeDraft).toBeNull();
  });

  it('re-stamping on the same pair replaces the draft — no orphan can ride a later save', () => {
    const p = fakePersistence();
    const store = new EditorStore(p);
    store.loadPair('1:2');
    store.stampTakeDraft('take-1', draftTransition);
    store.stampTakeDraft('take-1', { ...draftTransition, startSec: 90 }); // re-open
    store.updateMix((m) => ({ ...m, transition: { ...m.transition, durationSec: 30 } }));
    vi.runAllTimers();
    // The armed save carries NOTHING (only the single live draft existed).
    expect(p.saves.map((s) => s.entry)).toEqual([null]);
    expect(store.getSnapshot().session.items.filter((i) => i.name === 'Take')).toHaveLength(1);
  });

  it('deleting the draft item drops the review reference (no dangling promotion)', () => {
    const p = fakePersistence();
    const store = new EditorStore(p);
    store.loadPair('1:2');
    store.stampTakeDraft('take-1', draftTransition);
    store.deleteActive(); // the draft is the active item
    expect(store.getSnapshot().takeDraft).toBeNull();
    expect(store.promoteTakeDraft()).toBeNull();
  });

  it('leaving the pair evaporates an unpromoted draft', () => {
    const p = fakePersistence();
    const store = new EditorStore(p);
    store.loadPair('1:2');
    store.stampTakeDraft('take-1', draftTransition);
    store.loadPair('3:4');
    vi.runAllTimers();
    expect(p.saves).toEqual([]);
    expect(store.getSnapshot().takeDraft).toBeNull();
  });

  it('selectTransition switches the active item without arming a save', () => {
    const p = fakePersistence({
      '1:2': { items: [edited('u1'), edited('u2', 'other')], active: 0 },
    });
    const store = new EditorStore(p);
    store.loadPair('1:2');
    store.selectTransition('u2');
    expect(store.getSnapshot().session.active).toBe(1);
    vi.runAllTimers();
    expect(p.saves).toEqual([]);
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

describe('stampTemplate (mix-editor 03)', () => {
  const patch = {
    tempoMatch: true as const,
    lanes: { eqLowA: [{ x: 0, y: 0.5 }] },
    hiddenLanes: [],
    startSec: 80,
    durationSec: 32,
    bInSec: 14.7,
  };

  it('stamps a pristine session in place, renames it, and arms persistence', () => {
    const p = fakePersistence();
    const store = new EditorStore(p);
    store.loadPair('1:2');
    store.stampTemplate('bass swap', patch);
    const s = store.getSnapshot();
    expect(s.session.items).toHaveLength(1);
    expect(s.session.items[0].name).toBe('bass swap');
    expect(s.mix.transition.startSec).toBe(80); // mix follows the stamp
    vi.runAllTimers();
    expect(p.saves).toHaveLength(1); // a template apply is a real edit
    expect(p.saves[0].entry!.items[0].name).toBe('bass swap');
  });

  it('creates a new take when the active Transition has real edits', () => {
    const p = fakePersistence({ '1:2': { items: [edited('u1')], active: 0 } });
    const store = new EditorStore(p);
    store.loadPair('1:2');
    store.stampTemplate('bass swap', patch);
    const s = store.getSnapshot();
    expect(s.session.items).toHaveLength(2);
    expect(s.session.active).toBe(1);
    expect(s.session.items[0].name).toBe('drop swap'); // hand-drawn untouched
    expect(s.session.items[1].name).toBe('bass swap');
  });
});
