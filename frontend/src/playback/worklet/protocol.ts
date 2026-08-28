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

/** Active loop region in TRACK FRAMES (looping 03) — the audio-thread
 * projection of the transport's seconds-domain LoopRegion. */
export interface LoopFrames {
  startFrames: number;
  endFrames: number;
}

/** The stem order every stems payload uses (stems #209; matches the
 * backend's STEM_NAMES and the serving endpoint). */
export const STEM_NAMES = ['vocals', 'drums', 'bass', 'other'] as const;
export type StemName = (typeof STEM_NAMES)[number];

export type DeckSourceCommand =
  /** Hand over a track's decoded samples (channel data, transferred copies). */
  | { type: 'load'; channels: Float32Array[]; sampleRate: number }
  /** Hand over a track's decoded STEMS — `stems[s]` is one stem's channel
   * data (transferred copies), STEM_NAMES order. The kernel mixes them with
   * per-stem gains at the read layer, before the stretch stage; gains reset
   * to unity on load (kill state is per-Track, #210). */
  | { type: 'load-stems'; stems: Float32Array[][]; sampleRate: number }
  /** Target per-stem gains (STEM_NAMES order, 0..1). Applied as a declick
   * ramp anchored at the live voice's position — knob-rate messages, not
   * sample-accurate automation (#150). */
  | { type: 'stem-gains'; gains: number[] }
  /** (Re)start playback at a track frame. Restart-while-running is an
   * internal declick splice (old voice fades while the new fades in). */
  | { type: 'start'; positionFrames: number; startId: number }
  /** Declick-fade to silence. Idempotent. */
  | { type: 'stop' }
  /** Key Lock: switch modes. Mid-play this is an internal crossfade at the
   * audible position — no click, no position jump. */
  | { type: 'mode'; mode: SourceMode }
  /** Active loop region (looping 03), or null to clear. A live voice
   * crossing the end from inside wraps with a declick splice. */
  | { type: 'loop'; region: LoopFrames | null };

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
  /** Start/stab attack fade (stab-declick 01); defaults to declickSeconds. */
  attackSeconds?: number;
}

/** Registered processor name. */
export const DECK_SOURCE_PROCESSOR = 'deck-source';

/** Name of the composed-rate AudioParam. */
export const RATE_PARAM = 'rate';
