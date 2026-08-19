/**
 * The Mixer owns the one AudioContext (ADR 0009). Decks are channel inputs.
 *
 * Signal chain per channel:
 *   deck envelopes -> channel input -> trim -> 3-band isolator EQ ->
 *   sweep filter -> channel fader -> crossfader gain -> master gain ->
 *   -2 dBFS sample ceiling (always on) -> destination
 *
 * Cue bus (headphone-cue, ADR 0017), all in the same graph/clock:
 *   per-channel PFL tap (post-EQ/filter, pre-fader) -> cue sum ->\
 *     cue-side blend gain  \
 *                           +-> cue gain (cue level) -> cue ceiling ->
 *   program -> master-side /    same-device: merger into the main
 *     blend gain (cue/mix)      destination; cross-device: MediaStream
 *                               bridge -> second context (cueBridge.ts)
 *
 * Output delivery (four-deck 32): the main context's sink IS the master
 * device — master never leaves over a bridge, so the destination that
 * drives the deck clock always carries the room's audio. Cue shares the
 * main destination (discrete channels + merger) when it targets the same
 * device on an explicit pair; the bridge remains for cross-device cue.
 * See planOutput (routing.ts) and SINK_KEEPALIVE_LEVEL (cueBridge.ts) for
 * the silent-sink-suspender rationale (crbug.com/40247085).
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
 * Automation overlay (ADR 0022): the Transition editor's conductor drives
 * the 10 lane-driven params (fader/EQ/filter × 2) through a distinct
 * write-path with replacement semantics — engage/setAutomation/disengage.
 * Base state is never mutated by automation; disengage reapplies it. The
 * crossfader pins to neutral while engaged. Trim, master, cue, and PFL
 * stay live user controls throughout.
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
import { CueBridge, attachSinkKeepalive } from './cueBridge';
import { planOutput } from './routing';
import type { OutputPair } from './routing';
import {
  loadCrossfaderAssignments,
  loadCrossfaderEnabled,
  loadCrossfaderPosition,
  saveCrossfaderAssignments,
  saveCrossfaderEnabled,
  saveCrossfaderPosition,
} from './crossfaderAssignmentStore';
import type {
  CrossfaderAssignment,
  CrossfaderAssignments,
} from './crossfaderAssignmentStore';
import {
  channelFaderToGain,
  channelCrossfaderGain,
  cueLevelToGain,
  cueMixGains,
  MASTER_UNITY_VALUE,
  masterValueToGain,
  trimToGain,
} from './mixerMath';
import { samplePeakCeilingCurve } from './gainStaging';

export const CHANNEL_IDS = ['A', 'B', 'C', 'D'] as const;
export type ChannelId = (typeof CHANNEL_IDS)[number];

/**
 * What a notify touched (capture spine 02): a channel id names that
 * channel's ChannelState or crossfader-assignment; the string tags name a
 * channel-less global. `undefined` = unknown/everything (graph revival,
 * routing) — subscribers must then diff the whole surface. Channel-scoped
 * subscribers (recorder, Conductor/Replay watchers) diff only the touched
 * channel, skipping the per-channel loop for a single fader/EQ move.
 */
export type MixerChange =
  | ChannelId
  | 'crossfader'
  | 'crossfaderEnabled'
  | 'master'
  | 'cue'
  | 'routing';

/** What a deck needs from the audio layer: a live context and its channel input. */
export interface DeckAudioPort {
  ensureAudio(): { ctx: AudioContext; input: AudioNode };
}

export interface MasterRecordingTap {
  ctx: AudioContext;
  /** Pre-Master, post-recording-ceiling source. Connect the recorder here. */
  input: AudioNode;
  disconnect(): void;
}

/** One channel-meter sample: Mixxx-style mean absolute level plus a
 * separate clipping flag (its `vu_meter` / `peak_indicator` split). */
export interface ChannelLevelSample {
  meanAbsolute: number;
  clipped: boolean;
}

/** Master-bus spectrum snapshot (visualizer): per-bin magnitudes in dBFS
 * from the visualizer analyser, plus what's needed to map bins to Hz. */
export interface MasterSpectrum {
  /** Analyser frequency data, dB per bin (length = fftSize / 2). */
  magnitudesDb: Float32Array;
  sampleRate: number;
  fftSize: number;
}

