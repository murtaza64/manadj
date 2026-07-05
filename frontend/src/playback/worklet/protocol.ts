/**
 * Message protocol between the Deck engine (main thread) and the deck-source
 * worklet processor (audio thread). Commands are fire-and-forget; MessagePort
 * ordering guarantees a `load` posted before a `start` is applied first.
 *
 * The composed playback rate is NOT a message — it rides an a-rate AudioParam
 * (`rate`) so setValueAtTime stays sample-accurate and the engine's
 * anchor-clock math stays exact (ADR 0018).
 */

/** The worklet's two modes (ADR 0018): resample = varispeed (Key Lock off,
 * bit-perfect at rate 1); stretch = time-stretch without transpose (Key
 * Lock on — tempo changes leave the Track's Key unchanged). */
export type SourceMode = 'resample' | 'stretch';

export type DeckSourceCommand =
  /** Hand over a track's decoded samples (channel data, transferred copies). */
  | { type: 'load'; channels: Float32Array[]; sampleRate: number }
  /** (Re)start playback at a track frame. Restart-while-running is an
   * internal declick splice (old voice fades while the new fades in). */
  | { type: 'start'; positionFrames: number; startId: number }
  /** Declick-fade to silence. Idempotent. */
  | { type: 'stop' }
  /** Key Lock: switch modes. Mid-play this is an internal crossfade at the
   * audible position — no click, no position jump. */
  | { type: 'mode'; mode: SourceMode }
  /** Active loop region in track frames (looping 03), or null to clear.
   * A live voice crossing the end from inside wraps with a declick splice. */
  | { type: 'loop'; region: { startFrames: number; endFrames: number } | null };

export type DeckSourceEvent =
  /** The live voice ran off the end of the track. Echoes the startId so the
   * engine can discard stale notifications that raced a seek/stop. */
  | { type: 'ended'; startId: number }
  /** The stretcher failed to initialize (Key Lock falls back to varispeed —
   * playback keeps working, the Key shifts). Diagnostic. */
  | { type: 'stretch-error'; message: string };

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
