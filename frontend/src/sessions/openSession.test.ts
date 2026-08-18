/**
 * Session deep-link store (sessions 04/16, perf-layout 09): durable
 * selection + peeked focus moment with a version — keep-alive panes stay
 * mounted, so focus is re-applied on version bumps rather than consumed
 * once (a clearing read would race the two mounted Library instances).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getSelectedSessionUuid,
  peekSessionFocus,
  requestSessionMoment,
  selectSession,
} from './openSession';

beforeEach(() => {
  vi.stubGlobal('window', { dispatchEvent: () => true });
  selectSession(null);
});

describe('requestSessionMoment / peekSessionFocus', () => {
  it('stashes the moment + span; peek does NOT clear (both panes may read)', () => {
    const v0 = peekSessionFocus().version;
    requestSessionMoment({ sessionUuid: 'u1', atS: 1234, spanS: 900 });
    expect(getSelectedSessionUuid()).toBe('u1');
    const first = peekSessionFocus();
    expect(first).toMatchObject({ atS: 1234, spanS: 900 });
    expect(first.version).toBe(v0 + 1);
    // Second reader (the other mounted Library instance) sees the same.
    expect(peekSessionFocus()).toEqual(first);
  });

  it('every request bumps the version — kept-alive panes re-focus on it', () => {
    requestSessionMoment({ sessionUuid: 'u1', atS: 10 });
    const a = peekSessionFocus();
    requestSessionMoment({ sessionUuid: 'u1', atS: 10 }); // SAME moment again
    const b = peekSessionFocus();
    expect(b.atS).toBe(10);
    expect(b.version).toBe(a.version + 1); // still re-applies
  });

  it('a request without a span keeps the current zoom (spanS null)', () => {
    requestSessionMoment({ sessionUuid: 'u2', atS: 10 });
    expect(peekSessionFocus()).toMatchObject({ atS: 10, spanS: null });
  });

  it('deselecting clears the pending focus values', () => {
    requestSessionMoment({ sessionUuid: 'u3', atS: 5, spanS: 900 });
    selectSession(null);
    expect(getSelectedSessionUuid()).toBeNull();
    expect(peekSessionFocus()).toMatchObject({ atS: null, spanS: null });
  });
});
