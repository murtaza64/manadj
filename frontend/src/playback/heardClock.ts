import { foldLoopPlayhead } from './loop';

/** Display-only immutable projection. Never feeds the transport reducer. */
export interface HeardClockSegment {
  at: number;
  position: number;
  rate: number;
  moving: boolean;
  loop: { start: number; end: number } | null;
  min: number;
  max: number;
}
export const DISPLAY_HISTORY_SECONDS = 3;
export const DISPLAY_HISTORY_MAX_SEGMENTS = 2048;

function positionAt(segment: HeardClockSegment, at: number): number {
  const elapsed = segment.moving ? Math.max(0, at - segment.at) * segment.rate : 0;
  let p = segment.position + elapsed;
  if (segment.loop && segment.moving) {
    p = foldLoopPlayhead(p, segment.loop.start, segment.loop.end, segment.position);
  }
  return Math.max(segment.min, Math.min(segment.max, p));
}

/**
 * Bounded, audio-clock-domain position history. Call record at engine clock
 * mutations, not at animation cadence. A read across a seek/rate/loop/stop
 * boundary evaluates the OLD immutable segment until it reaches the output.
 * A hidden/throttled view therefore needs no animation timer to stay correct.
 *
 * Changing the source/context must reset this object. Direct manipulation can
 * bypass read() and display the true editing position without mutating history.
 */
export class HeardClockHistory {
  private segments: HeardClockSegment[] = [];
  reset(): void { this.segments = []; }
  get size(): number { return this.segments.length; }

  record(segment: HeardClockSegment): void {
    if (![segment.at, segment.position, segment.rate, segment.min, segment.max].every(Number.isFinite)
      || segment.min > segment.max || segment.rate < 0
      || (segment.loop && (!Number.isFinite(segment.loop.start) || !Number.isFinite(segment.loop.end)
        || segment.loop.end <= segment.loop.start))) throw new Error('invalid display clock segment');
    const last = this.segments[this.segments.length - 1];
    // An AudioContext replacement can restart currentTime at zero.
    if (last && segment.at < last.at) this.reset();
    const copy = { ...segment, loop: segment.loop ? { ...segment.loop } : null };
    if (this.segments.at(-1)?.at === segment.at) this.segments[this.segments.length - 1] = copy;
    else this.segments.push(copy);
    const cutoff = segment.at - DISPLAY_HISTORY_SECONDS;
    // Keep the predecessor so interpolation at the cutoff remains defined.
    let drop = 0;
    while (drop + 1 < this.segments.length && this.segments[drop + 1].at < cutoff) drop++;
    if (drop) this.segments.splice(0, drop);
    if (this.segments.length > DISPLAY_HISTORY_MAX_SEGMENTS) {
      this.segments.splice(0, this.segments.length - DISPLAY_HISTORY_MAX_SEGMENTS);
    }
  }

  read(now: number, latency: number): number | null {
    if (!this.segments.length || !Number.isFinite(now)) return null;
    const lag = Number.isFinite(latency) ? Math.max(0, Math.min(2, latency)) : 0;
    const heardAt = now - lag;
    let lo = 0, hi = this.segments.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.segments[mid].at <= heardAt) lo = mid + 1;
      else hi = mid;
    }
    const segment = this.segments[Math.max(0, lo - 1)];
    return positionAt(segment, heardAt);
  }
}
