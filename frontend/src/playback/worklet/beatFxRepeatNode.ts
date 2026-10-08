import processorUrl from './beatFxRepeatProcessor?worker&url';
import { BEAT_FX_REPEAT_PROCESSOR, type BeatFxRepeatCommand } from './beatFxRepeatProtocol';

const moduleReady = new WeakMap<BaseAudioContext, Promise<void>>();

/**
 * Load the TRANS/ROLL processor and build its node (#360). Resolves null
 * where AudioWorklet is unavailable (test fakes): the insert then keeps its
 * pass-through and TRANS/ROLL are silent no-ops.
 */
export async function createBeatFxRepeatNode(ctx: BaseAudioContext): Promise<{
  node: AudioNode;
  post: (command: BeatFxRepeatCommand) => void;
} | null> {
  const worklet = (ctx as Partial<AudioContext>).audioWorklet;
  if (!worklet || typeof AudioWorkletNode === 'undefined') return null;
  let ready = moduleReady.get(ctx);
  if (!ready) {
    ready = worklet.addModule(processorUrl);
    moduleReady.set(ctx, ready);
  }
  await ready;
  const node = new AudioWorkletNode(ctx, BEAT_FX_REPEAT_PROCESSOR, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: 'explicit',
  });
  return { node, post: (command) => node.port.postMessage(command) };
}
