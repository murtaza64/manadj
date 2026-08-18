/**
 * Session lifecycle: the ten-minute silence split (sessions 11).
 *
 * The Sessions design originally made a Session one recorder lifetime with
 * no boundary heuristics (ADR 0033). Amended: ten continuous minutes with
 * no Master-audible Deck END the current Session; the next Session opens
 * lazily on the first Master-audible instant. This module is the pure
 * fake-clock seam — no timers, no I/O, no deck state. The recorder supplies
 * both: it derives Master-audibility from the detector's state (the one
 * audibility definition, capture/audibility.ts) and feeds observations on
 * the capture clock (event timestamps, plus its ~1 Hz timer during machine
 * tenures, when no events ride the log but the tenure is inactivity).
 */

/** Ten continuous minutes of silence end the Session (sessions 11). */
export const SILENCE_SPLIT_S = 600;

/**
 * Fires exactly once per silence period, at the instant continuous silence
 * reaches the threshold. Audibility resets the full clock and re-arms it.
 * The clock is deliberately ignorant of whether a Session row is open —
 * firing while dormant is the caller's no-op (`SessionSink.split()` on a
 * rowless sink closes nothing).
 */
export class SilenceSplitClock {
  /** Capture-clock instant this silence period began; null while audible. */
  private silentSince: number | null;
  /** Fired for the current silence period — dormant until audibility. */
  private fired = false;
  private readonly thresholdS: number;

  constructor(startT: number, thresholdS: number = SILENCE_SPLIT_S) {
    // Boot counts as the start of a silence period: a recorder started and
    // left silent splits (a no-op while no Session is open) rather than
    // holding a stale pre-boot clock.
    this.silentSince = startT;
    this.thresholdS = thresholdS;
  }

  /**
   * One observation: is any Deck Master-audible at capture time `t`?
   * Returns true exactly once, when continuous silence reaches the
   * threshold.
   */
  note(anyAudible: boolean, t: number): boolean {
    if (anyAudible) {
      this.silentSince = null;
      this.fired = false;
      return false;
    }
    if (this.silentSince === null) this.silentSince = t;
    if (!this.fired && t - this.silentSince >= this.thresholdS) {
      this.fired = true;
      return true;
    }
    return false;
  }
}
