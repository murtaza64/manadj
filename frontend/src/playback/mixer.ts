/**
 * The Mixer owns the one AudioContext (ADR 0009). Decks are channel inputs.
 *
 * Signal chain per channel:
 *   deck envelopes -> channel input -> trim -> 3-band isolator EQ ->
 *   sweep filter -> channel fader -> crossfader gain -> master gain ->
 *   safety limiter (always on) -> destination
 *
 * Cue bus (headphone-cue, ADR 0017), all in the same graph/clock:
 *   per-channel PFL tap (post-EQ/filter, pre-fader) -> cue sum ->\
 *     cue-side blend gain  \
 *                           +-> cue gain (cue level) -> cue limiter ->
 *   program -> master-side /    MediaStream bridge -> second context
 *     blend gain (cue/mix)      sunk to the cue device (cueBridge.ts)
 *
 * "Program" is the summed post-crossfader signal BEFORE the master volume:
 * the cue/mix blend brings the room mix into the headphones without the
 * master fader changing headphone loudness. Blending in-graph (not across
 * the bridge) keeps cue and master sample-aligned where beatmatching
 * happens — inside the headphones.
 *
 * The context is created lazily and revived if closed (StrictMode dev
 * double-mount disposes once before the real mount) — this responsibility
 * moved up from DeckEngine. On revival the whole graph is rebuilt and all
 * control settings are reapplied.
 *
 * Decks reach their channel through a DeckAudioPort, so DeckEngine depends on
 * an interface, not on the Mixer.
 */

import {
  BUTTERWORTH_Q_DB,
  SWEEP_BYPASS_HZ,
  eqValueToGain,
  sweepPositionToFilter,
} from './graph';
import type { EqBand } from './graph';
import { CueBridge } from './cueBridge';
import type { OutputPair } from './routing';
import {
  channelFaderToGain,
  crossfaderGains,
  cueLevelToGain,
  cueMixGains,
  trimToGain,
} from './mixerMath';

export type ChannelId = 'A' | 'B';

/** What a deck needs from the audio layer: a live context and its channel input. */
export interface DeckAudioPort {
  ensureAudio(): { ctx: AudioContext; input: AudioNode };
  /** Arbiter tripwire (ADR 0013): may this surface start audible playback
   * right now? Absent = yes. Engines refuse start gestures (warned no-op)
   * when false, so no gesture path can resume a silenced surface's clock. */
  mayStart?(): boolean;
}

/** Per-channel control state, [0,1] except filter [-1,1] and pfl (bool). */
export interface ChannelState {
  trim: number;
  eq: Record<EqBand, number>;
  filter: number;
  fader: number;
  /** PFL (glossary): this channel feeds the Cue bus, pre-fader. */
  pfl: boolean;
}

const FLAT_CHANNEL: ChannelState = {
  trim: 0.5,
  eq: { low: 0.5, mid: 0.5, high: 0.5 },
  filter: 0,
  fader: 1,
  pfl: false, // session default: off (PRD)
};

/** Crossover frequencies — tweak by ear. */
const CROSSOVER_LOW_MID_HZ = 250;
const CROSSOVER_MID_HIGH_HZ = 2500;

/** Time constant for filter parameter smoothing (zipper-noise avoidance). */
const PARAM_SMOOTHING_S = 0.015;

/** Linear ramp length for gain moves (reaches the target exactly). */
const GAIN_RAMP_S = 0.05;

/** Session-default cue level: moderate, not unity — it feeds headphones
 * directly and the hardware knob jumps on first touch anyway. */
export const CUE_LEVEL_DEFAULT = 0.7;

/** Session-default cue/mix: cue only (user decision at the smoke test —
 * the PRD's "cue-heavy" default landed as 0.25 and got dialed to 0). */
export const CUE_MIX_DEFAULT = 0;

function makeFilter(
  ctx: AudioContext,
  type: 'lowpass' | 'highpass',
  frequency: number
): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = frequency;
  f.Q.value = BUTTERWORTH_Q_DB;
  return f;
}

function chain(nodes: AudioNode[]): void {
  for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
}

/** Safety limiter — two summed full-scale tracks clip otherwise. Used on
 * both bus outputs (master and cue). */
function makeLimiter(ctx: AudioContext): DynamicsCompressorNode {
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -3;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.25;
  return limiter;
}

