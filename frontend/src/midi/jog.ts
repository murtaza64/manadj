/**
 * Jog wheel behavior (midi-controller 03): relative ticks in, bend or seek
 * out. Pure math + a small stateful controller; no Web MIDI, no React —
 * the registrar builds one per deck over the engine, dispatch feeds it
 * ticks, tests feed it synthetic ticks and a fake port.
 *
 * Two modes, decided per tick burst by the deck's transport state:
 * - Playing: rotation drives the engine's bend API (Nudge, widened for
 *   impulse-driven bend). A rotation-activity window replaces key-up —
 *   when ticks stop, bend returns to zero and pitch is restored exactly
 *   (setBend(0); bend never touches pitch).
 * - Paused: velocity-sensitive seek — slow single ticks give beat-level
 *   placement, hard spins traverse minutes.
 *
 * Constants are first-guess tunables pending the hardware session; the
 * shapes (linear bend in rate, quadratic seek acceleration) are the tested
 * contract.
 */

export interface JogDeckPort {
  isPlaying(): boolean;
  getPlayhead(): number;
  seek(seconds: number): void;
  setBend(percent: number): void;
}

/** Bend released this long after the last tick (the "activity window"). */
export const JOG_IDLE_MS = 150;

/** Bend percent per tick/second of rotation; clamped to ±JOG_BEND_MAX. */
export const JOG_BEND_PERCENT_PER_TPS = 0.02;
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
 * platter hands the tick stream from the touch CC back to the rim CC — the
 * gesture is still the same spin, so it must keep the same fine
 * seconds-per-tick instead of snapping to the rim's accelerated seek.
 *
 * - While touch ticks are streaming, rim ticks are dropped entirely (both
 *   CCs can fire for one physical motion; the touch stream is
 *   authoritative).
 * - After the touch stream stops, rim ticks within the continuation window
 *   seek at the touch rate and keep the window alive, so a free-spinning
 *   wheel stays fine until it actually stops.
 * - A gap ends the gesture; the next rim gesture is classic accelerated
 *   seek. (If the two CCs turn out to tick at different densities per
 *   revolution, tune the continuation feel here.)
 */
export const JOG_TOUCH_AUTHORITATIVE_MS = 100;
export const JOG_FINE_CONTINUATION_MS = 250;

/** Rate smoothing: how much of the instantaneous rate each burst carries. */
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

/** Momentary bend for a playing deck: linear in rate, clamped. */
export function jogBendPercent(rate: number): number {
  const bend = rate * JOG_BEND_PERCENT_PER_TPS;
  return Math.min(Math.max(bend, -JOG_BEND_MAX_PERCENT), JOG_BEND_MAX_PERCENT);
}

/** Seek travel for a paused deck: per-tick base, quadratic in rate. */
export function jogSeekDelta(ticks: number, rate: number): number {
  const accel = 1 + (Math.abs(rate) / JOG_SEEK_ACCEL_TPS) ** 2;
  return ticks * JOG_SEEK_SECONDS_PER_TICK * Math.min(accel, JOG_SEEK_ACCEL_MAX);
}

export class JogController {
  private readonly port: JogDeckPort;
  private rate = 0;
  private lastTickMs: number | null = null;
  private bending = false;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  /** Last touch-CC tick (dual-stream authority window). */
  private lastTouchTickMs: number | null = null;
  /** Last fine-rate seek — touch tick or continuation rim tick. */
  private lastFineActivityMs: number | null = null;

  constructor(port: JogDeckPort) {
    this.port = port;
  }

  /**
   * Touch-surface rotation (CC #10): fine linear seek on a paused deck;
   * ignored while playing — there is no scratch model, and the dense touch
   * stream would swamp the rim's bend velocity math.
   */
  onTouchTicks(ticks: number, nowMs: number = performance.now()): void {
    if (this.port.isPlaying()) return;
    this.lastTouchTickMs = nowMs;
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
      this.bending = true;
      this.port.setBend(jogBendPercent(this.rate));
      this.armIdleRelease();
      return;
    }

    this.releaseBend(); // mode flip mid-gesture: never leave a stale bend

    // Touch stream still live: it is authoritative for this motion.
    if (this.lastTouchTickMs !== null && nowMs - this.lastTouchTickMs < JOG_TOUCH_AUTHORITATIVE_MS)
      return;
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

  private armIdleRelease(): void {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      this.rate = 0;
      this.lastTickMs = null;
      this.releaseBend();
    }, JOG_IDLE_MS);
  }

  private releaseBend(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (!this.bending) return;
    this.bending = false;
    this.port.setBend(0);
  }
}
