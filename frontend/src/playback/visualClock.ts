/**
 * Smoothed audio-context time for drawing (desktop-perf #385).
 *
 * `AudioContext.currentTime` advances in render-quantum steps (128 frames,
 * ~2.9 ms at 44.1 kHz) and often several quanta at once, so a playhead
 * read straight from it moves 0 / 5.8 / 11.6 ms per 8.3 ms frame at
 * 120 Hz: measured per-frame step error p50 ~2.6-2.9 ms, a visible
 * shimmer on scrolling waveforms. Drawing reads this instead: wall-clock
 * (frame timestamp) extrapolation, gently pulled toward currentTime (a first-order PLL), so
 * the estimate advances evenly while staying within a few ms of the audio
 * clock. Same idea as the Android app's playhead clock.
 *
 * Visual only: transport logic (quantize, cue, capture) keeps reading
 * DeckEngine.getPlayhead(), which is exact.
 */

/** Pull time constant: how fast the estimate converges on currentTime. */
const TAU_S = 0.08;
/** Disagreement beyond this is a discontinuity (suspend, resume, device
 * switch, a stalled main thread): snap instead of gliding. */
const SNAP_S = 0.03;
/** Calls closer than this share one estimate (several renderers per frame
 * must agree, and must not each apply the correction; frame timestamps
 * already make same-frame reads identical). */
const SAME_FRAME_S = 0.002;

interface State {
  est: number;
  wall: number;
}

type ClockSource = { readonly currentTime: number; readonly state?: string };

const states = new WeakMap<object, State>();

/** The current animation frame's timestamp (constant within a frame, the
 * same value rAF callbacks receive): what is drawn is shown at the frame's
 * vsync, not whenever a callback happens to run. */
function frameTime(): number {
  const t = typeof document !== 'undefined' ? document.timeline?.currentTime : null;
  return (typeof t === 'number' ? t : performance.now()) / 1000;
}

let wallNow = frameTime;

/** Test seam: replace the wall clock (seconds). null restores it. */
export function setVisualWallClock(fn: (() => number) | null): void {
  wallNow = fn ?? frameTime;
}

/** The context's currentTime, smoothed for display. Never runs backwards
 * while the context runs; equals currentTime while it is not running. */
export function visualContextTime(ctx: ClockSource): number {
  const raw = ctx.currentTime;
  const wall = wallNow();
  const prev = states.get(ctx);
  if (!prev || (ctx.state !== undefined && ctx.state !== 'running')) {
    states.set(ctx, { est: raw, wall });
    return raw;
  }
  const dt = wall - prev.wall;
  if (dt >= 0 && dt < SAME_FRAME_S) return prev.est;
  const predicted = prev.est + Math.max(0, dt);
  const err = raw - predicted;
  let est: number;
  if (dt < 0 || Math.abs(err) > SNAP_S) {
    est = raw;
  } else {
    est = predicted + err * (1 - Math.exp(-dt / TAU_S));
    if (est < prev.est) est = prev.est;
  }
  prev.est = est;
  prev.wall = wall;
  return est;
}