/**
 * Ramp a gain param to a target, safely re-startable at animation-frame rate
 * (streamed automation — the Transition editor calls the channel setters per
 * frame). The current value is read BEFORE cancelling: cancelScheduledValues
 * reverts the param to its previous anchor, so the cancel-then-read order
 * freezes the gain at its old value and re-anchors with a 60Hz discontinuity
 * (audible as fuzz). Linear ramp so targets are actually reached (kill =
 * true zero, not a setTargetAtTime asymptote).
 */
function rampGain(ctx: AudioContext, param: AudioParam, target: number): void {
  const current = param.value; // computed value, including in-flight ramp progress
  const now = ctx.currentTime;
  param.cancelScheduledValues(now);
  param.setValueAtTime(current, now);
  param.linearRampToValueAtTime(target, now + GAIN_RAMP_S);
}

/** One channel strip: input -> trim -> isolator EQ -> sweep -> fader -> crossfader gain.
 * The PFL tap (headphone-cue 02) hangs off the sweep output — post-EQ/filter,
 * pre-fader/crossfader, so a cued channel is heard fully shaped with its
 * fader down. */
class ChannelStrip {
  readonly input: GainNode;
  readonly trimGain: GainNode;
  readonly bandGains: Record<EqBand, GainNode>;
  readonly sweep: BiquadFilterNode;
  readonly faderGain: GainNode;
  readonly crossfadeGain: GainNode;
  readonly pflGain: GainNode;

  constructor(ctx: AudioContext, state: ChannelState) {
    this.input = ctx.createGain();
    this.trimGain = ctx.createGain();
    this.trimGain.gain.value = trimToGain(state.trim);
    const sum = ctx.createGain();

    const low = [
      makeFilter(ctx, 'lowpass', CROSSOVER_LOW_MID_HZ),
      makeFilter(ctx, 'lowpass', CROSSOVER_LOW_MID_HZ),
      ctx.createGain(),
    ];
    const mid = [
      makeFilter(ctx, 'highpass', CROSSOVER_LOW_MID_HZ),
      makeFilter(ctx, 'highpass', CROSSOVER_LOW_MID_HZ),
      makeFilter(ctx, 'lowpass', CROSSOVER_MID_HIGH_HZ),
      makeFilter(ctx, 'lowpass', CROSSOVER_MID_HIGH_HZ),
      ctx.createGain(),
    ];
    const high = [
      makeFilter(ctx, 'highpass', CROSSOVER_MID_HIGH_HZ),
      makeFilter(ctx, 'highpass', CROSSOVER_MID_HIGH_HZ),
      ctx.createGain(),
    ];

    this.input.connect(this.trimGain);
    for (const band of [low, mid, high]) {
      this.trimGain.connect(band[0]);
      chain(band);
      band[band.length - 1].connect(sum);
    }

    this.bandGains = {
      low: low[low.length - 1] as GainNode,
      mid: mid[mid.length - 1] as GainNode,
      high: high[high.length - 1] as GainNode,
    };
    for (const band of ['low', 'mid', 'high'] as const) {
      this.bandGains[band].gain.value = eqValueToGain(state.eq[band]);
    }

    this.sweep = ctx.createBiquadFilter();
    this.sweep.type = 'lowpass';
    this.sweep.frequency.value = SWEEP_BYPASS_HZ;
    this.sweep.Q.value = BUTTERWORTH_Q_DB;

    this.faderGain = ctx.createGain();
    this.faderGain.gain.value = channelFaderToGain(state.fader);
    this.crossfadeGain = ctx.createGain();
    this.pflGain = ctx.createGain();
    this.pflGain.gain.value = state.pfl ? 1 : 0;

    sum.connect(this.sweep);
    this.sweep.connect(this.faderGain);
    this.sweep.connect(this.pflGain);
    this.faderGain.connect(this.crossfadeGain);
  }
}

export class Mixer {
  /** Answers the ports' arbiter tripwire (ADR 0013). The owner wires it at
   * construction (`new Mixer(() => isAudible('shared'))`) — the Mixer never
   * learns which surface it is. Absent = always allowed. */
  private readonly mayStart?: () => boolean;

  constructor(mayStart?: () => boolean) {
    this.mayStart = mayStart;
  }

  private ctx: AudioContext | null = null;
  private strips: Record<ChannelId, ChannelStrip> | null = null;
  private masterGain: GainNode | null = null;
  private cueGain: GainNode | null = null;
  private blendCueGain: GainNode | null = null;
  private blendMasterGain: GainNode | null = null;
  private cueBridge: CueBridge | null = null;
  private listeners = new Set<() => void>();

