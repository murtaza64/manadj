// @vitest-environment jsdom
/**
 * Pair-edit handoff (sets 09): request/consume is one-shot and the event
 * fires so App/editor listeners can react.
 */
import { describe, expect, it, vi } from 'vitest';
import { OPEN_PAIR_EVENT, consumePairEdit, requestPairEdit } from './openPair';

describe('pair-edit handoff', () => {
  it('delivers the pending request exactly once', () => {
    requestPairEdit({ aTrackId: 1, bTrackId: 2, transitionUuid: 'u1' });
    expect(consumePairEdit()).toEqual({ aTrackId: 1, bTrackId: 2, transitionUuid: 'u1' });
    expect(consumePairEdit()).toBeNull();
  });

  it('dispatches the window event on request', () => {
    const seen = vi.fn();
    window.addEventListener(OPEN_PAIR_EVENT, seen);
    requestPairEdit({ aTrackId: 3, bTrackId: 4, transitionUuid: null });
    expect(seen).toHaveBeenCalledTimes(1);
    window.removeEventListener(OPEN_PAIR_EVENT, seen);
    consumePairEdit(); // drain for other tests
  });

  it('a later request replaces an unconsumed earlier one', () => {
    requestPairEdit({ aTrackId: 1, bTrackId: 2, transitionUuid: null });
    requestPairEdit({ aTrackId: 5, bTrackId: 6, transitionUuid: 'u9' });
    expect(consumePairEdit()).toEqual({ aTrackId: 5, bTrackId: 6, transitionUuid: 'u9' });
  });
});
