import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetTakeoverFeedbackForTests,
  reportPickedUp,
  reportSuppressed,
  subscribeTakeoverHints,
  takeoverHint,
  takeoverKey,
  TAKEOVER_HINT_DECAY_MS,
} from './takeoverFeedback';

/**
 * Soft-takeover feedback store (midi-controller 18): hints appear on
 * suppressed hardware moves, point toward the software value, and end on
 * pickup or decay.
 */

describe('takeoverFeedback', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    _resetTakeoverFeedbackForTests();
    vi.useRealTimers();
  });

  it('a suppressed report shows a directional hint; pickup clears it', () => {
    const key = takeoverKey.pitch('A');
    expect(takeoverHint(key)).toBeNull();
    reportSuppressed(key, 'up');
    expect(takeoverHint(key)).toBe('up');
    reportPickedUp(key);
    expect(takeoverHint(key)).toBeNull();
  });

  it('hints decay after the hand stops moving', () => {
    const key = takeoverKey.trim('B');
    reportSuppressed(key, 'down');
    vi.advanceTimersByTime(TAKEOVER_HINT_DECAY_MS - 1);
    expect(takeoverHint(key)).toBe('down');
    vi.advanceTimersByTime(1);
    expect(takeoverHint(key)).toBeNull();
  });

  it('each suppressed report restarts the decay clock', () => {
    const key = takeoverKey.master();
    reportSuppressed(key, 'up');
    vi.advanceTimersByTime(TAKEOVER_HINT_DECAY_MS - 100);
    reportSuppressed(key, 'up'); // still reaching
    vi.advanceTimersByTime(TAKEOVER_HINT_DECAY_MS - 100);
    expect(takeoverHint(key)).toBe('up');
    vi.advanceTimersByTime(100);
    expect(takeoverHint(key)).toBeNull();
  });

  it('notifies on appear, direction change, pickup, and decay — not on same-direction refreshes', () => {
    const key = takeoverKey.crossfader();
    let fired = 0;
    subscribeTakeoverHints(() => fired++);
    reportSuppressed(key, 'up'); // appear
    expect(fired).toBe(1);
    reportSuppressed(key, 'up'); // refresh, same direction
    expect(fired).toBe(1);
    reportSuppressed(key, 'down'); // overshot: direction flips
    expect(fired).toBe(2);
    reportPickedUp(key);
    expect(fired).toBe(3);
    reportPickedUp(key); // idempotent: nothing to clear
    expect(fired).toBe(3);
    reportSuppressed(key, 'up');
    vi.advanceTimersByTime(TAKEOVER_HINT_DECAY_MS);
    expect(fired).toBe(5); // appear + decay-clear
  });

  it('hints are per control key', () => {
    reportSuppressed(takeoverKey.eq('A', 'low'), 'up');
    expect(takeoverHint(takeoverKey.eq('A', 'low'))).toBe('up');
    expect(takeoverHint(takeoverKey.eq('A', 'mid'))).toBeNull();
    expect(takeoverHint(takeoverKey.eq('B', 'low'))).toBeNull();
  });
});