/** Master-bus stereo time-domain snapshot (visualizer scope/goniometer). */
export interface MasterWaveform {
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
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

/**
 * The per-channel controls the automation overlay owns (ADR 0022): the
 * lane-driven params — fader, 3-band EQ, sweep filter, per channel, plus
 * OPTIONAL trim (sessions 15: session replay reproduces recorded trim
 * rides; a lane without trim leaves the live user's trim in charge —
 * Conductor set playback stays gain-staging-neutral). Master, cue
 * level/mix, and PFL are deliberately NOT here: they stay live user
 * controls during machine tenures.
 */
export interface AutomationChannelValues {
  fader: number;
  eq: Record<EqBand, number>;
  filter: number;
  /** Absent = the base (live user) trim applies. */
  trim?: number;
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

/** Explicit 0 dB Master position; the upper half reaches +6 dB. */
export const MASTER_LEVEL_DEFAULT = MASTER_UNITY_VALUE;

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

const LIVE_CEILING_CURVE = samplePeakCeilingCurve();

/** Transparent-below-threshold final sample ceiling (ADR 0034). The former
 * DynamicsCompressorNode added makeup gain, compressed ordinary mixes, and
 * still overshot above 0 dBFS. Neutral trim now provides summing headroom;
 * this node only bounds mistakes/transients at -2 dBFS. */
function makeSamplePeakCeiling(ctx: AudioContext): WaveShaperNode {
  const ceiling = ctx.createWaveShaper();
  ceiling.curve = LIVE_CEILING_CURVE;
  ceiling.oversample = 'none';
  return ceiling;
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
  /** Level-meter tap (four-deck-performance 36): reads the channel's own
   * signal post-EQ/filter, pre-fader — the same tap point as the PFL bus,
   * so a channel meters whether or not its fader is up (DJ-mixer behavior).
   * An AnalyserNode is a pure sink (no downstream), so it never alters the
   * audio. */
  readonly meterAnalyser: AnalyserNode;
  private readonly meterBuffer: Float32Array<ArrayBuffer>;

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

    this.meterAnalyser = ctx.createAnalyser();
    // Small window: the bridge samples at ~display rate and wants the recent
    // mean-absolute level used by Mixxx's EngineVuMeter, not sample peak.
    this.meterAnalyser.fftSize = 1024;
    this.meterBuffer = new Float32Array(new ArrayBuffer(this.meterAnalyser.fftSize * 4));

    sum.connect(this.sweep);
    this.sweep.connect(this.faderGain);
    this.sweep.connect(this.pflGain);
    this.sweep.connect(this.meterAnalyser);
    this.faderGain.connect(this.crossfadeGain);
  }

  /** Mean absolute sample over the analyser window. This matches Mixxx's
   * EngineVuMeter input statistic (`sumAbsPerChannel`) and avoids mastered
   * tracks sitting on red merely because their sample peaks approach 0 dBFS. */
  levelSample(): ChannelLevelSample {
    this.meterAnalyser.getFloatTimeDomainData(this.meterBuffer);
    let sum = 0;
    let clipped = false;
    for (let i = 0; i < this.meterBuffer.length; i++) {
      const magnitude = Math.abs(this.meterBuffer[i]);
      sum += magnitude;
      if (magnitude >= 1) clipped = true;
    }
    return { meanAbsolute: sum / this.meterBuffer.length, clipped };
  }
}

export class Mixer {
  private ctx: AudioContext | null = null;
  private strips: Record<ChannelId, ChannelStrip> | null = null;
  private masterGain: GainNode | null = null;
  /** Stable post-ceiling fan-out. Routing rewires this node. */
  private masterOutput: GainNode | null = null;
  /** Independent pre-Master recording guard: monitor volume/boost must not
   * alter the recorded Mix. Recorder taps hang here across route changes. */
  private recordingCeiling: WaveShaperNode | null = null;
  /** Master-bus spectrum tap for the visualizer (realtime-visualization 01):
   * hangs off recordingCeiling — route-independent and pre-Master, so the
   * visuals reflect program content, not monitor loudness. Pure sink. */
  private visualizerAnalyser: AnalyserNode | null = null;
  private visualizerBuffer: Float32Array<ArrayBuffer> | null = null;
  /** Stereo time-domain taps (visualizer scope/goniometer): a splitter off
   * recordingCeiling feeding one analyser per side. Pure sinks. */
  private visualizerWaveAnalysers: { left: AnalyserNode; right: AnalyserNode } | null = null;
  private visualizerWaveBuffers: {
    left: Float32Array<ArrayBuffer>;
    right: Float32Array<ArrayBuffer>;
  } | null = null;
  private cueGain: GainNode | null = null;
  private blendCueGain: GainNode | null = null;
  private blendMasterGain: GainNode | null = null;
  private cueCeiling: WaveShaperNode | null = null;
  private cueBridge: CueBridge | null = null;
  /** Live merger wiring on the main destination (explicit pairs). */
  private outputWiring: {
    merger: ChannelMergerNode;
    masterSplit: ChannelSplitterNode;
    cueSplit: ChannelSplitterNode | null;
  } | null = null;
  /** Serializes async routing applies — concurrent setSinkId/wiring
   * interleavings must not tear the output graph. */
  private routingChain: Promise<void> = Promise.resolve();
  private listeners = new Set<(changed?: MixerChange) => void>();

