/**
 * The clock seam between playback and rendering (ADR 0008).
 *
 * The waveform renderer depends on this interface — never on an audio element
 * or engine directly — so any playback implementation (DeckEngine today, a
 * second deck or a native backend tomorrow) can drive it.
 */

export interface PlaybackClock {
  /** Current playhead position in seconds. Called once per animation frame. */
  getPlayhead(): number;
}

/**
 * Clock backed by an HTMLAudioElement.
 *
 * Transitional (issue 03 deletes it with the `<audio>` stack): the element
 * clock ticks at ~250Hz so playhead motion is slightly steppy — accepted
 * interim state per ADR 0008's big-bang decision.
 */
export function elementClock(ref: { current: HTMLAudioElement | null }): PlaybackClock {
  return {
    getPlayhead: () => ref.current?.currentTime ?? 0,
  };
}
