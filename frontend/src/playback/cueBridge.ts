/**
 * The Cue bus's cross-device delivery (ADR 0017). One AudioContext has one
 * output device, so the already-blended cue signal leaves the MAIN graph
 * through a MediaStreamAudioDestinationNode and re-enters a second, otherwise
 * empty AudioContext whose sink is the cue device. Everything that matters
 * musically (PFL taps, cue/mix blend, cue level) happens before this bridge,
 * in the main graph and on the main clock — the bridge only ships the result.
 *
 * If the cue device disappears the bridge is torn down (`stop`) and the Cue
 * bus goes silent; the main graph keeps feeding the destination node, which
 * costs nothing, and master audio is never at risk.
 *
 * Hands-on-verified (ADR 0002: no Web Audio mocking); the pure seams are
 * routing.ts and mixerMath.ts.
 */
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
   * Point the delivery at a cue output device, creating the second context
   * on first use. On failure (device vanished between enumeration and here)
   * the bridge is stopped — callers treat that as "cue disabled".
   */
  async setSink(sinkId: string): Promise<void> {
    if (!this.cueCtx || this.cueCtx.state === 'closed') {
      const ctx = new AudioContext();
      ctx.createMediaStreamSource(this.destination.stream).connect(ctx.destination);
      this.cueCtx = ctx;
    }
    try {
      await this.cueCtx.setSinkId(sinkId);
      if (this.cueCtx.state === 'suspended') await this.cueCtx.resume();
    } catch (err) {
      this.stop();
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
}