  // Control state survives graph rebuilds (StrictMode revival).
  private channels: Record<ChannelId, ChannelState> = {
    A: structuredClone(FLAT_CHANNEL),
    B: structuredClone(FLAT_CHANNEL),
    C: structuredClone(FLAT_CHANNEL),
    D: structuredClone(FLAT_CHANNEL),
  };
  private crossfader = loadCrossfaderPosition(); // -1 (left) .. 1 (right)
  private crossfaderAssignments: CrossfaderAssignments = loadCrossfaderAssignments();
  /** Crossfader bypass: while false the fader position is kept but both
   * channels run at unity (as if centered) — an accidental-kill guard. */
  private crossfaderEnabled = loadCrossfaderEnabled();
  /**
   * Automation overlay (ADR 0022): while non-null, drawn automation owns
   * the lane-driven node params (AutomationChannelValues) with REPLACEMENT
   * semantics, and the crossfader is pinned to neutral. Base state
   * (`channels`, `crossfader`) is never mutated by automation and never
   * applied to the owned nodes until disengage reapplies it — a user knob
   * move mid-audition updates base state and lands on release (DAW
   * automation-read behavior). Per-channel values stay null until the
   * first write (nothing plays before the conductor applies its lanes).
   */
  private automation: Record<ChannelId, AutomationChannelValues | null> | null = null;
  /** Overlay ownership (sets 25): the token the LAST engager holds. Only
   * the owner's disengage tears the overlay down — a prior session's
   * teardown must not yank the overlay from under the session that
   * engaged after it (the engage/disengage pairs of two surfaces can
   * interleave: editor audition ↔ set Conductor). */
  private automationOwner: symbol | null = null;
  private master = MASTER_LEVEL_DEFAULT; // control position 0..1
  /** Master bus output device (headphone-cue 01); null = system default. */
  private masterSinkId: string | null = null;
  /** Output pair on the master sink; null = device default. */
  private masterPair: OutputPair | null = null;
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
        C: new ChannelStrip(ctx, this.channels.C),
        D: new ChannelStrip(ctx, this.channels.D),
      };
      const masterGain = ctx.createGain();
      masterGain.gain.value = masterValueToGain(this.master);

      // Always-on live sample ceiling (ADR 0034).
      const masterCeiling = makeSamplePeakCeiling(ctx);
      const recordingCeiling = makeSamplePeakCeiling(ctx);
      const masterOutput = ctx.createGain();
      masterCeiling.connect(masterOutput);

      // "Program" = the summed post-crossfader signal, pre master volume —
      // what the room hears, before how loud the room hears it. The cue/mix
      // blend taps it here so the master fader never changes the headphones.
      const program = ctx.createGain();
      for (const channel of CHANNEL_IDS) strips[channel].crossfadeGain.connect(program);
      program.connect(recordingCeiling);
      program.connect(masterGain);
      masterGain.connect(masterCeiling);

      // Cue bus (headphone-cue 02/03, ADR 0017): PFL taps and the master
      // blend are mixed IN THE MAIN GRAPH and leave over the MediaStream
      // bridge. Its own sample ceiling guards summed PFL overloads.
      const cueSum = ctx.createGain();
      for (const channel of CHANNEL_IDS) strips[channel].pflGain.connect(cueSum);
      const { cue: cueSide, master: masterSide } = cueMixGains(this.cueMix);
      const blendCueGain = ctx.createGain();
      blendCueGain.gain.value = cueSide;
      const blendMasterGain = ctx.createGain();
      blendMasterGain.gain.value = masterSide;
      const cueGain = ctx.createGain();
      cueGain.gain.value = cueLevelToGain(this.cueLevel);
      const cueCeiling = makeSamplePeakCeiling(ctx);
      const cueBridge = new CueBridge(ctx);
      cueSum.connect(blendCueGain);
      program.connect(blendMasterGain);
      blendCueGain.connect(cueGain);
      blendMasterGain.connect(cueGain);
      cueGain.connect(cueCeiling);
      // cueCeiling's downstream (merger or bridge) is wired per route by
      // applyOutputRouting below.

      // The suspender guard (see cueBridge.ts): the main clock drives every
      // deck; it must never be handed to the fake timer sink.
      attachSinkKeepalive(ctx);

      // Visualizer spectrum tap (realtime-visualization 01). 2048 is the
      // punch/resolution balance from the prior-art survey
      // (docs/research/audio-visualizer-prior-art.md): the FFT window spans
      // fftSize/sampleRate seconds, so 4096 @ 48 kHz smeared kick attacks
      // across ~85 ms — 2048 halves that (~43 ms) while keeping ~23 Hz/bin
      // (~9 bins under the 250 Hz crossover). No analyser smoothing — the
      // browser EMA is FFT-block-rate-coupled; consumers own ballistics.
      const visualizerAnalyser = ctx.createAnalyser();
      visualizerAnalyser.fftSize = 2048;
      visualizerAnalyser.smoothingTimeConstant = 0;
      recordingCeiling.connect(visualizerAnalyser);

