/** Relative pixels for a full mixer sweep, along either axis. */
export const MIXER_DRAG_RANGE_PX = 360;

export const KNOB_STROKE_PAUSE_MS = 160;

export interface KnobGesture {
  value: number;
  lastMotion: number;
  notch: 'armed' | 'stopped' | 'departing';
}

/** Delta is a fraction of a full sweep; time is the uncapped motion timestamp. */
export function moveKnob(
  previous: KnobGesture | undefined, value: number, delta: number, now: number, bipolar = false,
): KnobGesture {
  const center = bipolar ? 0 : 0.5;
  const tolerance = bipolar ? 0.04 : 0.02;
  // External UI/MIDI changes replace both the baseline and the notch latch.
  const gesture: KnobGesture = previous && Math.abs(value - previous.value) < 1e-9
    ? previous : { value, lastMotion: -Infinity, notch: value === center ? 'departing' : 'armed' };
  if (delta === 0) return gesture;
  let notch = gesture.notch;
  if (notch === 'stopped' && now - gesture.lastMotion >= KNOB_STROKE_PAUSE_MS) notch = 'departing';
  let next = Math.max(bipolar ? -1 : 0, Math.min(1, value + delta * (bipolar ? 2 : 1)));
  if (notch === 'armed' && (
    (value < center && delta > 0 && next >= center - tolerance - 1e-9) ||
    (value > center && delta < 0 && next <= center + tolerance + 1e-9)
  )) notch = 'stopped';
  if (notch === 'stopped') next = center;
  // Small departure events accumulate normally until clear of the capture band.
  if (notch === 'departing' && Math.abs(next - center) > tolerance + 1e-9) notch = 'armed';
  return { value: next, lastMotion: now, notch };
}

/** Cut <-> neutral/full, choosing the nearer stop even after small adjustments. */
export function invertControl(value: number, on: number): number {
  return value < on / 2 ? on : 0;
}

/** Paused rim travel in track seconds; independent of playing bend sensitivity. */
export function mouseSeekDelta(dx: number, elapsedMs: number): number {
  const speed = Math.abs(dx) * 1000 / Math.max(1, elapsedMs);
  const t = Math.max(0, Math.min(1, (speed - 80) / 920));
  const gain = 0.0025 + 0.005 * t * t * (3 - 2 * t);
  return dx * gain;
}
