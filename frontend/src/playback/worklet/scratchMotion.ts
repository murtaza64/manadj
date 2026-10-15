/** Shared audio-clock trajectory. Positions/displacements are track seconds. */
export interface ScratchFilter {
  /** Cascaded velocity states, in track seconds / output second. */
  drive: number;
  rate: number;
}

export interface ScratchMotion extends ScratchFilter {
  position: number;
  time: number;
  trackDuration: number;
  loop: { start: number; end: number } | null;
}

/** Complete recorded state at an audio-clock instant. Null motion releases
 * to the recorded position/transport, never to a live slip preference. */
export interface ScratchFrame {
  time: number;
  motion: ScratchMotion | null;
  position: number;
  playing: boolean;
  loop: { start: number; end: number } | null;
  rate: number;
}

export interface ScheduledScratchFrame extends ScratchFrame {
  mode: 'resample' | 'stretch';
  startId: number;
}

export const MAX_SCRATCH_RATE = 16;
/** Independent impulse reconstruction: two identical 8ms low-pass poles.
 * Displacement impulses enter drive; rate and its integral stay continuous.
 * No callback-gap division, prediction watchdog, or target-position debt. */
export const SCRATCH_RESPONSE_SECONDS = 0.008;
export const SCRATCH_SILENT_RATE = 0.001;
/** Speed (× normal) at which the scratch voice reaches full level. Only a
 * declick band: below it the voice fades to silence so a stopping platter
 * never parks on a DC offset. Was 0.5 (from the Mixxx-style speed gain),
 * which attenuated every slow drag and release tail by several dB — a CDJ
 * keeps amplitude flat down to near-zero speed, only the pitch falls. */
export const SCRATCH_FULL_GAIN_RATE = 0.04;

/** Transport loops may extend past EOF; scratch trajectories may not. */
export function effectiveScratchLoop(loop: { start: number; end: number } | null, trackDuration: number) {
  if (!loop) return null;
  const start = Math.max(0, loop.start);
  const end = Math.min(trackDuration, loop.end);
  return end > start ? { start, end } : null;
}

export function scratchFilterAt(motion: ScratchFilter & { time: number }, now: number): ScratchFilter {
  const x = Math.max(0, now - motion.time) / SCRATCH_RESPONSE_SECONDS;
  return { drive: motion.drive * Math.exp(-x), rate: scratchRate(motion, now) };
}

/** Allocation-free scalar read for the per-sample renderer. */
export function scratchRate(motion: ScratchFilter & { time: number }, now: number): number {
  const x = Math.max(0, now - motion.time) / SCRATCH_RESPONSE_SECONDS;
  return (motion.rate + motion.drive * x) * Math.exp(-x);
}

export function scratchGain(rate: number): number {
  const speed = Math.max(0, Math.min(1,
    (Math.abs(rate) - SCRATCH_SILENT_RATE) / (SCRATCH_FULL_GAIN_RATE - SCRATCH_SILENT_RATE)));
  return speed * speed * (3 - 2 * speed);
}

/** Include an inward first impulse before its initially-zero rate rises,
 * but never classify a clamped outward trajectory as source motion. */
export function scratchIsSounding(filter: ScratchFilter, position: number, trackDuration: number,
  loop: { start: number; end: number } | null): boolean {
  const peakTime = filter.drive === 0 ? 0 : Math.max(0, 1 - filter.rate / filter.drive);
  const peak = (filter.rate + filter.drive * peakTime) * Math.exp(-peakTime);
  if (Math.max(Math.abs(peak), Math.abs(filter.rate)) <= SCRATCH_SILENT_RATE) return false;
  if (loop && position >= Math.max(0, loop.start) && position < Math.min(trackDuration, loop.end)) return true;
  const direction = Math.abs(filter.rate) > SCRATCH_SILENT_RATE ? filter.rate : filter.drive;
  return trackDuration > 0 && (position > 0 || direction > 0) && (position < trackDuration || direction < 0);
}

/** Detect a short audible return between capture events, including an
 * outward edge hold that reverses before release. Split at rate extrema
 * so each searched interval has monotone speed and position. */
