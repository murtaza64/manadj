/**
 * deck-source AudioWorkletProcessor — the audio-thread half of the Deck's
 * dual-mode pull source (ADR 0018). Thin adapter: message decoding and the
 * rate AudioParam in, DeckSourceKernel does all the work. Issue 02 ships
 * resample mode only; the stretch mode slots in behind the same kernel seam.
 *
 * This module is bundled separately (audioWorklet.addModule) — it may only
 * import from ./deckSourceKernel and ./protocol (pure by contract); nothing
 * that could ever touch the DOM or window. Tunables like the declick length
 * arrive via processorOptions instead of imports for this reason.
 */

import { DeckSourceKernel } from './deckSourceKernel';
import { DECK_SOURCE_PROCESSOR, RATE_PARAM } from './protocol';
import type {
  DeckSourceCommand,
  DeckSourceEvent,
  DeckSourceProcessorOptions,
} from './protocol';

class DeckSourceProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: RATE_PARAM,
        defaultValue: 1,
        minValue: 0,
        maxValue: 8,
        automationRate: 'a-rate' as const,
      },
    ];
  }

  private readonly kernel: DeckSourceKernel;

  constructor(options?: { processorOptions?: DeckSourceProcessorOptions }) {
    super();
    const declickSeconds = options?.processorOptions?.declickSeconds ?? 0.005;
    this.kernel = new DeckSourceKernel(Math.round(declickSeconds * sampleRate));
    this.port.onmessage = (event: MessageEvent<DeckSourceCommand>) => {
      const command = event.data;
      switch (command.type) {
        case 'load':
          this.kernel.setTrack(command.channels, command.sampleRate / sampleRate);
          break;
        case 'start':
          this.kernel.start(command.positionFrames, command.startId);
          break;
        case 'stop':
          this.kernel.stop();
          break;
      }
    };
  }

  process(
    _inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>
  ): boolean {
    const endedStartId = this.kernel.render(outputs[0], parameters[RATE_PARAM]);
    if (endedStartId !== null) {
      const message: DeckSourceEvent = { type: 'ended', startId: endedStartId };
      this.port.postMessage(message);
    }
    return true; // persistent node; lifetime is the engine's concern
  }
}

registerProcessor(DECK_SOURCE_PROCESSOR, DeckSourceProcessor);
