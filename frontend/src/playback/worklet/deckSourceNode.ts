/**
 * DeckSourceNode — main-thread wrapper around the deck-source worklet
 * (ADR 0018). Owns module registration (deduped per AudioContext), node
 * construction, the command port, and the rate AudioParam.
 *
 * Creation is the only async step (addModule + node construction); after
 * that every command is a fire-and-forget ordered message, so the engine's
 * start/stop/seek paths stay synchronous.
 *
 * Sample handover (issue 02 decision): copy the AudioBuffer's channel data
 * and TRANSFER the copies. One extra copy resident per loaded deck
 * (~50-100MB for a long track), but the AudioBuffer itself stays intact in
 * the buffer cache for cross-surface reuse (mix-editor 28) and for context
 * revival. SharedArrayBuffer was rejected (needs cross-origin isolation);
 * transferring the cache's own buffers would poison the cache.
 */

import processorUrl from './deckSourceProcessor?worker&url';
import { DECLICK_S } from '../graph';
import { DECK_SOURCE_PROCESSOR, RATE_PARAM } from './protocol';
import type {
  DeckSourceCommand,
  DeckSourceEvent,
  DeckSourceProcessorOptions,
} from './protocol';

/** addModule once per context (both Decks share the Mixer's context). */
const moduleReady = new WeakMap<BaseAudioContext, Promise<void>>();

function ensureModule(ctx: AudioContext): Promise<void> {
  let ready = moduleReady.get(ctx);
  if (!ready) {
    ready = ctx.audioWorklet.addModule(processorUrl);
    moduleReady.set(ctx, ready);
  }
  return ready;
}

export class DeckSourceNode {
  static async create(ctx: AudioContext): Promise<DeckSourceNode> {
    await ensureModule(ctx);
    return new DeckSourceNode(ctx);
  }

  readonly ctx: AudioContext;
  /** The live voice ran off the end of the track (stale-guarded by startId). */
  onEnded: ((startId: number) => void) | null = null;

  private readonly node: AudioWorkletNode;
  private readonly rate: AudioParam;

  private constructor(ctx: AudioContext) {
    this.ctx = ctx;
    const processorOptions: DeckSourceProcessorOptions = {
      declickSeconds: DECLICK_S,
    };
    this.node = new AudioWorkletNode(ctx, DECK_SOURCE_PROCESSOR, {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions,
    });
    const rate = this.node.parameters.get(RATE_PARAM);
    if (!rate) throw new Error('deck-source processor is missing its rate param');
    this.rate = rate;
    this.node.port.onmessage = (event: MessageEvent<DeckSourceEvent>) => {
      if (event.data.type === 'ended') this.onEnded?.(event.data.startId);
    };
  }

  /** Hand the decoded track to the audio thread (copy, then transfer). */
  loadTrack(buffer: AudioBuffer): void {
    const channels: Float32Array[] = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      channels.push(buffer.getChannelData(c).slice());
    }
    this.post(
      { type: 'load', channels, sampleRate: buffer.sampleRate },
      channels.map((channel) => channel.buffer)
    );
  }

  start(positionFrames: number, startId: number): void {
    this.post({ type: 'start', positionFrames, startId });
  }

  stop(): void {
    this.post({ type: 'stop' });
  }

  /** Sample-accurate composed-rate step (the anchor-clock contract). */
  setRateAt(rate: number, ctxTime: number): void {
    this.rate.setValueAtTime(rate, ctxTime);
  }

  connect(destination: AudioNode): void {
    this.node.connect(destination);
  }

  disconnect(): void {
    this.node.disconnect();
  }

  private post(command: DeckSourceCommand, transfer?: Transferable[]): void {
    if (transfer) this.node.port.postMessage(command, transfer);
    else this.node.port.postMessage(command);
  }
}
