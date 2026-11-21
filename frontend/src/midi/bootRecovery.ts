/**
 * Boot-recovery reload decision (midi-boot-retry 01, feedback #518): the
 * pure half of the adapter's one-shot recovery reload, kept behind a
 * tested seam so the adapter itself stays hands-on-hardware verified per
 * ADR 0002 (no Web MIDI mocking). The adapter re-evaluates this on every
 * dead boot attempt, so a reload suppressed by an active feedback session
 * (or a retained draft) is deferred to the next failed attempt after that
 * session ends — never dropped, never fired mid-draft.
 */
export function shouldReloadForBootRecovery({
  attemptsMade,
  reloadAfterAttempts,
  alreadyReloaded,
  feedbackActive,
}: {
  /** Boot attempts that have now failed (1-based count). */
  attemptsMade: number;
  /** Failure count at which recovery reload becomes due. */
  reloadAfterAttempts: number;
  /** The one-shot sessionStorage flag already consumed this session. */
  alreadyReloaded: boolean;
  /** documentElement.dataset.feedbackActive === 'true'. */
  feedbackActive: boolean;
}): boolean {
  return attemptsMade >= reloadAfterAttempts && !alreadyReloaded && !feedbackActive;
}
