import processorUrl from './masterRecorderProcessor?worker&url';
import {
  MASTER_RECORDER_PROCESSOR,
} from './masterRecorderProtocol';
import type {
  MasterRecorderCommand,
  MasterRecorderEvent,
} from './masterRecorderProtocol';

const moduleReady = new WeakMap<BaseAudioContext, Promise<void>>();

async function ensureModule(ctx: AudioContext): Promise<void> {
  let ready = moduleReady.get(ctx);
  if (!ready) {
    ready = ctx.audioWorklet.addModule(processorUrl);
    moduleReady.set(ctx, ready);
  }
  await ready;
}

export class MasterRecorderNode {
  static async create(
    ctx: AudioContext,
    onChunk: (buffer: ArrayBuffer) => void
  ): Promise<MasterRecorderNode> {
    await ensureModule(ctx);
    return new MasterRecorderNode(ctx, onChunk);
  }

  readonly input: AudioNode;
  private readonly node: AudioWorkletNode;
  private readonly mute: GainNode;
  private flushResolve: (() => void) | null = null;
  private flushReject: ((error: Error) => void) | null = null;

  private constructor(ctx: AudioContext, onChunk: (buffer: ArrayBuffer) => void) {
    this.node = new AudioWorkletNode(ctx, MASTER_RECORDER_PROCESSOR, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
    });
    this.input = this.node;
    this.mute = ctx.createGain();
    this.mute.gain.value = 0;
    this.node.connect(this.mute);
    this.mute.connect(ctx.destination);
    this.node.port.onmessage = (event: MessageEvent<MasterRecorderEvent>) => {
      if (event.data.type === 'chunk') onChunk(event.data.buffer);
      else {
        this.flushResolve?.();
        this.flushResolve = null;
        this.flushReject = null;
      }
    };
    this.node.addEventListener('processorerror', () => {
      this.flushReject?.(new Error('master recorder audio processor failed'));
      this.flushResolve = null;
      this.flushReject = null;
    });
  }

  flush(): Promise<void> {
    if (this.flushResolve) throw new Error('master recorder flush already pending');
    return new Promise((resolve, reject) => {
      this.flushResolve = resolve;
      this.flushReject = reject;
      const command: MasterRecorderCommand = { type: 'flush' };
      this.node.port.postMessage(command);
    });
  }

  dispose(): void {
    this.node.port.close();
    this.node.disconnect();
    this.mute.disconnect();
  }
}
