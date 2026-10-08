import { RepeatKernel } from './beatFxRepeatKernel';
import { BEAT_FX_REPEAT_PROCESSOR, type BeatFxRepeatCommand } from './beatFxRepeatProtocol';

declare const currentFrame: number;

/** TRANS/ROLL insert (#360): stereo in → stereo out through RepeatKernel. */
class BeatFxRepeatProcessor extends AudioWorkletProcessor {
  private readonly kernel = new RepeatKernel(sampleRate);
  private silent = new Float32Array(128);

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<BeatFxRepeatCommand>) => {
      const command = event.data;
      if (command.type === 'state') {
        this.kernel.setState(command.state, Math.max(currentFrame, Math.round(command.time * sampleRate)));
      } else if (command.type === 'clock') {
        this.kernel.setClock({
          frame: Math.round(command.time * sampleRate),
          beat: command.beat,
          beatFrames: command.beatSeconds * sampleRate,
        });
      } else {
        this.kernel.setSettings(command.settings);
      }
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const input = inputs[0];
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const n = output[0].length;
    if (this.silent.length !== n) this.silent = new Float32Array(n);
    const silent = this.silent;
    const inL = input?.[0] ?? silent;
    const inR = input?.[1] ?? inL;
    this.kernel.process(inL, inR, output[0], output[1] ?? silent, currentFrame);
    return true;
  }
}

registerProcessor(BEAT_FX_REPEAT_PROCESSOR, BeatFxRepeatProcessor);
