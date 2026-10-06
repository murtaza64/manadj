import {
  DEFAULT_JOG_CALIBRATION,
  defaultJogCalibration,
} from './jogCalibration';
import type { JogCalibration, JogProfile } from './jogCalibration';

export { defaultJogCalibration } from './jogCalibration';

/**
 * Jog wheel behavior (midi-controller 03/11): relative ticks in, bend or
 * seek out. Pure math + a small stateful controller; no Web MIDI, no React
 * — the registrar builds one per deck over the engine, dispatch feeds it
 * ticks, tests feed it synthetic ticks and a fake port.
 * GRV6 additionally supplies real contact edges and a continuous scratch
 * port. Only its edge-started gestures use that path; Inpulse stays seek/bend.
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
  scratch?: {
    isActive(): boolean;
    vinylMode(): boolean;
    begin(): void;
    move(deltaSeconds: number, durationSeconds: number): void;
    rate(): number;
    end(): void;
  };
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

/**
 * Paused seek (bare rim): strictly linear gentle nudges — a casual spin
 * must never cause surprise travel (issue 12). The accelerated fast seek
 * lives on SHIFT+wheel (jog-seek), deliberate by construction.
 */
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
/** Release coast (vinyl hold): a released platter that was still moving
 * keeps the scratch engaged — any stream's real ticks extend the gesture,
 * forward or reverse, paused or playing — until rotation stops
 * (JOG_RELEASE_IDLE_MS tick-free) or the platter is re-grabbed. A platter
 * held still at release (no fresh motion) ends immediately. */
export const JOG_RELEASE_FRESH_MS = 24;
export const JOG_RELEASE_IDLE_MS = 12;
export const JOG_RELEASE_RIM_SUPPRESS_MS = 80;

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
export function bendFromWindowAverage(
  averageTicksPerPeriod: number,
  calibration: JogCalibration = DEFAULT_JOG_CALIBRATION
): number {
  const bend = averageTicksPerPeriod * calibration.bendPercentPerTick;
  return Math.min(Math.max(bend, -calibration.bendMaxPercent), calibration.bendMaxPercent);
}

/** Fast-seek travel (SHIFT+wheel): per-tick base, quadratic in rate. */
export function jogSeekDelta(
  ticks: number,
  rate: number,
  calibration: JogCalibration = DEFAULT_JOG_CALIBRATION
): number {
  const accel = 1 + (Math.abs(rate) / calibration.fastSeekAccelTicksPerSecond) ** 2;
  return ticks * calibration.fastSeekSecondsPerTick * Math.min(accel, calibration.fastSeekAccelMax);
}

export class JogController {
  private readonly port: JogDeckPort;
  private rate = 0;
  private lastTickMs: number | null = null;
  /** Last fine-rate seek — touch tick or continuation rim tick. */
  private lastFineActivityMs: number | null = null;
  private touching = false;
  private scratching = false;
  private scratchTickMs: number | null = null;
  private scratchMotionMs: number | null = null;
  private suppressRimUntil = -Infinity;
  private scratchTimer: ReturnType<typeof setTimeout> | null = null;

  // Bend filter state (Mixxx model).
  private pendingBendTicks = 0;
  private bendWindow: number[] = new Array<number>(DEFAULT_JOG_CALIBRATION.bendFilterWindow).fill(0);
  private bendHead = 0;
  private bendTimer: ReturnType<typeof setInterval> | null = null;
  private appliedBend = 0;
  private bendCalibration = defaultJogCalibration();

  constructor(port: JogDeckPort) {
    this.port = port;
  }

  /** True touch edges, not a tick watchdog: a stationary hand holds forever. */
  onTouch(held: boolean, nowMs: number = performance.now()): void {
    this.syncState();
    if (held) {
      if (this.touching || !this.port.scratch?.vinylMode()) return;
      if (!this.scratching && this.port.scratch.isActive()) return;
      if (this.scratching) {
        // Retouch of a released, still-spinning platter: same gesture —
        // no new begin (Slip latch and trajectory survive), just re-hold.
        this.releaseBend();
        this.clearScratchTimer();
        this.suppressRimUntil = -Infinity;
        this.touching = true;
        this.scratchTickMs = nowMs;
        return;
      }
      this.beginHeldScratch(nowMs);
      this.touching = this.scratching;
    } else {
      if (!this.touching) return;
      this.touching = false;
      const throwEligible = this.scratchMotionMs !== null
        && nowMs - this.scratchMotionMs < JOG_RELEASE_FRESH_MS
        && Math.abs(this.port.scratch?.rate() ?? 0) > 0;
      if (throwEligible) this.scheduleScratchEnd();
      else this.finishScratch();
      this.suppressRimUntil = nowMs + JOG_RELEASE_RIM_SUPPRESS_MS;
    }
  }

