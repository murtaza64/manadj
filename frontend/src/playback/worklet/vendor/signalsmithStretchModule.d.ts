/**
 * Types for the vendored Signalsmith Stretch emscripten factory (MIT).
 * Method semantics from the package's own worklet processor: buffer mode
 * refills a window of `bufferLength` input frames ending just ahead of the
 * audible position every block, then `_seek` + `_process(0, frames)`.
 */

export interface SignalsmithWasmModule {
  _main(): void;
  _presetDefault(channels: number, sampleRate: number): void;
  _presetCheaper(channels: number, sampleRate: number): void;
  _configure(
    channels: number,
    blockSamples: number,
    intervalSamples: number,
    splitComputation: boolean
  ): void;
  _reset(): void;
  /** Frames of algorithmic input/output latency (window sizing). */
  _inputLatency(): number;
  _outputLatency(): number;
  /** Allocates in+out heap buffers; returns the base pointer: `channels`
   * input buffers of `bufferLength` floats, then `channels` output ones. */
  _setBuffers(channels: number, bufferLength: number): number;
  /** Transpose (none for Key Lock) + tonality limit as a fraction of the
   * sample rate. */
  _setTransposeSemitones(semitones: number, tonalityNorm: number): void;
  _setFormantSemitones(semitones: number, compensation: boolean): void;
  _setFormantBase(baseNorm: number): void;
  /** Declare the input window (buffer mode): `inputLength` frames ending at
   * the read-ahead position, playing at `rate`. */
  _seek(inputLength: number, rate: number): void;
  /** Produce `outputLength` frames (buffer mode passes inputLength 0). */
  _process(inputLength: number, outputLength: number): void;
  exports?: { memory: WebAssembly.Memory };
  HEAP8: Int8Array;
}

declare function SignalsmithStretch(): Promise<SignalsmithWasmModule>;
export default SignalsmithStretch;
