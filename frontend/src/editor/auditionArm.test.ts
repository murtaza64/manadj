/**
 * Audition arm (sets 37): the arm/cancel state machine behind the
 * one-press play on a deferred-open pair. Opening a transition from a set
 * row loads the editor SESSION only; the first play press claims
 * audibility and then this module finishes the gesture — issue whatever
 * deck loads are still missing and fire exactly once when both decks hold
 * the opened pair ready. Cancellation (any other transport gesture,
 * displacement, supersession) must unhook the pending play without
 * revoking loads already issued.
 */
import { describe, expect, it } from 'vitest';
import { armAudition } from './auditionArm';
import type { ArmedEngine } from './auditionArm';

class FakeEngine implements ArmedEngine {
  private listeners = new Set<() => void>();
  trackId: number | null;
  loadState: string;

  constructor(trackId: number | null, loadState: string) {
    this.trackId = trackId;
    this.loadState = loadState;
  }

  getSnapshot() {
    return { trackId: this.trackId, loadState: this.loadState };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  set(trackId: number | null, loadState: string) {
    this.trackId = trackId;
    this.loadState = loadState;
    for (const l of [...this.listeners]) l();
  }

  listenerCount() {
    return this.listeners.size;
  }
}

function harness(a: FakeEngine, b: FakeEngine) {
  const loads: ('A' | 'B')[] = [];
  let readyCount = 0;
  const cancel = armAudition({
    engines: { A: a, B: b },
    targets: { A: 1, B: 2 },
    load: (deck) => loads.push(deck),
    onReady: () => readyCount++,
  });
  return { loads, ready: () => readyCount, cancel };
}

describe('armAudition', () => {
  it('free case: both decks already hold the pair ready → fires synchronously, no loads, returns null', () => {
    const a = new FakeEngine(1, 'ready');
    const b = new FakeEngine(2, 'ready');
    const { loads, ready, cancel } = harness(a, b);
    expect(cancel).toBeNull();
    expect(ready()).toBe(1);
    expect(loads).toEqual([]);
    expect(a.listenerCount()).toBe(0); // nothing left armed
  });

  it('foreign tracks on both decks → loads both, fires once when the second turns ready', () => {
    const a = new FakeEngine(7, 'ready'); // the displaced holder's tracks
    const b = new FakeEngine(8, 'ready');
    const { loads, ready, cancel } = harness(a, b);
    expect(cancel).not.toBeNull();
    expect(loads).toEqual(['A', 'B']);
    a.set(1, 'fetching');
    a.set(1, 'ready');
    expect(ready()).toBe(0); // B still foreign
    b.set(2, 'decoding');
    b.set(2, 'ready');
    expect(ready()).toBe(1);
    // Fulfilment unhooks: further emits never re-fire.
    a.set(1, 'ready');
    b.set(2, 'ready');
    expect(ready()).toBe(1);
    expect(a.listenerCount()).toBe(0);
    expect(b.listenerCount()).toBe(0);
  });

  it('half-free case: one deck holds its target ready → loads only the other', () => {
    const a = new FakeEngine(1, 'ready');
    const b = new FakeEngine(9, 'ready');
    const { loads, ready } = harness(a, b);
    expect(loads).toEqual(['B']);
    b.set(2, 'ready');
    expect(ready()).toBe(1);
  });

  it('a matching load already in flight is not re-requested (re-press must not restart it)', () => {
    const a = new FakeEngine(1, 'fetching');
    const b = new FakeEngine(2, 'decoding');
    const { loads, ready } = harness(a, b);
    expect(loads).toEqual([]);
    a.set(1, 'ready');
    b.set(2, 'ready');
    expect(ready()).toBe(1);
  });

  it('empty and errored decks are (re-)loaded', () => {
    const a = new FakeEngine(null, 'empty');
    const b = new FakeEngine(2, 'error');
    const { loads } = harness(a, b);
    expect(loads).toEqual(['A', 'B']);
  });

  it('cancel unhooks the pending play; loads already issued are not revoked', () => {
    const a = new FakeEngine(7, 'ready');
    const b = new FakeEngine(8, 'ready');
    const { loads, ready, cancel } = harness(a, b);
    expect(loads).toEqual(['A', 'B']);
    cancel?.();
    a.set(1, 'ready');
    b.set(2, 'ready');
    expect(ready()).toBe(0);
    expect(a.listenerCount()).toBe(0);
    expect(b.listenerCount()).toBe(0);
  });

  it('cancel is idempotent', () => {
    const a = new FakeEngine(7, 'ready');
    const b = new FakeEngine(2, 'ready');
    const { cancel } = harness(a, b);
    cancel?.();
    expect(() => cancel?.()).not.toThrow();
  });

  it('a wrong-track ready emit while armed does not fire (track-aware, not loadState-only)', () => {
    const a = new FakeEngine(7, 'ready');
    const b = new FakeEngine(2, 'ready');
    const { ready } = harness(a, b);
    a.set(7, 'ready'); // the foreign track re-emitting ready
    expect(ready()).toBe(0);
    a.set(1, 'ready');
    expect(ready()).toBe(1);
  });
});
