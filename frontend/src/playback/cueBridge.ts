/**
 * Cross-device / output-pair bus delivery (ADR 0017). One AudioContext has
 * one output device, so a bus signal leaves the MAIN graph through a
 * MediaStreamAudioDestinationNode and re-enters a second, otherwise empty
 * AudioContext whose sink is the target device. Everything that matters
 * musically stays before this bridge, in the main graph and on the main
 * clock — the bridge only ships the result.
 *
 * Output channels (hardware-learned): a stereo stream lands on a device's
 * first pair, but the Inpulse enumerates as ONE 4-channel device whose
 * headphone jack is outputs 3/4. The picker lets the user choose the pair
 * explicitly (outputPairOptions, the tested seam); without a choice the
 * bridge falls back to cueChannelPair's auto default (3/4 on ≥4-out
 * sinks). Outs 1/2 stay free for master, which makes the all-Inpulse setup
 * (master → RCA, cue → headphones) work with no extra routing.
 *
 * If the cue device disappears the bridge is torn down (`stop`) and the Cue
 * bus goes silent; the main graph keeps feeding the destination node, which
 * costs nothing, and master audio is never at risk.
 *
 * Hands-on-verified (ADR 0002: no Web Audio mocking); the pure seams are
 * routing.ts and mixerMath.ts.
 */
import { cueChannelPair } from './routing';
import type { OutputPair } from './routing';

type FallbackPair = (maxChannelCount: number) => OutputPair | null;

export class BusOutputBridge {
  private readonly destination: MediaStreamAudioDestinationNode;
  private outputCtx: AudioContext | null = null;

  constructor(mainCtx: AudioContext) {
    this.destination = mainCtx.createMediaStreamDestination();
  }

  /** The main-graph node the bus signal connects into. */
  get input(): AudioNode {
    return this.destination;
  }

  /**
   * Point the delivery at an output device, optionally on an explicit
   * output pair (the picker's "(outs 3/4)" entries); null = auto. The
   * context is rebuilt per target — output wiring depends on the device's
   * channel count (which is only known after the sink applies), and a
   * one-source context is cheap. On failure (device vanished between
    * enumeration and here) the bridge is stopped — callers degrade per bus.
   */
  async setSink(
    sinkId: string,
    pair: OutputPair | null = null,
    fallbackPair: FallbackPair = () => null,
    debugName = 'bus'
  ): Promise<void> {
    this.stop();
    const ctx = new AudioContext();
    try {
      await ctx.setSinkId(sinkId);
      this.wireOutput(ctx, pair, fallbackPair, debugName);
      if (ctx.state === 'suspended') await ctx.resume();
      this.outputCtx = ctx;
    } catch (err) {
      void ctx.close();
      throw err;
    }
  }

  /** Tear delivery down (device gone / routed off). Safe to re-`setSink`. */
  stop(): void {
    if (this.outputCtx && this.outputCtx.state !== 'closed') void this.outputCtx.close();
    this.outputCtx = null;
  }

  /** Bridge-side latency numbers, for the tracer / issue comments. */
  latencyInfo(): { baseLatency: number; outputLatency: number } | null {
    if (!this.outputCtx || this.outputCtx.state === 'closed') return null;
    return {
      baseLatency: this.outputCtx.baseLatency,
      outputLatency: this.outputCtx.outputLatency,
    };
  }

  /** Bridge source → destination, on the chosen (or fallback) channel pair. */
  private wireOutput(
    ctx: AudioContext,
    chosen: OutputPair | null,
    fallbackPair: FallbackPair,
    debugName: string
  ): void {
    const source = ctx.createMediaStreamSource(this.destination.stream);
    const max = ctx.destination.maxChannelCount;
    // An explicit pair the device can't actually reach (it changed shape
    // since it was saved) degrades to the bus fallback rather than throwing.
    const pair = chosen !== null && chosen.right < max ? chosen : fallbackPair(max);
    if (!pair) {
      source.connect(ctx.destination);
      return;
    }
    // Open enough discrete output channels to reach the pair, then place
    // the stereo bus there explicitly ('discrete' = no speaker-layout
    // up/down-mixing between the merger and the hardware).
    const channels = pair.right + 1;
    ctx.destination.channelCount = channels;
    ctx.destination.channelInterpretation = 'discrete';
    const splitter = ctx.createChannelSplitter(2);
    const merger = ctx.createChannelMerger(channels);
    source.connect(splitter);
    splitter.connect(merger, 0, pair.left);
    splitter.connect(merger, 1, pair.right);
    merger.connect(ctx.destination);
    console.debug(
      `[BusOutputBridge] ${ctx.destination.maxChannelCount}-out sink: ${debugName} on outputs ${pair.left + 1}/${pair.right + 1}`
    );
  }
}

export class CueBridge extends BusOutputBridge {
  async setSink(sinkId: string, pair: OutputPair | null = null): Promise<void> {
    await super.setSink(sinkId, pair, cueChannelPair, 'cue');
  }
}
