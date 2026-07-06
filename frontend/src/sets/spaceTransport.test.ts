/**
 * Space-driven mix-level transport (sets 34) — the priority resolution
 * and the dispatch's claim/decline contract.
 *
 * The verb ladder is deliberate policy: pickup OUTRANKS play-from-start
 * because mid-flow recovery is common and accidentally restarting a
 * two-hour set is the worse failure.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { selectSet } from './setStore';
import {
  _resetSetSpaceAdapterForTests,
  dispatchSetSpace,
  registerSetSpaceAdapter,
  resolveSetSpaceVerb,
} from './spaceTransport';

describe('resolveSetSpaceVerb (the priority order)', () => {
  it('conducting → pause, regardless of pickup', () => {
    expect(resolveSetSpaceVerb('playing', false)).toBe('pause');
    expect(resolveSetSpaceVerb('playing', true)).toBe('pause');
  });

  it('paused mid-set → resume, regardless of pickup', () => {
    expect(resolveSetSpaceVerb('paused', false)).toBe('resume');
    expect(resolveSetSpaceVerb('paused', true)).toBe('resume');
  });

  it('stopped with Pickup lit → pick up (pickup outranks restart)', () => {
    expect(resolveSetSpaceVerb('idle', true)).toBe('pickup');
  });

  it('stopped, Pickup unlit → play from start', () => {
    expect(resolveSetSpaceVerb('idle', false)).toBe('play-from-start');
  });
});

describe('dispatchSetSpace (claim/decline)', () => {
  beforeEach(() => {
    _resetSetSpaceAdapterForTests();
    selectSet(null);
  });

  afterEach(() => {
    _resetSetSpaceAdapterForTests();
    selectSet(null);
  });

  it('declines when no Set is selected — callers keep their legacy behavior', () => {
    expect(dispatchSetSpace()).toBe(false);
  });

  it('claims the key while a Set is selected even before the adapter exists (never falls through to a deck toggle)', () => {
    selectSet(1);
    expect(dispatchSetSpace()).toBe(true);
  });

  it('idle + pickup lit → executes pickup, never play-from-start', () => {
    selectSet(1);
    const calls: string[] = [];
    registerSetSpaceAdapter({
      isPickupLit: () => true,
      pickup: () => calls.push('pickup'),
      playFromStart: () => calls.push('play-from-start'),
    });
    expect(dispatchSetSpace()).toBe(true);
    expect(calls).toEqual(['pickup']);
  });

  it('idle + pickup unlit → play from start', () => {
    selectSet(1);
    const calls: string[] = [];
    registerSetSpaceAdapter({
      isPickupLit: () => false,
      pickup: () => calls.push('pickup'),
      playFromStart: () => calls.push('play-from-start'),
    });
    expect(dispatchSetSpace()).toBe(true);
    expect(calls).toEqual(['play-from-start']);
  });

  it('unregistering the adapter (Set deselected/unmounted) leaves the claim decision to the selection alone', () => {
    selectSet(1);
    const calls: string[] = [];
    const unregister = registerSetSpaceAdapter({
      isPickupLit: () => false,
      pickup: () => calls.push('pickup'),
      playFromStart: () => calls.push('play-from-start'),
    });
    unregister();
    expect(dispatchSetSpace()).toBe(true); // still claimed (Set selected)
    expect(calls).toEqual([]); // but nothing to execute
  });
});