      // Stereo time-domain taps for the scope/goniometer presets
      // (realtime-visualization 02): the goniometer needs L and R
      // separately (an AnalyserNode alone downmixes its input to mono).
      const visualizerSplit = ctx.createChannelSplitter(2);
      const visualizerWaveLeft = ctx.createAnalyser();
      const visualizerWaveRight = ctx.createAnalyser();
      visualizerWaveLeft.fftSize = 2048;
      visualizerWaveRight.fftSize = 2048;
      recordingCeiling.connect(visualizerSplit);
      visualizerSplit.connect(visualizerWaveLeft, 0);
      visualizerSplit.connect(visualizerWaveRight, 1);

      this.ctx = ctx;
      this.strips = strips;
      this.masterGain = masterGain;
      this.masterOutput = masterOutput;
      this.recordingCeiling = recordingCeiling;
      this.visualizerAnalyser = visualizerAnalyser;
      this.visualizerBuffer = new Float32Array(
        new ArrayBuffer((visualizerAnalyser.fftSize / 2) * 4)
      );
      this.visualizerWaveAnalysers = { left: visualizerWaveLeft, right: visualizerWaveRight };
      this.visualizerWaveBuffers = {
        left: new Float32Array(new ArrayBuffer(visualizerWaveLeft.fftSize * 4)),
        right: new Float32Array(new ArrayBuffer(visualizerWaveRight.fftSize * 4)),
      };
      this.cueGain = cueGain;
      this.blendCueGain = blendCueGain;
      this.blendMasterGain = blendMasterGain;
      this.cueCeiling = cueCeiling;
      this.cueBridge = cueBridge;

      // Reapply position-dependent settings on the fresh graph. These are
      // automation-aware: a revival while the overlay is engaged restores
      // automation ownership (ADR 0022), not base state.
      this.applyCrossfader(false);
      for (const channel of CHANNEL_IDS) this.applyFilter(channel);
      if (this.automation) {
        for (const channel of CHANNEL_IDS) {
          const v = this.automation[channel];
          if (!v) continue;
          strips[channel].faderGain.gain.value = channelFaderToGain(v.fader);
          for (const band of ['low', 'mid', 'high'] as const) {
            strips[channel].bandGains[band].gain.value = eqValueToGain(v.eq[band]);
          }
        }
      }
      // Reapply the stored routing (cue failures are absorbed inside —
      // they disable the Cue bus without touching master).
      void this.applyOutputRouting().catch((err: unknown) => {
        // Saved device gone at revival: stay on the default — master
        // audio must never die over routing (headphone-cue PRD).
        console.warn('[Mixer] master sink reapply failed; using default', err);
        this.masterSinkId = null;
        this.masterPair = null;
        void this.applyOutputRouting();
      });
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

  // (Context suspend/resume left with ADR 0022: no surface ever suspends
  // the one shared clock — silence means "pause playback" only.)

  /** The live graph, or null. Policy paths (automation, engage/disengage)
   * use this instead of ensure(): they must never force-create a context
   * (headphone-cue 06 — side-effectful creation leaked zombie contexts). */
  private liveGraph(): { ctx: AudioContext; strips: Record<ChannelId, ChannelStrip> } | null {
    if (!this.ctx || !this.strips || this.ctx.state === 'closed') return null;
    return { ctx: this.ctx, strips: this.strips };
  }

  // ── Automation overlay (ADR 0022) ────────────────────────────────────

  /**
   * Engage the overlay: automation owns the lane-driven params from now
   * on, and the crossfader pins to neutral (the conductor mixes via fader
   * lanes; a stale crossfader would silence a deck). Applies to a live
   * graph only — never creates one; ensure() restores overlay ownership
   * on creation/revival.
   *
   * Returns the OWNER TOKEN (sets 25): the last engager owns the overlay
   * — mirroring the audible arbiter's last-claim-wins — even when the
   * overlay was already up (a session engaging over a prior session's
   * overlay adopts it; the prior owner's disengage becomes a no-op).
   * Pass the token to disengageAutomation.
   */
  engageAutomation(): symbol {
    const owner = Symbol('automation-owner');
    this.automationOwner = owner;
    if (!this.automation) {
      this.automation = { A: null, B: null, C: null, D: null };
      if (this.liveGraph()) this.applyCrossfader(true);
    }
    return owner;
  }

  /**
   * Disengage: reapply base state to every param the overlay owned (the
   * reapply lives HERE so no consumer can forget it) and unpin the
   * crossfader. OWNER-ONLY (sets 25): a non-owner's call is ignored — a
   * displaced session's teardown must not tear the overlay from under
   * the live one. Idempotent for the owner; safe with no live graph (the
   * next ensure() builds from base state anyway).
   */
  disengageAutomation(owner: symbol): void {
    if (!this.automation) return;
    if (owner !== this.automationOwner) {
      console.warn('[Mixer] disengageAutomation by non-owner ignored (sets 25)');
      return;
    }
    this.automationOwner = null;
    this.automation = null;
    const live = this.liveGraph();
    if (!live) return;
    const { ctx, strips } = live;
    for (const channel of CHANNEL_IDS) {
      const st = this.channels[channel];
      rampGain(ctx, strips[channel].faderGain.gain, channelFaderToGain(st.fader));
      for (const band of ['low', 'mid', 'high'] as const) {
        rampGain(ctx, strips[channel].bandGains[band].gain, eqValueToGain(st.eq[band]));
      }
      this.applyFilter(channel);
      // Trim may have been lane-driven (sessions 15) — land base back.
      rampGain(ctx, strips[channel].trimGain.gain, trimToGain(st.trim));
    }
    this.applyCrossfader(true);
  }

