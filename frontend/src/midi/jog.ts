/**
 * Jog wheel behavior (midi-controller 03/11): relative ticks in, bend or
 * seek out. Pure math + a small stateful controller; no Web MIDI, no React
 * — the registrar builds one per deck over the engine, dispatch feeds it
 * ticks, tests feed it synthetic ticks and a fake port.
 *
 * Playing (rim): Mixxx's nudge model (RateControl::getJogFactor +
 * Rotary(25), ported): ticks accumulate; every filter period the
 * accumulator drains into a moving-average window whose value (× gain,
 * clamped) is the bend. Spring-back is inherent — when rotation stops, the
 * window empties slot by slot and the bend decays to exactly zero, no idle
 * cliff. setBend(0) restores the pitch-only rate exactly.
 *
 * Paused: rim ticks seek with velocity-sensitive acceleration (hard spins
 * travel far); touch-surface ticks seek finely and linearly, and rim ticks
 * that continue a touch gesture (a released, still-spinning platter) keep
 * the fine rate (issue 11).
 */

export interface JogDeckPort {
  isPlaying(): boolean;
  getPlayhead(): number;
  seek(seconds: number): void;
  setBend(percent: number): void;
}

/**
 * Bend filter (Mixxx prior art): the engine drains its jog accumulator
 * every audio buffer (~23ms) into a 25-slot moving average and adds
 * `avg × 0.1` to the playback rate. We mirror it on a 25ms timer with a
 * 20-slot window (~0.5s spring-back) and a gain in percent.
 */
export const JOG_BEND_FILTER_PERIOD_MS = 25;
export const JOG_BEND_FILTER_WINDOW = 20;
/** Percent bend per average tick-per-period (Mixxx jogSensitivity 0.1 of
 * rate ≈ 10%); clamped to ±JOG_BEND_MAX_PERCENT. */
export const JOG_BEND_PERCENT_PER_TICK = 10;
export const JOG_BEND_MAX_PERCENT = 8;

/** Paused seek (rim): seconds per tick at rest, accelerated quadratically. */
export const JOG_SEEK_SECONDS_PER_TICK = 0.05;
export const JOG_SEEK_ACCEL_TPS = 50;
export const JOG_SEEK_ACCEL_MAX = 100;

/**
 * Paused seek (touch surface, midi-controller 11): strictly linear seconds
 * per tick. The touch stream is dense (the rim only ticks past a speed
 * threshold — the hardware finding that motivated this surface), so fine
 * placement needs predictability, not reach; hard travel stays the rim's
 * job.
 */
export const JOG_TOUCH_SEEK_SECONDS_PER_TICK = 0.01;

/**
 * Release continuation (issue 11 follow-up): letting go of a spinning
 * platter hands the tick stream from the touch CC to the rim CC — the
 * gesture is still the same spin, so rim ticks within this window of the
 * last fine-rate seek keep the same seconds-per-tick (and extend the
 * window), instead of snapping to the rim's accelerated seek. A gap ends
 * the gesture; the next rim gesture is classic accelerated seek.
 *
 * The streams don't need deduping: the hardware sends #0x0A while touched
 * and #0x09 while released, never both (hardware-verified — an earlier
 * drop-window "guard" here only produced a dead gap on release; Mixxx's
 * mapping relies on the same exclusivity).
 */
export const JOG_FINE_CONTINUATION_MS = 250;

/** Rate smoothing (paused rim seek): how much of the instantaneous rate
 * each burst carries. */
const RATE_BLEND = 0.6;
/** dt clamp bounds (ms): messages closer than MIN share a burst; a gap
 * beyond MAX starts fresh instead of diluting the rate toward zero. */
const DT_MIN_MS = 5;
const DT_MAX_MS = 250;

/** Signed smoothed rotation rate in ticks/second, folded per tick event. */
export function smoothedRate(prevRate: number, ticks: number, dtMs: number): number {
  const dt = Math.min(Math.max(dtMs, DT_MIN_MS), DT_MAX_MS);
  const instantaneous = (ticks * 1000) / dt;
  return RATE_BLEND * instantaneous + (1 - RATE_BLEND) * prevRate;
}

/** Bend for a window-average of ticks-per-period: linear, clamped. */
export function bendFromWindowAverage(averageTicksPerPeriod: number): number {
  const bend = averageTicksPerPeriod * JOG_BEND_PERCENT_PER_TICK;
  return Math.min(Math.max(bend, -JOG_BEND_MAX_PERCENT), JOG_BEND_MAX_PERCENT);
}

