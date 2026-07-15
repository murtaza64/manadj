/**
 * CROSS-DEVICE bus delivery (ADR 0017, narrowed by four-deck 32). One
 * AudioContext has one output device, so a bus signal leaves the MAIN
 * graph through a MediaStreamAudioDestinationNode and re-enters a second,
 * otherwise empty AudioContext whose sink is the target device.
 * Everything that matters musically stays before this bridge, in the main
 * graph and on the main clock — the bridge only ships the result.
 *
 * Same-device buses do NOT come here: master (and cue on the master
 * device) plays through the main context's own destination via
 * planOutput/applyOutputRouting (routing.ts / mixer.ts), because a main
 * context whose destination renders silence gets its real sink swapped
 * for a timer-driven fake one after 30s (Chromium SilentSinkSuspender,
 * crbug.com/40247085) whose clock collapses under render load.
 *
 * Output channels (hardware-learned): a stereo stream lands on a device's
 * first pair, but the Inpulse enumerates as ONE 4-channel device whose
 * headphone jack is outputs 3/4. The picker lets the user choose the pair
 * explicitly (outputPairOptions, the tested seam). Device-specific defaults
 * are resolved before this bridge from hardware-verified Mapping knowledge;
 * this layer never guesses a multichannel device's physical channel order.
 *
 * If the cue device disappears the bridge is torn down (`stop`) and the Cue
 * bus goes silent; the main graph keeps feeding the destination node, which
 * costs nothing, and master audio is never at risk.
 *
 * Hands-on-verified (ADR 0002: no Web Audio mocking); the pure seams are
 * routing.ts and mixerMath.ts.
 */
import type { OutputPair } from './routing';

/**
 * Defeats Chromium's silent-sink suspender: an always-on DC offset at
 * ~-140 dBFS keeps AreFramesZero() false so the real device sink (and its
 * honest clock) is never swapped for the fake timer-driven one. Inaudible
 * and cheaper than the glitchy real↔fake transitions it prevents.
 */
export const SINK_KEEPALIVE_LEVEL = 1e-7;

/** Attach the keepalive to a context's destination (see above). */
export function attachSinkKeepalive(ctx: AudioContext): void {
  const keepalive = ctx.createConstantSource();
  keepalive.offset.value = SINK_KEEPALIVE_LEVEL;
  keepalive.connect(ctx.destination);
  keepalive.start();
}

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
    attachSinkKeepalive(ctx);
    const max = ctx.destination.maxChannelCount;
    // An explicit pair is user/hardware knowledge. If the live sink cannot
    // reach it, fail this bus rather than silently playing from another jack.
    if (chosen !== null && (chosen.left >= max || chosen.right >= max)) {
      throw new RangeError(
        `${debugName} output pair ${chosen.left + 1}/${chosen.right + 1} is unavailable on ${max}-channel sink`
      );
    }
    const pair = chosen ?? fallbackPair(max);
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
    await super.setSink(sinkId, pair, () => null, 'cue');
  }
}
