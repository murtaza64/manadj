import { afterEach, expect, it, vi } from 'vitest';
import { presentationOf } from './presentationStore';

afterEach(() => vi.useRealTimers());

it('keeps domain edges immediate while publishing all UI snapshots together in a later task', async () => {
  vi.useFakeTimers();
  const makeSource = () => {
    let snapshot = 0;
    const listeners = new Set<() => void>();
    return {
      getSnapshot: () => snapshot,
      subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
      set: (next: number) => { snapshot = next; for (const listener of listeners) listener(); },
    };
  };
  const a = makeSource(), b = makeSource();
  const uiA = presentationOf(a), uiB = presentationOf(b);
  const domain: number[] = [], views: number[][] = [];
  const domainOff = a.subscribe(() => domain.push(a.getSnapshot()));
  const offA = uiA.subscribe(() => views.push([uiA.getSnapshot(), uiB.getSnapshot()]));
  const offB = uiB.subscribe(() => views.push([uiA.getSnapshot(), uiB.getSnapshot()]));
  try {
    a.set(1); a.set(2); b.set(3);
    expect(domain).toEqual([1, 2]);
    await Promise.resolve(); // A microtask must not publish before the next input task.
    expect(uiA.getSnapshot()).toBe(0);
    expect(uiB.getSnapshot()).toBe(0);
    expect(views).toEqual([]);
    vi.runOnlyPendingTimers();
    expect(views).toEqual([[2, 3], [2, 3]]);
    expect(presentationOf(a)).toBe(uiA);
    a.set(4);
    offA();
    vi.runOnlyPendingTimers();
    expect(views).toHaveLength(2);
    const remount = uiA.subscribe(() => {});
    expect(uiA.getSnapshot()).toBe(4);
    remount();
  } finally { offA(); offB(); domainOff(); }
});
