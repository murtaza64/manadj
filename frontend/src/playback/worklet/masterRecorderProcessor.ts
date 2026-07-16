import {
  MASTER_RECORDER_PROCESSOR,
} from './masterRecorderProtocol';
import type {
  MasterRecorderCommand,
  MasterRecorderEvent,
} from './masterRecorderProtocol';

const BATCH_FRAMES = 8192;

class MasterRecorderProcessor extends AudioWorkletProcessor {
  private buffer = new Float32Array(BATCH_FRAMES * 2);
  private frames = 0;

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<MasterRecorderCommand>) => {
      if (event.data.type !== 'flush') return;
      this.flush();
      this.post({ type: 'flushed' });
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0 || !output) return true;
    const left = input[0];
    const right = input[1] ?? left;
    output[0]?.set(left);
    output[1]?.set(right);

    for (let frame = 0; frame < left.length; frame++) {
      const offset = this.frames * 2;
      this.buffer[offset] = left[frame];
      this.buffer[offset + 1] = right[frame] ?? left[frame];
      this.frames += 1;
      if (this.frames === BATCH_FRAMES) this.flush();
    }
    return true;
  }

  private flush(): void {
    if (this.frames === 0) return;
    const buffer =
      this.frames === BATCH_FRAMES
        ? this.buffer.buffer
        : this.buffer.slice(0, this.frames * 2).buffer;
    this.post({ type: 'chunk', buffer }, [buffer]);
    this.buffer = new Float32Array(BATCH_FRAMES * 2);
    this.frames = 0;
  }

  private post(event: MasterRecorderEvent, transfer: Transferable[] = []): void {
    this.port.postMessage(event, transfer);
  }
}

registerProcessor(MASTER_RECORDER_PROCESSOR, MasterRecorderProcessor);
