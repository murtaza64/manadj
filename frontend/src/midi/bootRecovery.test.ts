// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { shouldReloadForBootRecovery } from './bootRecovery';

const due = { attemptsMade: 3, reloadAfterAttempts: 3, alreadyReloaded: false, feedbackActive: false };

describe('boot recovery reload decision', () => {
  it('reloads once failures reach the threshold', () => {
    expect(shouldReloadForBootRecovery(due)).toBe(true);
  });

  it('waits below the threshold', () => {
    expect(shouldReloadForBootRecovery({ ...due, attemptsMade: 2 })).toBe(false);
  });

  it('never reloads twice in one session', () => {
    expect(shouldReloadForBootRecovery({ ...due, alreadyReloaded: true })).toBe(false);
  });

  it('never reloads while a feedback session or retained draft is active', () => {
    expect(shouldReloadForBootRecovery({ ...due, feedbackActive: true })).toBe(false);
  });

  it('stays due after feedback ends, so the deferred reload fires on the next failure', () => {
    // Same failure, evaluated again once the session is over: the guard
    // cleared, the reload goes ahead. This is what makes suppression a
    // deferral rather than a dropped recovery.
    expect(shouldReloadForBootRecovery({ ...due, attemptsMade: 4, feedbackActive: true })).toBe(false);
    expect(shouldReloadForBootRecovery({ ...due, attemptsMade: 4 })).toBe(true);
  });
});