  // Control state survives graph rebuilds (StrictMode revival).
  private channels: Record<ChannelId, ChannelState> = {
    A: structuredClone(FLAT_CHANNEL),
    B: structuredClone(FLAT_CHANNEL),
  };
  private crossfader = 0; // -1 (A) .. 1 (B)
  /** Crossfader bypass: while false the fader position is kept but both
   * channels run at unity (as if centered) — an accidental-kill guard. */
  private crossfaderEnabled = true;
  private master = 1; // 0..1
  /** Master bus output device (headphone-cue 01); null = system default. */
  private masterSinkId: string | null = null;
  /** Cue bus output device (headphone-cue 02); null = Cue bus disabled —
   * PFL state still toggles, it just reaches no ears (PRD). */
  private cueSinkId: string | null = null;
  /** Output pair on the cue sink; null = device default / bridge auto. */
  private cuePair: OutputPair | null = null;
  private cueLevel = CUE_LEVEL_DEFAULT; // 0..1, session-scoped like the rest
  private cueMix = CUE_MIX_DEFAULT; // 0 (cue only) .. 1 (master only)

  /** Get (lazily creating / reviving) the live context and graph. */
  private ensure(): { ctx: AudioContext; strips: Record<ChannelId, ChannelStrip> } {
    if (!this.ctx || !this.strips || this.ctx.state === 'closed') {
      console.debug('[Mixer] creating AudioContext + graph');
      const ctx = new AudioContext();

      const strips: Record<ChannelId, ChannelStrip> = {
        A: new ChannelStrip(ctx, this.channels.A),
        B: new ChannelStrip(ctx, this.channels.B),
      };
      const masterGain = ctx.createGain();
      masterGain.gain.value = this.master;

      // Always-on master safety limiter.
      const limiter = makeLimiter(ctx);

      // "Program" = the summed post-crossfader signal, pre master volume —
      // what the room hears, before how loud the room hears it. The cue/mix
      // blend taps it here so the master fader never changes the headphones.
      const program = ctx.createGain();
      strips.A.crossfadeGain.connect(program);
      strips.B.crossfadeGain.connect(program);
      program.connect(masterGain);
      masterGain.connect(limiter);
      limiter.connect(ctx.destination);

      // Cue bus (headphone-cue 02/03, ADR 0017): PFL taps and the master
      // blend are mixed IN THE MAIN GRAPH and leave over the MediaStream
      // bridge. Its own safety limiter — two full-scale cued tracks clip
      // like the master case above.
      const cueSum = ctx.createGain();
      strips.A.pflGain.connect(cueSum);
      strips.B.pflGain.connect(cueSum);
      const { cue: cueSide, master: masterSide } = cueMixGains(this.cueMix);
      const blendCueGain = ctx.createGain();
      blendCueGain.gain.value = cueSide;
      const blendMasterGain = ctx.createGain();
      blendMasterGain.gain.value = masterSide;
      const cueGain = ctx.createGain();
      cueGain.gain.value = cueLevelToGain(this.cueLevel);
      const cueLimiter = makeLimiter(ctx);
      const cueBridge = new CueBridge(ctx);
      cueSum.connect(blendCueGain);
      program.connect(blendMasterGain);
      blendCueGain.connect(cueGain);
      blendMasterGain.connect(cueGain);
      cueGain.connect(cueLimiter);
      cueLimiter.connect(cueBridge.input);

      this.ctx = ctx;
      this.strips = strips;
      this.masterGain = masterGain;
      this.cueGain = cueGain;
      this.blendCueGain = blendCueGain;
      this.blendMasterGain = blendMasterGain;
      this.cueBridge = cueBridge;

      // Reapply position-dependent settings on the fresh graph.
      this.applyCrossfader(false);
      this.applyFilter('A');
      this.applyFilter('B');
      if (this.masterSinkId !== null) {
        void ctx.setSinkId(this.masterSinkId).catch((err: unknown) => {
          // Saved device gone at revival: stay on the default — master
          // audio must never die over routing (headphone-cue PRD).
          console.warn('[Mixer] master sink reapply failed; using default', err);
          this.masterSinkId = null;
        });
      }
      if (this.cueSinkId !== null) {
        void cueBridge.setSink(this.cueSinkId, this.cuePair).catch((err: unknown) => {
          // Cue device gone at revival: Cue bus disabled, master unaffected.
          console.warn('[Mixer] cue sink reapply failed; cue disabled', err);
          this.cueSinkId = null;
          this.notify();
        });
      }
    }
    return { ctx: this.ctx, strips: this.strips };
  }