  isAutomationEngaged(): boolean {
    return this.automation !== null;
  }

  /**
   * Read-only view of the overlay's current values for a channel (sets 15
   * ghost indicators): null while disengaged, and per-channel null before
   * the first write. Polled per-frame by the view (rAF, like the waveform
   * playheads) — deliberately NOT part of subscribe()/notify(), which
   * carries base state only (ADR 0022).
   */
  getAutomation(channel: ChannelId): AutomationChannelValues | null {
    return this.automation?.[channel] ?? null;
  }

  /**
   * Automation write (the conductor's per-tick lane application). Stores
   * first, applies to a live graph only. Never touches base state, never
   * notifies subscribers — on-screen knobs and the capture recorder see
   * base state, not automation (ADR 0022).
   */
  setAutomation(channel: ChannelId, values: AutomationChannelValues): void {
    if (!this.automation) {
      console.warn('[Mixer] setAutomation while disengaged ignored (ADR 0022)');
      return;
    }
    const prevTrim = this.automation[channel]?.trim;
    this.automation[channel] = values;
    const live = this.liveGraph();
    if (!live) return;
    const { ctx, strips } = live;
    rampGain(ctx, strips[channel].faderGain.gain, channelFaderToGain(values.fader));
    for (const band of ['low', 'mid', 'high'] as const) {
      rampGain(ctx, strips[channel].bandGains[band].gain, eqValueToGain(values.eq[band]));
    }
    this.applyFilterPosition(channel, values.filter);
    // Trim rides the lane only when present (sessions 15). A lane that
    // DROPS its trim (had one, now absent) hands the node back to base.
    if (values.trim !== undefined) {
      rampGain(ctx, strips[channel].trimGain.gain, trimToGain(values.trim));
    } else if (prevTrim !== undefined) {
      rampGain(ctx, strips[channel].trimGain.gain, trimToGain(this.channels[channel].trim));
    }
  }

  /** The shared AudioContext (creating the graph if needed) — for
   * non-deck consumers like the Set prefetcher's decode (sets 14). */
  audioContext(): AudioContext {
    return this.ensure().ctx;
  }

  /** Route-independent pre-Master recording tap. Its own -2 dBFS ceiling
   * bounds the file without coupling it to monitor Master gain/boost. */
  createMasterRecordingTap(): MasterRecordingTap {
    const { ctx } = this.ensure();
    const ceiling = this.recordingCeiling!;
    const input = ctx.createGain();
    ceiling.connect(input);
    let connected = true;
    return {
      ctx,
      input,
      disconnect: () => {
        if (!connected) return;
        connected = false;
        ceiling.disconnect(input);
        input.disconnect();
      },
    };
  }

  /**
   * Recent mean-absolute level of a channel's signal, post-EQ/
   * filter and pre-fader (four-deck-performance 36) — the level-meter tap.
   * Reads the LIVE graph only (never force-creates a context: a background
   * meter sampler must not leak contexts the way headphone-cue 06 did);
   * returns 0 with no graph, which the meter shows as dark.
   */
  readChannelLevel(channel: ChannelId): ChannelLevelSample {
    const live = this.liveGraph();
    if (!live) return { meanAbsolute: 0, clipped: false };
    return live.strips[channel].levelSample();
  }

  /**
   * Master-bus spectrum snapshot (realtime-visualization 01), read off the
   * visualizer analyser (post-program, pre-Master — route-independent).
   * Reads the LIVE graph only (never force-creates a context, same rule as
   * readChannelLevel); null with no graph, which the visualizer renders as
   * silence. The returned buffer is reused across calls — consume it
   * synchronously.
   */
  readMasterSpectrum(): MasterSpectrum | null {
    const live = this.liveGraph();
    if (!live || !this.visualizerAnalyser || !this.visualizerBuffer) return null;
    this.visualizerAnalyser.getFloatFrequencyData(this.visualizerBuffer);
    return {
      magnitudesDb: this.visualizerBuffer,
      sampleRate: live.ctx.sampleRate,
      fftSize: this.visualizerAnalyser.fftSize,
    };
  }

