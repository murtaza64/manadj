/**
 * deck-source AudioWorkletProcessor — the audio-thread half of the Deck's
 * dual-mode pull source (ADR 0018). Thin adapter: message decoding and the
 * rate AudioParam in, DeckSourceKernel does all the work; stretch mode
 * (Key Lock) plugs Signalsmith Stretch (bake-off winner, issue 01) into the
 * kernel's StretchEngine seam.
 *
 * This module is bundled separately (audioWorklet.addModule) — it may only
 * import from ./deckSourceKernel, ./protocol, and ./vendor (pure/worklet-
 * safe by contract); nothing that could ever touch the DOM or window.
 * Tunables like the declick length arrive via processorOptions instead of
 * imports for this reason.
 */

import { DeckSourceKernel } from './deckSourceKernel';
import { DECK_SOURCE_PROCESSOR, RATE_PARAM } from './protocol';
import type {
  DeckSourceCommand,
  DeckSourceEvent,
  DeckSourceProcessorOptions,
} from './protocol';
import type { StretchEngine } from './deckSourceKernel';
import { fillStretchWindow } from './windowFill';
import createSignalsmithModule from './vendor/signalsmithStretchModule';
import type { SignalsmithWasmModule } from './vendor/signalsmithStretchModule';

/** Signalsmith tonality limit — the stretcher treats content above this as
 * noise-like rather than tonal (the package's own default). */
const TONALITY_LIMIT_HZ = 8000;

/**
 * Signalsmith Stretch behind the kernel's StretchEngine seam.
 *
 * Window model (mirrors the package's own buffer-mode processor): every
 * block, refill the whole `bufferLength` input window so that it ends at
 * position + rate × outputLatency + inputLatency — the stretcher's
 * algorithmic latency becomes input READ-AHEAD into the decoded track
 * (ADR 0018 / Mixxx), so output at frame 0 sounds the requested position:
 * stabs and mode switches have no onset delay. `_seek` per block makes
 * seeking free (reset only re-primes on a fresh voice).
 */
class SignalsmithEngine implements StretchEngine {
  ready = false;

  private m: SignalsmithWasmModule | null = null;
  private bufferLength = 0;
  private inPtrs: number[] = [];
  private outPtrs: number[] = [];
  private readonly channels = 2;

  constructor(onError: (err: unknown) => void) {
    createSignalsmithModule().then((m) => {
      m._main();
      m._presetDefault(this.channels, sampleRate);
      this.bufferLength = m._inputLatency() + m._outputLatency();
      const base = m._setBuffers(this.channels, this.bufferLength);
      const bytes = this.bufferLength * 4;
      for (let c = 0; c < this.channels; c++) {
        this.inPtrs.push(base + bytes * c);
        this.outPtrs.push(base + bytes * (this.channels + c));
      }
      SignalsmithEngine.applyNoTranspose(m); // Key Lock: rate without Key change
      m._setFormantSemitones(0, false);
      m._setFormantBase(0);
      this.m = m;
      this.ready = true;
    }, onError);
  }

  private static applyNoTranspose(m: SignalsmithWasmModule): void {
    m._setTransposeSemitones(0, TONALITY_LIMIT_HZ / sampleRate);
  }

  reset(): void {
    const m = this.m;
    if (!m) return;
    m._reset();
    SignalsmithEngine.applyNoTranspose(m);
  }

  render(
    out: Float32Array[],
    frames: number,
    channels: Float32Array[],
    positionFrames: number,
    rate: number
  ): void {
    const m = this.m;
    if (!m) return;
    const memory = m.exports ? m.exports.memory.buffer : m.HEAP8.buffer;
    // Read-ahead window ends past the audible position by the stretcher's
    // full latency (input + output×rate, both in track frames here).
    const windowEnd = Math.round(
      positionFrames + rate * m._outputLatency() + m._inputLatency()
    );
    const windowStart = windowEnd - this.bufferLength;
    for (let c = 0; c < this.channels; c++) {
      const heap = new Float32Array(memory, this.inPtrs[c], this.bufferLength);
      fillStretchWindow(heap, channels[Math.min(c, channels.length - 1)], windowStart);
    }
    m._seek(this.bufferLength, rate);
    m._process(0, frames);
    // Heap may have grown during processing: re-derive the views.
    const outMemory = m.exports ? m.exports.memory.buffer : m.HEAP8.buffer;
    for (let c = 0; c < out.length; c++) {
      const heap = new Float32Array(outMemory, this.outPtrs[Math.min(c, this.channels - 1)], frames);
      out[c].set(heap.subarray(0, frames));
    }
  }
}

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
    this.kernel.setStretchEngine(
      new SignalsmithEngine((err) => {
        const message: DeckSourceEvent = {
          type: 'stretch-error',
          message: String(err),
        };
        this.port.postMessage(message);
      })
    );
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
        case 'mode':
          this.kernel.setMode(command.mode);
          break;
        case 'loop':
          this.kernel.setLoop(command.region);
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
