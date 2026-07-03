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