  /**
   * The audio clock, seconds (creates/revives the graph if needed). The one
   * valid time base for anything that must stay in sync with deck playback —
   * wall clocks (performance.now) drift against context time, especially
   * with more than one context alive (see mix-editor issue 08).
   */
  now(): number {
    return this.ensure().ctx.currentTime;
  }

  /**
   * Suspend/resume the context ("one audible surface at a time" — a mounted
   * editor suspends the shared Mixer). Loads/decodes still work while
   * suspended; DeckEngine.startAudio resumes on demand.
   */
  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** The audio access a deck is constructed against. */
  portFor(channel: ChannelId): DeckAudioPort {
    return {
      ensureAudio: () => {
        const { ctx, strips } = this.ensure();
        return { ctx, input: strips[channel].input };
      },
      mayStart: this.mayStart,
    };
  }

  /**
   * Control-state change subscription (midi-controller 09). Mixer state is
   * still module state, not React state (ADR 0009) — but on-screen controls
   * subscribe so hardware moves repaint them. Fires after every setter;
   * channel states are replaced immutably, so snapshot selectors can rely
   * on reference/primitive equality.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  getChannelState(channel: ChannelId): ChannelState {
    return this.channels[channel];
  }

  getCrossfader(): number {
    return this.crossfader;
  }

  getMaster(): number {
    return this.master;
  }

  setTrim(channel: ChannelId, value: number): void {
    this.channels[channel] = { ...this.channels[channel], trim: value };
    this.notify();
    const { ctx, strips } = this.ensure();
    rampGain(ctx, strips[channel].trimGain.gain, trimToGain(value));
  }

  /** value in [0, 1]: 0 = kill, 0.5 = flat, 1 = +6 dB. */
  setEq(channel: ChannelId, band: EqBand, value: number): void {
    const ch = this.channels[channel];
    this.channels[channel] = { ...ch, eq: { ...ch.eq, [band]: value } };
    this.notify();
    const { ctx, strips } = this.ensure();
    rampGain(ctx, strips[channel].bandGains[band].gain, eqValueToGain(value));
  }

  /** position in [-1, 1]: negative = LPF, positive = HPF, center = bypass. */
  setFilter(channel: ChannelId, position: number): void {
    this.channels[channel] = { ...this.channels[channel], filter: position };
    this.notify();
    this.ensure();
    this.applyFilter(channel);
  }

  setFader(channel: ChannelId, value: number): void {
    this.channels[channel] = { ...this.channels[channel], fader: value };
    this.notify();
    const { ctx, strips } = this.ensure();
    rampGain(ctx, strips[channel].faderGain.gain, channelFaderToGain(value));
  }

  /** position in [-1 (full A), 1 (full B)]. */
  setCrossfader(position: number): void {
    this.crossfader = position;
    this.notify();
    this.ensure();
    this.applyCrossfader(true);
  }

  getCrossfaderEnabled(): boolean {
    return this.crossfaderEnabled;
  }

  setCrossfaderEnabled(enabled: boolean): void {
    this.crossfaderEnabled = enabled;
    this.notify();
    this.ensure();
    this.applyCrossfader(true);
  }

  setMaster(value: number): void {
    this.master = value;
    this.notify();
    const { ctx } = this.ensure();
    if (this.masterGain) rampGain(ctx, this.masterGain.gain, value);
  }

  /**
   * Route the Master bus — the whole main context — to an output device
   * (headphone-cue 01, ADR 0017). null = system default. Remembered across
   * graph revivals; rejects if the device is gone (callers fall back per
   * routing.ts).
   */
  async setMasterSinkId(sinkId: string | null): Promise<void> {
    const { ctx } = this.ensure();
    await ctx.setSinkId(sinkId ?? '');
    this.masterSinkId = sinkId;
  }

  // ── Cue bus (headphone-cue 02, ADR 0017) ─────────────────────────────