  /** Engine overrides (load/pause/seek/mode changes) invalidate controller holds. */
  syncState(): void {
    if (this.scratching && !this.port.scratch?.isActive()) this.override();
    if (!this.scratching && this.port.scratch?.isActive()) this.releaseBend();
  }

  /**
   * The engine ended our scratch (another control's transport dispatch,
   * an override, a takeover): drop the scratch/coast state but KEEP the
   * physical contact latch — the finger never left the platter, so its
   * next touch ticks re-acquire the scratch. Only genuine contact loss
   * (cancel: touch-up, unplug, surface or layer change) demands a
   * re-touch.
   */
  override(): void {
    const touching = this.touching;
    this.cancel();
    this.touching = touching;
  }

  /** Begin (or re-acquire) the scratch the held contact owns. */
  private beginHeldScratch(nowMs: number): void {
    this.releaseBend();
    this.clearScratchTimer();
    this.suppressRimUntil = -Infinity;
    // begin() can synchronously notify a surface displacement. Let that
    // cancellation see the in-flight gesture before querying acceptance.
    this.scratching = true;
    this.port.scratch.begin();
    this.scratchMotionMs = null;
    this.scratching = this.port.scratch.isActive();
    this.scratchTickMs = nowMs;
  }

  cancel(): void {
    const end = this.scratching && this.port.scratch?.isActive();
    this.scratching = false;
    this.touching = false;
    this.scratchTickMs = null;
    this.scratchMotionMs = null;
    this.suppressRimUntil = -Infinity;
    this.clearScratchTimer();
    this.lastFineActivityMs = null;
    this.lastTickMs = null;
    this.rate = 0;
    this.releaseBend();
    // Clear controller state before the engine's synchronous notification.
    if (end) this.port.scratch?.end();
  }

  private moveScratch(ticks: number, nowMs: number, calibration: JogCalibration): void {
    if (!Number.isFinite(ticks) || ticks === 0) return;
    const dt = Math.min(30, Math.max(1, nowMs - (this.scratchTickMs ?? nowMs)));
    this.scratchTickMs = nowMs;
    this.scratchMotionMs = nowMs;
    this.port.scratch?.move(ticks * calibration.touchSeekSecondsPerTick, dt / 1000);
    if (this.scratching && !this.touching) {
      this.suppressRimUntil = nowMs + JOG_RELEASE_RIM_SUPPRESS_MS;
      this.scheduleScratchEnd();
    }
  }

  private scheduleScratchEnd(): void {
    this.clearScratchTimer();
    this.scratchTimer = setTimeout(() => this.finishScratch(), JOG_RELEASE_IDLE_MS);
  }

  private finishScratch(): void {
    this.syncState();
    if (!this.scratching || this.touching) return;
    const suppress = this.suppressRimUntil;
    this.cancel();
    this.suppressRimUntil = suppress;
  }

  private clearScratchTimer(): void {
    if (this.scratchTimer !== null) clearTimeout(this.scratchTimer);
    this.scratchTimer = null;
  }

  /**
   * Touch-surface rotation (CC #10): fine linear seek on a paused deck;
   * ignored while playing on Inpulse. GRV6 moves only an edge-started scratch;
   * software Vinyl-off uses ordinary rim behavior regardless of the CC stream.
   */
  onTouchTicks(
    ticks: number,
    nowMs: number = performance.now(),
    calibration: JogCalibration = DEFAULT_JOG_CALIBRATION,
    profile?: JogProfile
  ): void {
    this.syncState();
    if (!this.scratching && this.port.scratch?.isActive()) return;
    if (profile === 'grv6') {
      if (!this.port.scratch?.vinylMode()) this.onTicks(ticks, nowMs, calibration, profile);
      else {
        // Finger never left: the scratch was ended by an engine override
        // (another control's transport dispatch) — rotation re-acquires it.
        if (this.touching && !this.scratching) this.beginHeldScratch(nowMs);
        if (this.scratching) this.moveScratch(ticks, nowMs, calibration);
      }
      return;
    }
    if (this.port.isPlaying()) return;
    this.lastFineActivityMs = nowMs;
    this.port.seek(this.port.getPlayhead() + ticks * calibration.touchSeekSecondsPerTick);
  }

