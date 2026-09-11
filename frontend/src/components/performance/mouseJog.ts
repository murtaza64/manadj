import { mouseSeekDelta } from './mouseControl';
import { DEFAULT_MOUSE_JOG_SETTINGS, mouseJogBendTarget } from './mouseJogSettings';
import type { MouseJogSettings } from './mouseJogSettings';

export interface MouseJogPort {
  getSnapshot(): { playing: boolean; scratching: boolean; vinylMode: boolean };
  getPlayhead(): number;
  seek(seconds: number): void;
  setBend(percent: number): void;
  beginScratch(): void;
  scratchMove(deltaSeconds: number, durationSeconds: number): void;
  endScratch(): void;
}

const MOTION_WINDOW_MS = 100;
const FILTER_PERIOD_MS = 25;

export class MouseJogController {
  private readonly port: MouseJogPort;
  private readonly tuning: () => MouseJogSettings;
  private readonly onSpeed?: (speed: number) => void;
  private samples: { time: number; dx: number }[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastMotion = 0;
  private lastPeriod = 0;
  private appliedBend = 0;
  private speed = 0;
  private contactHeld = false;
  private armed = false;
  private ownsScratch = false;
  private disposed = false;

  constructor(
    port: MouseJogPort,
    tuning: () => MouseJogSettings = () => DEFAULT_MOUSE_JOG_SETTINGS,
    onSpeed?: (speed: number) => void,
  ) {
    this.port = port;
    this.tuning = tuning;
    this.onSpeed = onSpeed;
  }

  /** Owned engine scratch, not armed contact. */
  get isTouching(): boolean {
    return this.ownsScratch;
  }

  get isPlatterMode(): boolean {
    return this.armed || this.ownsScratch;
  }

  move(dx: number, elapsedMs: number): void {
    if (this.disposed) return;
    this.syncState();
    if (!Number.isFinite(dx) || dx === 0) return;
    if (this.armed) {
      this.armed = false;
      // beginScratch emits synchronously: cancellation must see ownership,
      // and its result must not be overwritten by the acceptance check.
      this.ownsScratch = true;
      this.port.beginScratch();
      this.ownsScratch = this.ownsScratch && this.port.getSnapshot().scratching;
      if (!this.ownsScratch) return;
    }
    const state = this.port.getSnapshot();
    if (state.scratching) {
      if (this.ownsScratch) {
        const duration = Math.min(100, Math.max(1, Number.isNaN(elapsedMs) ? 1 : elapsedMs));
        this.port.scratchMove(dx * 0.002, duration / 1000);
      }
      return;
    }
    if (!state.playing) {
      this.port.seek(this.port.getPlayhead() + mouseSeekDelta(dx, Number.isNaN(elapsedMs) ? 1 : elapsedMs));
      return;
    }

    const now = performance.now();
    this.samples = this.samples.filter(sample => sample.time >= now - MOTION_WINDOW_MS);
    this.samples.push({ time: now, dx });
    this.lastMotion = now;
    if (this.timer === null) {
      this.lastPeriod = now;
      this.timer = setInterval(() => this.onPeriod(), FILTER_PERIOD_MS);
    }
  }

  setTouch(held: boolean): void {
    if (this.disposed) return;
    this.syncState();
    if (!held) {
      this.contactHeld = false;
      this.cancel();
      return;
    }
    if (this.contactHeld) return;
    this.contactHeld = true;
    this.stopBend();
    const state = this.port.getSnapshot();
    this.armed = state.vinylMode && !state.scratching;
  }

  syncState(): void {
    const state = this.port.getSnapshot();
    if (!state.vinylMode || (state.scratching && !this.ownsScratch)) this.armed = false;
    if (!state.scratching) this.ownsScratch = false;
    if (!state.playing || state.scratching) this.stopBend();
  }

  cancel(): void {
    const end = this.ownsScratch && this.port.getSnapshot().scratching;
    this.armed = false;
    this.ownsScratch = false;
    // Keep the physical edge latched until release, even after engine override.
    this.stopBend();
    if (end) this.port.endScratch();
  }

  dispose(): void {
    this.disposed = true;
    this.cancel();
  }

  private onPeriod(): void {
    this.syncState();
    if (this.timer === null) return;
    const now = performance.now();
    const settings = this.tuning();
    if (now - this.lastMotion >= MOTION_WINDOW_MS + 8 * settings.smoothingMs) {
      this.stopBend();
      return;
    }
    this.samples = this.samples.filter(sample => sample.time >= now - MOTION_WINDOW_MS);
    // Always divide by the full window, never an event's elapsed time. One
    // small packet cannot masquerade as a high-speed sweep on first contact.
    const velocity = this.samples.reduce((sum, sample) => sum + sample.dx, 0) * 1000 / MOTION_WINDOW_MS;
    this.publishSpeed(velocity);
    if (this.timer === null) return;
    const target = mouseJogBendTarget(velocity, settings);
    const alpha = settings.smoothingMs === 0 ? 1 : 1 - Math.exp(-(now - this.lastPeriod) / settings.smoothingMs);
    this.lastPeriod = now;
    const bend = this.appliedBend + alpha * (target - this.appliedBend);
    if (bend !== this.appliedBend) {
      this.appliedBend = bend;
      this.port.setBend(bend);
    }
  }

  private publishSpeed(speed: number): void {
    if (speed === this.speed) return;
    this.speed = speed;
    this.onSpeed?.(speed);
  }

  private stopBend(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.samples = [];
    if (this.appliedBend !== 0) {
      this.appliedBend = 0;
      this.port.setBend(0);
    }
    this.publishSpeed(0);
  }
}
