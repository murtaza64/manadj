/**
 * Ambient declarations for the AudioWorkletGlobalScope — TS 5.9's DOM lib
 * has the node-side types (AudioWorkletNode) but not the processor-side
 * globals. Only what deckSourceProcessor.ts uses. Note these are global
 * declarations: main-thread code should not reference them.
 */

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: { processorOptions?: unknown });
}

declare function registerProcessor(
  name: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  processorCtor: new (options?: any) => AudioWorkletProcessor & {
    process(
      inputs: Float32Array[][],
      outputs: Float32Array[][],
      parameters: Record<string, Float32Array>
    ): boolean;
  }
): void;

/** Output sample rate of the worklet's BaseAudioContext. */
declare const sampleRate: number;