  /** Rim rotation (CC #9): bend when playing, gentle linear nudge-seek when
   * paused — unless the ticks continue a touch gesture (a released,
   * still-spinning platter), which keeps the fine rate. */
  onTicks(
    ticks: number,
    nowMs: number = performance.now(),
    calibration: JogCalibration = DEFAULT_JOG_CALIBRATION,
    profile?: JogProfile,
    vinylOff = false
  ): void {
    this.syncState();
    if (!this.scratching && this.port.scratch?.isActive()) return;
    if (vinylOff && (this.scratching || this.suppressRimUntil > nowMs)) this.cancel();
    if (profile === 'grv6' && !vinylOff && !this.scratching && nowMs < this.suppressRimUntil) return;
    if (profile === 'grv6' && this.scratching) {
      this.moveScratch(ticks, nowMs, calibration);
      return;
    }    this.foldRate(ticks, nowMs);

    if (this.port.isPlaying()) {
      this.setBendCalibration(calibration);
      this.pendingBendTicks += ticks;
      this.startBendFilter();
      return;
    }

    this.releaseBend(); // mode flip mid-gesture: never leave a stale bend

    // Released but still spinning: same gesture, same seconds-per-tick.
    if (this.lastFineActivityMs !== null && nowMs - this.lastFineActivityMs < JOG_FINE_CONTINUATION_MS) {
      this.lastFineActivityMs = nowMs;
      this.port.seek(this.port.getPlayhead() + ticks * calibration.touchSeekSecondsPerTick);
      return;
    }

    // Gentle by design: no velocity acceleration on the bare rim.
    this.port.seek(this.port.getPlayhead() + ticks * calibration.rimSeekSecondsPerTick);
  }

  /**
   * SHIFT+wheel (jog-seek): deliberate fast seek, velocity-accelerated,
   * playing or paused (an explicit gesture may jump the playhead — Mixxx's
   * shift+wheel does the same). Releases any bend first so a mid-bend shift
   * press never leaves a stale rate offset.
   */
  onSeekTicks(
    ticks: number,
    nowMs: number = performance.now(),
    calibration: JogCalibration = DEFAULT_JOG_CALIBRATION
  ): void {
    if (this.scratching || this.suppressRimUntil > -Infinity) this.cancel();
    this.foldRate(ticks, nowMs);
    this.releaseBend();
    this.port.seek(this.port.getPlayhead() + jogSeekDelta(ticks, this.rate, calibration));
  }

  /** Shared velocity fold: shifted and unshifted streams are one physical
   * wheel, so rate continuity survives pressing SHIFT mid-spin. */
  private foldRate(ticks: number, nowMs: number): void {
    const dtMs = this.lastTickMs === null ? DT_MAX_MS : nowMs - this.lastTickMs;
    // A gap past the activity window is a fresh gesture, not a continuation.
    this.rate = smoothedRate(dtMs > DT_MAX_MS ? 0 : this.rate, ticks, dtMs);
    this.lastTickMs = nowMs;
  }

  /** Detach hook for the registrar: release any held bend immediately. */
  dispose(): void {
    this.cancel();
  }

  private startBendFilter(): void {
    if (this.bendTimer !== null) return;
    this.bendTimer = setInterval(() => this.onBendPeriod(), JOG_BEND_FILTER_PERIOD_MS);
  }

  private setBendCalibration(calibration: JogCalibration): void {
    const window = Math.max(1, Math.round(calibration.bendFilterWindow));
    if (window !== this.bendWindow.length) {
      // Live tuning starts a fresh filter rather than mixing samples that
      // were normalized for a different window length.
      this.pendingBendTicks = 0;
      this.bendWindow = new Array<number>(window).fill(0);
      this.bendHead = 0;
    }
    this.bendCalibration = calibration;
  }

  private onBendPeriod(): void {
    // Drain the accumulator into the window (Mixxx: getJogFactor per buffer).
    this.bendWindow[this.bendHead] = this.pendingBendTicks;
    this.pendingBendTicks = 0;
    this.bendHead = (this.bendHead + 1) % this.bendWindow.length;

    let sum = 0;
    for (const slot of this.bendWindow) sum += slot;
    const bend = bendFromWindowAverage(sum / this.bendWindow.length, this.bendCalibration);
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