/** Seek travel for a paused deck (rim): per-tick base, quadratic in rate. */
export function jogSeekDelta(ticks: number, rate: number): number {
  const accel = 1 + (Math.abs(rate) / JOG_SEEK_ACCEL_TPS) ** 2;
  return ticks * JOG_SEEK_SECONDS_PER_TICK * Math.min(accel, JOG_SEEK_ACCEL_MAX);
}

export class JogController {
  private readonly port: JogDeckPort;
  private rate = 0;
  private lastTickMs: number | null = null;
  /** Last fine-rate seek — touch tick or continuation rim tick. */
  private lastFineActivityMs: number | null = null;

  // Bend filter state (Mixxx model).
  private pendingBendTicks = 0;
  private bendWindow: number[] = new Array<number>(JOG_BEND_FILTER_WINDOW).fill(0);
  private bendHead = 0;
  private bendTimer: ReturnType<typeof setInterval> | null = null;
  private appliedBend = 0;

  constructor(port: JogDeckPort) {
    this.port = port;
  }

  /**
   * Touch-surface rotation (CC #10): fine linear seek on a paused deck;
   * ignored while playing — there is no scratch model, and the dense touch
   * stream would swamp the rim's bend filter.
   */
  onTouchTicks(ticks: number, nowMs: number = performance.now()): void {
    if (this.port.isPlaying()) return;
    this.lastFineActivityMs = nowMs;
    this.port.seek(this.port.getPlayhead() + ticks * JOG_TOUCH_SEEK_SECONDS_PER_TICK);
  }

  /** Rim rotation (CC #9): bend when playing, accelerated seek when paused
   * — unless the ticks continue a touch gesture (a released, still-spinning
   * platter), which keeps the fine rate. */
  onTicks(ticks: number, nowMs: number = performance.now()): void {
    const dtMs = this.lastTickMs === null ? DT_MAX_MS : nowMs - this.lastTickMs;
    // A gap past the activity window is a fresh gesture, not a continuation.
    this.rate = smoothedRate(dtMs > DT_MAX_MS ? 0 : this.rate, ticks, dtMs);
    this.lastTickMs = nowMs;

    if (this.port.isPlaying()) {
      this.pendingBendTicks += ticks;
      this.startBendFilter();
      return;
    }

    this.releaseBend(); // mode flip mid-gesture: never leave a stale bend

    // Released but still spinning: same gesture, same seconds-per-tick.
    if (this.lastFineActivityMs !== null && nowMs - this.lastFineActivityMs < JOG_FINE_CONTINUATION_MS) {
      this.lastFineActivityMs = nowMs;
      this.port.seek(this.port.getPlayhead() + ticks * JOG_TOUCH_SEEK_SECONDS_PER_TICK);
      return;
    }

    this.port.seek(this.port.getPlayhead() + jogSeekDelta(ticks, this.rate));
  }

  /** Detach hook for the registrar: release any held bend immediately. */
  dispose(): void {
    this.releaseBend();
  }

  private startBendFilter(): void {
    if (this.bendTimer !== null) return;
    this.bendTimer = setInterval(() => this.onBendPeriod(), JOG_BEND_FILTER_PERIOD_MS);
  }

  private onBendPeriod(): void {
    // Drain the accumulator into the window (Mixxx: getJogFactor per buffer).
    this.bendWindow[this.bendHead] = this.pendingBendTicks;
    this.pendingBendTicks = 0;
    this.bendHead = (this.bendHead + 1) % JOG_BEND_FILTER_WINDOW;

    let sum = 0;
    for (const slot of this.bendWindow) sum += slot;
    const bend = bendFromWindowAverage(sum / JOG_BEND_FILTER_WINDOW);
    this.applyBend(bend);

    // Window empty and nothing pending: the gesture has fully decayed.
    if (sum === 0 && this.pendingBendTicks === 0) this.stopBendFilter();
  }

  private applyBend(bend: number): void {
    if (bend === this.appliedBend) return; // don't spam the engine
    this.appliedBend = bend;
    this.port.setBend(bend);
  }

  private stopBendFilter(): void {
    if (this.bendTimer === null) return;
    clearInterval(this.bendTimer);
    this.bendTimer = null;
  }

  private releaseBend(): void {
    this.stopBendFilter();
    this.pendingBendTicks = 0;
    this.bendWindow.fill(0);
    this.applyBend(0);
  }
}