  /**
   * Master-bus stereo time-domain snapshot (realtime-visualization 02) for
   * the scope/goniometer presets. Same live-graph-only and reused-buffer
   * contract as readMasterSpectrum.
   */
  readMasterWaveform(): MasterWaveform | null {
    const live = this.liveGraph();
    if (!live || !this.visualizerWaveAnalysers || !this.visualizerWaveBuffers) return null;
    this.visualizerWaveAnalysers.left.getFloatTimeDomainData(this.visualizerWaveBuffers.left);
    this.visualizerWaveAnalysers.right.getFloatTimeDomainData(this.visualizerWaveBuffers.right);
    return {
      left: this.visualizerWaveBuffers.left,
      right: this.visualizerWaveBuffers.right,
      sampleRate: live.ctx.sampleRate,
    };
  }

  /** The audio access a deck is constructed against. */
  portFor(channel: ChannelId): DeckAudioPort {
    return {
      ensureAudio: () => {
        const { ctx, strips } = this.ensure();
        return { ctx, input: strips[channel].input };
      },
    };
  }

  /**
   * Control-state change subscription (midi-controller 09). Mixer state is
   * still module state, not React state (ADR 0009) — but on-screen controls
   * subscribe so hardware moves repaint them. Fires after every setter;
   * channel states are replaced immutably, so snapshot selectors can rely
   * on reference/primitive equality.
   *
   * Listeners get the changed-control hint (capture spine 02): the touched
   * channel or global tag, `undefined` = diff everything. Hint-blind
   * subscribers (useSyncExternalStore repaints) just ignore the argument.
   */
  subscribe(listener: (changed?: MixerChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(changed?: MixerChange): void {
    for (const listener of this.listeners) listener(changed);
  }

  getChannelState(channel: ChannelId): ChannelState {
    return this.channels[channel];
  }

  getCrossfader(): number {
    return this.crossfader;
  }

  getCrossfaderAssignment(channel: ChannelId): CrossfaderAssignment {
    return this.crossfaderAssignments[channel];
  }

  getMaster(): number {
    return this.master;
  }

  setTrim(channel: ChannelId, value: number): void {
    this.channels[channel] = { ...this.channels[channel], trim: value };
    this.notify(channel);
    // Per-CHANNEL-LANE guard, not the overlay-wide one (sessions 15): a
    // Conductor overlay carries no trim, and the live trim knob must keep
    // working through a set. Only a lane that actually holds trim owns the
    // node; base lands on disengage.
    if (this.automation?.[channel]?.trim !== undefined) return;
    const { ctx, strips } = this.ensure();
    rampGain(ctx, strips[channel].trimGain.gain, trimToGain(value));
  }

  /** value in [0, 1]: 0 = kill, 0.5 = flat, 1 = +6 dB. */
  setEq(channel: ChannelId, band: EqBand, value: number): void {
    const ch = this.channels[channel];
    this.channels[channel] = { ...ch, eq: { ...ch.eq, [band]: value } };
    this.notify(channel);
    if (this.automation) return; // overlay owns the node; lands on disengage
    const { ctx, strips } = this.ensure();
    rampGain(ctx, strips[channel].bandGains[band].gain, eqValueToGain(value));
  }

  /** position in [-1, 1]: negative = LPF, positive = HPF, center = bypass. */
  setFilter(channel: ChannelId, position: number): void {
    this.channels[channel] = { ...this.channels[channel], filter: position };
    this.notify(channel);
    if (this.automation) return; // overlay owns the node; lands on disengage
    this.ensure();
    this.applyFilter(channel);
  }

  setFader(channel: ChannelId, value: number): void {
    this.channels[channel] = { ...this.channels[channel], fader: value };
    this.notify(channel);
    if (this.automation) return; // overlay owns the node; lands on disengage
    const { ctx, strips } = this.ensure();
    rampGain(ctx, strips[channel].faderGain.gain, channelFaderToGain(value));
  }

  /** position in [-1 (full left), 1 (full right)]. */
  setCrossfader(position: number): void {
    this.crossfader = position;
    saveCrossfaderPosition(position);
    this.notify('crossfader');
    if (this.automation) return; // pinned to neutral; lands on disengage
    this.ensure();
    this.applyCrossfader(true);
  }

  setCrossfaderAssignment(channel: ChannelId, assignment: CrossfaderAssignment): void {
    if (this.crossfaderAssignments[channel] === assignment) return;
    this.crossfaderAssignments = { ...this.crossfaderAssignments, [channel]: assignment };
    saveCrossfaderAssignments(this.crossfaderAssignments);
    this.notify(channel);
    if (this.automation) return; // pinned neutral; assignment lands on disengage
    this.ensure();
    this.applyCrossfader(true);
  }

  getCrossfaderEnabled(): boolean {
    return this.crossfaderEnabled;
  }

  setCrossfaderEnabled(enabled: boolean): void {
    this.crossfaderEnabled = enabled;
    saveCrossfaderEnabled(enabled);
    this.notify('crossfaderEnabled');
    if (this.automation) return; // pinned to neutral; lands on disengage
    this.ensure();
    this.applyCrossfader(true);
  }

  setMaster(value: number): void {
    this.master = value;
    this.notify('master');
    const { ctx } = this.ensure();
    if (this.masterGain) rampGain(ctx, this.masterGain.gain, masterValueToGain(value));
  }

  /**
   * Route the Master bus to an output device (headphone-cue 01/07,
   * four-deck 32). null sink = system default; null pair = device
   * default. The main context's sink follows this device; explicit pairs
   * open a wider discrete destination + merger. Remembered across graph
   * revivals; rejects if the device is gone (callers fall back per
   * routing.ts).
   */
  async setMasterSinkId(sinkId: string | null, pair: OutputPair | null = null): Promise<void> {
    // Store first, apply only to a LIVE context (headphone-cue 06
    // follow-up): routing a context-less mixer must not force-create an
    // AudioContext (registration would leak contexts and race dispose —
    // "AudioContext is going away"); ensure() reapplies the stored sink
    // on creation/revival, so a disposed-then-revived mixer keeps its
    // routing (the Mixer's "safe to keep using after dispose" contract).
    this.masterSinkId = sinkId;
    this.masterPair = sinkId === null ? null : pair;
    const ctx = this.ctx;
    if (!ctx || ctx.state === 'closed') return;
    await this.applyOutputRouting();
  }

  /** Serialized entry point — see routingChain. */
  private applyOutputRouting(): Promise<void> {
    const run = this.routingChain.then(() => this.doApplyOutputRouting());
    this.routingChain = run.catch(() => undefined);
    return run;
  }

  /**
   * Wire both buses to the plan (planOutput): main context sink = master
   * device; explicit pairs go through a discrete merger on the main
   * destination; cross-device cue over the bridge. Master failures throw
   * (callers fall back per routing.ts); cue failures disable the Cue bus
   * and never affect master.
   */
  private async doApplyOutputRouting(): Promise<void> {
    const ctx = this.ctx;
    const masterOutput = this.masterOutput;
    const cueCeiling = this.cueCeiling;
    if (!ctx || ctx.state === 'closed' || !masterOutput || !cueCeiling) return;

    const plan = planOutput({
      masterSinkId: this.masterSinkId,
      masterPair: this.masterPair,
      cueSinkId: this.cueSinkId,
      cuePair: this.cuePair,
    });

    await ctx.setSinkId(plan.mainSinkId);

    masterOutput.disconnect();
    cueCeiling.disconnect();
    if (this.outputWiring) {
      this.outputWiring.merger.disconnect();
      this.outputWiring.masterSplit.disconnect();
      this.outputWiring.cueSplit?.disconnect();
      this.outputWiring = null;
    }
    // Sane baseline while (re)wiring; the merger branch widens it again.
    ctx.destination.channelCount = 2;
    ctx.destination.channelInterpretation = 'speakers';

    const max = ctx.destination.maxChannelCount;
    const needed = (pair: OutputPair) => pair.right + 1;
    if (plan.masterPairInMain && needed(plan.masterPairInMain) > max) {
      // An explicit pair is user/hardware knowledge: fail master routing
      // (caller falls back) rather than silently playing from another jack.
      masterOutput.connect(ctx.destination);
      throw new RangeError(
        `master output pair ${plan.masterPairInMain.left + 1}/${plan.masterPairInMain.right + 1} ` +
          `is unavailable on ${max}-channel sink`
      );
    }
    let cuePairInMain = plan.cuePairInMain;
    if (cuePairInMain && needed(cuePairInMain) > max) {
      console.warn(
        `[Mixer] cue pair ${cuePairInMain.left + 1}/${cuePairInMain.right + 1} unavailable ` +
          `on ${max}-channel master sink; cue disabled`
      );
      cuePairInMain = null;
      this.cueSinkId = null;
      this.cuePair = null;
      this.notify('routing');
    }

    if (plan.masterPairInMain || cuePairInMain) {
      const channels = Math.max(
        2,
        plan.masterPairInMain ? needed(plan.masterPairInMain) : 2,
        cuePairInMain ? needed(cuePairInMain) : 2
      );
      // 'discrete' = no speaker-layout up/down-mixing between the merger
      // and the hardware (same contract as the bridge path).
      ctx.destination.channelCount = channels;
      ctx.destination.channelInterpretation = 'discrete';
      const merger = ctx.createChannelMerger(channels);
      const masterPair = plan.masterPairInMain ?? { left: 0, right: 1 };
      const masterSplit = ctx.createChannelSplitter(2);
      masterOutput.connect(masterSplit);
      masterSplit.connect(merger, 0, masterPair.left);
      masterSplit.connect(merger, 1, masterPair.right);
      let cueSplit: ChannelSplitterNode | null = null;
      if (cuePairInMain) {
        cueSplit = ctx.createChannelSplitter(2);
        cueCeiling.connect(cueSplit);
        cueSplit.connect(merger, 0, cuePairInMain.left);
        cueSplit.connect(merger, 1, cuePairInMain.right);
      }
      merger.connect(ctx.destination);
      this.outputWiring = { merger, masterSplit, cueSplit };
      console.debug(
        `[Mixer] ${max}-out sink: master on outputs ${masterPair.left + 1}/${masterPair.right + 1}` +
          (cuePairInMain ? `, cue on outputs ${cuePairInMain.left + 1}/${cuePairInMain.right + 1}` : '')
      );
    } else {
      masterOutput.connect(ctx.destination);
    }

    if (plan.cueBridge) {
      try {
        await this.cueBridge!.setSink(plan.cueBridge.sinkId, plan.cueBridge.pair);
        cueCeiling.connect(this.cueBridge!.input);
      } catch (err) {
        // Cue device gone / pair unreachable: Cue bus disabled, master
        // unaffected (headphone-cue PRD).
        console.warn('[Mixer] cue sink apply failed; cue disabled', err);
        this.cueBridge?.stop();
        this.cueSinkId = null;
        this.cuePair = null;
        this.notify('routing');
      }
    } else {
      this.cueBridge?.stop();
    }
  }

  // ── Cue bus (headphone-cue 02, ADR 0017) ─────────────────────────────

  /** PFL this channel into the headphones — post-EQ/filter, pre-fader.
   * Any channels may be cued together (they sum). */
  setPfl(channel: ChannelId, on: boolean): void {
    this.channels[channel] = { ...this.channels[channel], pfl: on };
    this.notify(channel);
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
    this.notify('cue');
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
    this.notify('cue');
    const { ctx } = this.ensure();
    const { cue, master } = cueMixGains(value);
    if (this.blendCueGain) rampGain(ctx, this.blendCueGain.gain, cue);
    if (this.blendMasterGain) rampGain(ctx, this.blendMasterGain.gain, master);
  }

  getCueSinkId(): string | null {
    return this.cueSinkId;
  }

  /**
   * Route the Cue bus to an output device, optionally on an explicit
   * output pair (picker "(outs 3/4)" entries; null = device default /
   * auto). Same device as master → main-destination merger; otherwise the
   * bridge (planOutput). null sink tears the delivery down (Cue bus
   * disabled — PFL state keeps toggling, silently). Rejects (and stays
   * disabled) if the device is gone; master is never affected by cue
   * routing.
   */
  async setCueSinkId(sinkId: string | null, pair: OutputPair | null = null): Promise<void> {
    const ctx = this.ctx;
    if (sinkId === null) {
      this.cueSinkId = null;
      this.cuePair = null;
      if (ctx && ctx.state !== 'closed') await this.applyOutputRouting();
      this.notify('routing');
      return;
    }
    this.ensure();
    this.cueSinkId = sinkId;
    this.cuePair = pair;
    try {
      await this.applyOutputRouting();
      // Cue failures are absorbed by the apply (master must survive);
      // resurface them here for the picker's error path.
      if (this.cueSinkId !== sinkId) {
        throw new Error(`cue route to ${sinkId} failed`);
      }
    } catch (err) {
      this.cueSinkId = null;
      this.cuePair = null;
      throw err;
    } finally {
      this.notify('routing');
    }
  }

  /** Tear down. Safe to keep using — the graph revives on demand. */
  dispose(): void {
    this.cueBridge?.stop();
    if (this.ctx && this.ctx.state !== 'closed') void this.ctx.close();
    this.ctx = null;
    this.strips = null;
    this.masterGain = null;
    this.masterOutput = null;
    this.recordingCeiling = null;
    this.cueGain = null;
    this.blendCueGain = null;
    this.blendMasterGain = null;
    this.cueCeiling = null;
    this.cueBridge = null;
    this.outputWiring = null;
  }

  private applyCrossfader(ramp: boolean): void {
    if (!this.ctx || !this.strips) return;
    // Overlay engaged → pinned neutral (ADR 0022); bypass guard → neutral.
    const position = this.automation ? 0 : this.crossfaderEnabled ? this.crossfader : 0;
    const targets = Object.fromEntries(
      CHANNEL_IDS.map((channel) => [
        channel,
        channelCrossfaderGain(this.crossfaderAssignments[channel], position),
      ])
    ) as Record<ChannelId, number>;
    if (ramp) {
      for (const channel of CHANNEL_IDS) {
        rampGain(this.ctx, this.strips[channel].crossfadeGain.gain, targets[channel]);
      }
    } else {
      for (const channel of CHANNEL_IDS) {
        this.strips[channel].crossfadeGain.gain.value = targets[channel];
      }
    }
  }

  /** Apply the EFFECTIVE filter position: a written automation value while
   * the overlay is engaged, base state otherwise. */
  private applyFilter(channel: ChannelId): void {
    const auto = this.automation?.[channel];
    this.applyFilterPosition(channel, auto ? auto.filter : this.channels[channel].filter);
  }

  private applyFilterPosition(channel: ChannelId, position: number): void {
    if (!this.ctx || !this.strips) return;
    const sweep = this.strips[channel].sweep;
    const { type, frequency, qDb } = sweepPositionToFilter(position);
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