  /** PFL this channel into the headphones — post-EQ/filter, pre-fader.
   * Both channels may be cued at once (they sum). */
  setPfl(channel: ChannelId, on: boolean): void {
    this.channels[channel] = { ...this.channels[channel], pfl: on };
    this.notify();
    const { ctx, strips } = this.ensure();
    rampGain(ctx, strips[channel].pflGain.gain, on ? 1 : 0);
  }

  togglePfl(channel: ChannelId): void {
    this.setPfl(channel, !this.channels[channel].pfl);
  }

  getCueLevel(): number {
    return this.cueLevel;
  }

  /** Cue bus volume (the headphone-level knob), 0..1. */
  setCueLevel(value: number): void {
    this.cueLevel = value;
    this.notify();
    const { ctx } = this.ensure();
    if (this.cueGain) rampGain(ctx, this.cueGain.gain, cueLevelToGain(value));
  }

  getCueMix(): number {
    return this.cueMix;
  }

  /** Cue/mix blend, 0 (cue only) .. 1 (master only). Equal-power, applied
   * before the bridge so the headphones stay sample-aligned (ADR 0017). */
  setCueMix(value: number): void {
    this.cueMix = value;
    this.notify();
    const { ctx } = this.ensure();
    const { cue, master } = cueMixGains(value);
    if (this.blendCueGain) rampGain(ctx, this.blendCueGain.gain, cue);
    if (this.blendMasterGain) rampGain(ctx, this.blendMasterGain.gain, master);
  }

  getCueSinkId(): string | null {
    return this.cueSinkId;
  }

  /**
   * Route the Cue bus to an output device over the bridge, optionally on
   * an explicit output pair (picker "(outs 3/4)" entries; null = device
   * default / auto). null sink tears the delivery down (Cue bus disabled —
   * PFL state keeps toggling, silently). Rejects (and stays disabled) if
   * the device is gone; master is never affected by cue routing.
   */
  async setCueSinkId(sinkId: string | null, pair: OutputPair | null = null): Promise<void> {
    if (sinkId === null) {
      this.cueSinkId = null;
      this.cuePair = null;
      this.cueBridge?.stop();
      this.notify();
      return;
    }
    this.ensure(); // the bridge exists after this
    try {
      await this.cueBridge!.setSink(sinkId, pair);
      this.cueSinkId = sinkId;
      this.cuePair = pair;
    } catch (err) {
      this.cueSinkId = null;
      this.cuePair = null;
      throw err;
    } finally {
      this.notify();
    }
  }

  /** Tear down. Safe to keep using — the graph revives on demand. */
  dispose(): void {
    this.cueBridge?.stop();
    if (this.ctx && this.ctx.state !== 'closed') void this.ctx.close();
    this.ctx = null;
    this.strips = null;
    this.masterGain = null;
    this.cueGain = null;
    this.blendCueGain = null;
    this.blendMasterGain = null;
    this.cueBridge = null;
  }

  private applyCrossfader(ramp: boolean): void {
    if (!this.ctx || !this.strips) return;
    const { a, b } = crossfaderGains(this.crossfaderEnabled ? this.crossfader : 0);
    if (ramp) {
      rampGain(this.ctx, this.strips.A.crossfadeGain.gain, a);
      rampGain(this.ctx, this.strips.B.crossfadeGain.gain, b);
    } else {
      this.strips.A.crossfadeGain.gain.value = a;
      this.strips.B.crossfadeGain.gain.value = b;
    }
  }

  private applyFilter(channel: ChannelId): void {
    if (!this.ctx || !this.strips) return;
    const sweep = this.strips[channel].sweep;
    const { type, frequency, qDb } = sweepPositionToFilter(this.channels[channel].filter);
    const now = this.ctx.currentTime;
    if (sweep.type !== type) {
      // `type` is not an AudioParam and flips instantaneously. Make the new
      // filter transparent at the flip, then ramp — avoids a pop mid-sweep.
      sweep.type = type;
      const transparentHz = type === 'lowpass' ? SWEEP_BYPASS_HZ : 20;
      sweep.frequency.cancelScheduledValues(now);
      sweep.frequency.setValueAtTime(transparentHz, now);
      sweep.Q.cancelScheduledValues(now);
      sweep.Q.setValueAtTime(BUTTERWORTH_Q_DB, now);
    }
    sweep.frequency.setTargetAtTime(frequency, now, PARAM_SMOOTHING_S);
    sweep.Q.setTargetAtTime(qDb, now, PARAM_SMOOTHING_S);
  }
}
