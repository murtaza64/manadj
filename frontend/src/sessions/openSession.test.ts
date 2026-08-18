/**
 * Session deep-link store (sessions 04/16): durable selection + one-shot
 * focus moment and zoom request.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  consumeSessionFocus,
  getSelectedSessionUuid,
  requestSessionMoment,
  selectSession,
} from './openSession';

beforeEach(() => {
  vi.stubGlobal('window', { dispatchEvent: () => true });
  selectSession(null);
});

describe('requestSessionMoment / consumeSessionFocus', () => {
  it('stashes the moment + span; consume is one-shot', () => {
    requestSessionMoment({ sessionUuid: 'u1', atS: 1234, spanS: 900 });
    expect(getSelectedSessionUuid()).toBe('u1');
    expect(consumeSessionFocus()).toEqual({ atS: 1234, spanS: 900 });
    // Cleared on read — a second pane mount opens plain.
    expect(consumeSessionFocus()).toEqual({ atS: null, spanS: null });
  });

  it('a request without a span keeps the current zoom (spanS null)', () => {
    requestSessionMoment({ sessionUuid: 'u2', atS: 10 });
    expect(consumeSessionFocus()).toEqual({ atS: 10, spanS: null });
  });

  it('deselecting clears any pending focus', () => {
    requestSessionMoment({ sessionUuid: 'u3', atS: 5, spanS: 900 });
    selectSession(null);
    expect(getSelectedSessionUuid()).toBeNull();
    expect(consumeSessionFocus()).toEqual({ atS: null, spanS: null });
  });
});