export function scratchSoundedBetween(motion: ScratchMotion, until: number): boolean {
  const end = Math.min(0.25, Math.max(0, until - motion.time));
  if (end === 0 || Math.max(Math.abs(motion.drive), Math.abs(motion.rate)) <= SCRATCH_SILENT_RATE) return false;
  const times = [0, end];
  if (motion.drive !== 0) {
    const turn = -motion.rate / motion.drive * SCRATCH_RESPONSE_SECONDS;
    for (const time of [turn, turn + SCRATCH_RESPONSE_SECONDS]) if (time > 0 && time < end) times.push(time);
  }
  times.sort((a, b) => a - b);
  for (let i = 1; i < times.length; i++) {
    let start = times[i - 1];
    let finish = times[i];
    const from = Math.abs(scratchRate(motion, motion.time + start));
    const to = Math.abs(scratchRate(motion, motion.time + finish));
    if (Math.max(from, to) <= SCRATCH_SILENT_RATE) continue;
    if (Math.min(from, to) <= SCRATCH_SILENT_RATE) {
      let low = start;
      let high = finish;
      for (let n = 0; n < 40; n++) {
        const mid = (low + high) / 2;
        const above = Math.abs(scratchRate(motion, motion.time + mid)) > SCRATCH_SILENT_RATE;
        if (above === (from > SCRATCH_SILENT_RATE)) low = mid;
        else high = mid;
      }
      if (from <= SCRATCH_SILENT_RATE) start = high;
      else finish = low;
    }
    if (finish <= start) continue;
    if (motion.loop && motion.position >= motion.loop.start && motion.position < motion.loop.end) return true;
    if (scratchPosition(motion, motion.time + start) !== scratchPosition(motion, motion.time + finish)) return true;
  }
  return false;
}

export function scratchTravel(motion: ScratchFilter, elapsed: number): number {
  const x = Math.max(0, elapsed) / SCRATCH_RESPONSE_SECONDS;
  return SCRATCH_RESPONSE_SECONDS * (motion.rate * -Math.expm1(-x)
    + motion.drive * (1 - (1 + x) * Math.exp(-x)));
}

/** Next trace/audibility boundary; bisection stays outside the audio loop. */
export function scratchBoundary(motion: ScratchMotion): { time: number; wrap: boolean } {
  if (Math.max(Math.abs(motion.drive), Math.abs(motion.rate)) <= SCRATCH_SILENT_RATE) {
    return { time: Infinity, wrap: false };
  }
  let low = 0;
  let high = 0.25;
  for (let i = 0; i < 40; i++) {
    const mid = (low + high) / 2;
    const f = scratchFilterAt(motion, motion.time + mid);
    if (Math.max(Math.abs(f.drive), Math.abs(f.rate)) > SCRATCH_SILENT_RATE) low = mid;
    else high = mid;
  }
  if (motion.drive * motion.rate < 0) {
    high = Math.min(high, -motion.rate / motion.drive * SCRATCH_RESPONSE_SECONDS + 1e-9);
  }
  const travel = scratchTravel(motion, high);
  const loop = motion.loop;
  if (loop && motion.position >= loop.start && motion.position < loop.end) {
    const distance = travel > 0 ? loop.end - motion.position : loop.start - motion.position;
    // Cross by a representable position, not an arbitrary time epsilon.
    // Slow reverse motion at start otherwise schedules the same edge forever.
    const crossing = Math.abs(distance) + 4 * Number.EPSILON * Math.max(1, Math.abs(loop.start), Math.abs(loop.end));
    if (Math.abs(travel) >= crossing) {
      low = 0;
      for (let i = 0; i < 40; i++) {
        const mid = (low + high) / 2;
        if (Math.abs(scratchTravel(motion, mid)) < crossing) low = mid;
        else high = mid;
      }
      return { time: motion.time + high + 1e-9, wrap: true };
    }
  }
  return { time: motion.time + high + 1e-9, wrap: false };
}

export function scratchPosition(motion: ScratchMotion, now: number): number {
  const elapsed = Math.max(0, now - motion.time);
  let position = motion.position + scratchTravel(motion, elapsed);
  const loop = motion.loop;
  if (loop && motion.position >= loop.start && motion.position < loop.end) {
    const length = loop.end - loop.start;
    const offset = (position - loop.start) % length;
    position = offset < 0 ? loop.end + offset : loop.start + offset;
    // A negative remainder smaller than an end-position ULP still belongs
    // below end, never back at start. Preserve the crossing's topology.
    if (position >= loop.end) position = loop.end - Number.EPSILON * Math.max(1, Math.abs(loop.end));
  } else if (motion.drive * motion.rate < 0) {
    // Clamp at the turning point too: an edge cannot accumulate hidden
    // out-of-track travel that must be repaid before the return is audible.
    const turn = -motion.rate / motion.drive * SCRATCH_RESPONSE_SECONDS;
    if (turn < elapsed) {
      const extreme = motion.position + scratchTravel(motion, turn);
      position += Math.max(0, Math.min(motion.trackDuration, extreme)) - extreme;
    }
  }
  return Math.max(0, Math.min(motion.trackDuration, position));
}

/** The interval is input metadata, never a denominator for instantaneous speed. */
export function moveScratch(motion: ScratchMotion, now: number, delta: number, duration: number): ScratchMotion {
  if (!Number.isFinite(delta) || !Number.isFinite(duration) || duration <= 0) return motion;
  const filter = scratchFilterAt(motion, now);
  const position = scratchPosition(motion, now);
  return {
    ...motion, ...filter, position, time: now,
    drive: Math.max(-MAX_SCRATCH_RATE, Math.min(MAX_SCRATCH_RATE, filter.drive + delta / SCRATCH_RESPONSE_SECONDS)),
  };
}
