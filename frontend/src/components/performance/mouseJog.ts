import { mouseSeekDelta } from './mouseControl';

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
const RESPONSE_MS = 50;
const IDLE_MS = 500;

export class MouseJogController {
  private readonly port: MouseJogPort;
  private samples: { time: number; dx: number }[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastMotion = 0;
  private lastPeriod = 0;
  private appliedBend = 0;
  private contactHeld = false;
  private ownsScratch = false;
  private disposed = false;

  constructor(port: MouseJogPort) {
    this.port = port;
  }

  /** Accepted platter contact, not merely a held modifier. */
  get isTouching(): boolean {
    return this.ownsScratch;
  }

  move(dx: number, elapsedMs: number): void {
    if (this.disposed) return;
    this.syncState();
    if (!Number.isFinite(dx) || dx === 0) return;
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
    if (!state.vinylMode || state.scratching) return;
    // beginScratch emits synchronously: cancellation must see our ownership,
    // and its result must not be overwritten by the acceptance check.
    this.ownsScratch = true;
    this.port.beginScratch();
    this.ownsScratch = this.ownsScratch && this.port.getSnapshot().scratching;
  }

  syncState(): void {
    const state = this.port.getSnapshot();
    if (!state.scratching) this.ownsScratch = false;
    if (!state.playing || state.scratching) this.stopBend();
  }

  cancel(): void {
    const end = this.ownsScratch && this.port.getSnapshot().scratching;
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
    if (now - this.lastMotion >= IDLE_MS) {
      this.stopBend();
      return;
    }
    this.samples = this.samples.filter(sample => sample.time >= now - MOTION_WINDOW_MS);
    // Always divide by the full window, never an event's elapsed time. One
    // small packet cannot masquerade as a high-speed sweep on first contact.
    const velocity = this.samples.reduce((sum, sample) => sum + sample.dx, 0) * 1000 / MOTION_WINDOW_MS;
    const target = Math.sign(velocity) * Math.min(8, 8 * (Math.abs(velocity) / 6000) ** 1.5);
    const alpha = 1 - Math.exp(-(now - this.lastPeriod) / RESPONSE_MS);
    this.lastPeriod = now;
    const bend = this.appliedBend + alpha * (target - this.appliedBend);
    if (bend !== this.appliedBend) {
      this.appliedBend = bend;
      this.port.setBend(bend);
    }
  }

  private stopBend(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.samples = [];
    if (this.appliedBend !== 0) {
      this.appliedBend = 0;
      this.port.setBend(0);
    }
  }
}
