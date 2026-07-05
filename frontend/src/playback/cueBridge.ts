/**
 * The Cue bus's cross-device delivery (ADR 0017). One AudioContext has one
 * output device, so the already-blended cue signal leaves the MAIN graph
 * through a MediaStreamAudioDestinationNode and re-enters a second, otherwise
 * empty AudioContext whose sink is the cue device. Everything that matters
 * musically (PFL taps, cue/mix blend, cue level) happens before this bridge,
 * in the main graph and on the main clock — the bridge only ships the result.
 *
 * Output channels (hardware-learned): a stereo stream lands on a device's
 * first pair, but the Inpulse enumerates as ONE 4-channel device whose
 * headphone jack is outputs 3/4 — so on a ≥4-out sink the bridge splits the
 * stereo cue onto channels 3/4 (cueChannelPair, the tested seam). Outs 1/2
 * stay free for master, which makes the all-Inpulse setup (master → RCA,
 * cue → headphones) work with no extra routing.
 *
 * If the cue device disappears the bridge is torn down (`stop`) and the Cue
 * bus goes silent; the main graph keeps feeding the destination node, which
 * costs nothing, and master audio is never at risk.
 *
 * Hands-on-verified (ADR 0002: no Web Audio mocking); the pure seams are
 * routing.ts and mixerMath.ts.
 */
import { cueChannelPair } from './routing';

export class CueBridge {
  private readonly destination: MediaStreamAudioDestinationNode;
  private cueCtx: AudioContext | null = null;

  constructor(mainCtx: AudioContext) {
    this.destination = mainCtx.createMediaStreamDestination();
  }

  /** The main-graph node the blended cue signal connects into. */
  get input(): AudioNode {
    return this.destination;
  }

  /**
   * Point the delivery at a cue output device. The context is rebuilt per
   * target — output wiring depends on the device's channel count (which is
   * only known after the sink applies), and a one-source context is cheap.
   * On failure (device vanished between enumeration and here) the bridge is
   * stopped — callers treat that as "cue disabled".
   */
  async setSink(sinkId: string): Promise<void> {
    this.stop();
    const ctx = new AudioContext();
    try {
      await ctx.setSinkId(sinkId);
      this.wireOutput(ctx);
      if (ctx.state === 'suspended') await ctx.resume();
      this.cueCtx = ctx;
    } catch (err) {
      void ctx.close();
      throw err;
    }
  }

  /** Tear delivery down (device gone / cue routed off). Safe to re-`setSink`. */
  stop(): void {
    if (this.cueCtx && this.cueCtx.state !== 'closed') void this.cueCtx.close();
    this.cueCtx = null;
  }

  /** Bridge-side latency numbers, for the tracer / issue comments. */
  latencyInfo(): { baseLatency: number; outputLatency: number } | null {
    if (!this.cueCtx || this.cueCtx.state === 'closed') return null;
    return {
      baseLatency: this.cueCtx.baseLatency,
      outputLatency: this.cueCtx.outputLatency,
    };
  }

  /** Bridge source → destination, on the channel pair the device calls for. */
  private wireOutput(ctx: AudioContext): void {
    const source = ctx.createMediaStreamSource(this.destination.stream);
    const pair = cueChannelPair(ctx.destination.maxChannelCount);
    if (!pair) {
      source.connect(ctx.destination);
      return;
    }
    // Open enough discrete output channels to reach the pair, then place
    // the stereo cue there explicitly ('discrete' = no speaker-layout
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
      `[CueBridge] ${ctx.destination.maxChannelCount}-out sink: cue on outputs ${pair.left + 1}/${pair.right + 1}`
    );
  }
}
