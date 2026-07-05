/**
 * Message protocol between the Deck engine (main thread) and the deck-source
 * worklet processor (audio thread). Commands are fire-and-forget; MessagePort
 * ordering guarantees a `load` posted before a `start` is applied first.
 *
 * The composed playback rate is NOT a message — it rides an a-rate AudioParam
 * (`rate`) so setValueAtTime stays sample-accurate and the engine's
 * anchor-clock math stays exact (ADR 0018).
 */

export type DeckSourceCommand =
  /** Hand over a track's decoded samples (channel data, transferred copies). */
  | { type: 'load'; channels: Float32Array[]; sampleRate: number }
  /** (Re)start playback at a track frame. Restart-while-running is an
   * internal declick splice (old voice fades while the new fades in). */
  | { type: 'start'; positionFrames: number; startId: number }
  /** Declick-fade to silence. Idempotent. */
  | { type: 'stop' };

export type DeckSourceEvent =
  /** The live voice ran off the end of the track. Echoes the startId so the
   * engine can discard stale notifications that raced a seek/stop. */
  | { type: 'ended'; startId: number };

/** Constructor options for the processor (AudioWorkletNodeOptions.
 * processorOptions). The declick length is passed in rather than imported
 * so the worklet bundle only ever pulls in pure modules. */
export interface DeckSourceProcessorOptions {
  declickSeconds: number;
}

/** Registered processor name. */
export const DECK_SOURCE_PROCESSOR = 'deck-source';

/** Name of the composed-rate AudioParam. */
export const RATE_PARAM = 'rate';
