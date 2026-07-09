import type { EqBand } from '../playback/graph';
import type { ChannelId } from '../playback/mixer';

/**
 * Soft-takeover feedback (midi-controller 18): when dispatch's pickup fold
 * suppresses a mismatched hardware move (softTakeover.ts), the on-screen
 * control is the only place that can say so — hardware has no motorized
 * faders. This module-level store carries the transient "waiting for
 * pickup" hint per physical control; on-screen controls subscribe (same
 * pattern as the Mixer's subscribe — the MIDI layer lives outside React).
 *
 * A hint appears on the first suppressed move, points TOWARD the software
 * value (the direction the hand must travel), and ends on pickup or after
 * a short decay once the hand stops moving — an abandoned reach shouldn't
 * pulse forever.
 */

export type TakeoverDirection = 'up' | 'down';

/**
 * One source of truth for control identity keys — dispatch reports with
 * these, components subscribe with them.
 */
export const takeoverKey = {
  pitch: (deck: ChannelId) => `pitch:${deck}`,
  trim: (channel: ChannelId) => `trim:${channel}`,
  eq: (channel: ChannelId, band: EqBand) => `eq:${channel}:${band}`,
  filter: (channel: ChannelId) => `filter:${channel}`,
  channelFader: (channel: ChannelId) => `channel-fader:${channel}`,
  crossfader: () => 'crossfader',
  master: () => 'master',
  cueLevel: () => 'cue-level',
  cueMix: () => 'cue-mix',
} as const;

/** How long a hint outlives the last suppressed move. Long enough to read,
 * short enough that an abandoned reach doesn't leave a stale pulse. */
export const TAKEOVER_HINT_DECAY_MS = 1200;

const hints = new Map<string, TakeoverDirection>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function clearHint(key: string): void {
  const timer = timers.get(key);
  if (timer) clearTimeout(timer);
  timers.delete(key);
  if (hints.delete(key)) notify();
}

/** A hardware move was suppressed: show/refresh the hint. Every report
 * restarts the decay clock; listeners fire only when the hint changes. */
export function reportSuppressed(key: string, direction: TakeoverDirection): void {
  const changed = hints.get(key) !== direction;
  hints.set(key, direction);
  const timer = timers.get(key);
  if (timer) clearTimeout(timer);
  timers.set(
    key,
    setTimeout(() => clearHint(key), TAKEOVER_HINT_DECAY_MS)
  );
  if (changed) notify();
}

/** The control picked up (or was already latched): clear any hint. */
export function reportPickedUp(key: string): void {
  clearHint(key);
}

/** Current hint for a control, or null. Primitive snapshot —
 * useSyncExternalStore-friendly. */
export function takeoverHint(key: string): TakeoverDirection | null {
  return hints.get(key) ?? null;
}

export function subscribeTakeoverHints(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function _resetTakeoverFeedbackForTests(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  hints.clear();
  listeners.clear();
}
