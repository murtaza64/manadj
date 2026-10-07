/**
 * Beat FX (gh#272): Echo (beat-synced, Pioneer-style) and Reverb (beatless
 * convolution) as a post-fader per-channel processor. One Beat FX section
 * selects the live effect, radio target, depth, and beat fraction. This
 * module owns the pure math (ladder, delay time, wet/dry
 * crossfade, impulse response) and the owned node processor
 * (createBeatFxInsert) the Mixer's ChannelStrip embeds — the sweepFilter
 * pattern.
 */

import {
  DEFAULT_BEAT_FX_SETTINGS,
  type BeatFxSettings,
  type FlangerLengthUnit,
} from './beatFxSettings';

export type BeatFxEffectId = 'echo' | 'reverb' | 'flanger';
export const BEAT_FX_EFFECTS: readonly BeatFxEffectId[] = ['echo', 'reverb', 'flanger'];
export type BeatFxTarget = 'A' | 'B' | 'C' | 'D' | 'sampler' | 'master';

/**
 * The Beat FX SECTION state (gh#272) — one hardware strip over the
 * per-channel inserts, mirrored by the on-screen FX row: the SELECT knob's
 * effect (swapped live on every assigned channel), the master ON/OFF gate,
 * the single LEVEL/DEPTH (wet), and the global BEAT ◄ ► fraction.
 * Per-channel state is just an assignment flag (ChannelState.beatFx).
 */
export interface BeatFxSectionState {
  selected: BeatFxEffectId | null;
  target: BeatFxTarget;
  on: boolean;
  depth: number;
  beats: number;
}

/** The GRV6 BEAT ◄ ► ladder the echo's delay quantizes to (issue #272). */
export const ECHO_BEAT_LADDER: readonly number[] = [0.25, 0.5, 0.75, 1, 2, 4, 8];

/** Classic Pioneer echo default: half-beat repeats. */
export const ECHO_BEATS_DEFAULT = 0.5;

/** Fixed feedback (hardware minimalism — the knob is wet/dry). Loop gain
 * stays < 1: the soft-clip curve is tanh (unity small-signal slope). */
export const ECHO_FEEDBACK = DEFAULT_BEAT_FX_SETTINGS.echoFeedback;

/** DelayNode ceiling: 8 beats at ~50 BPM effective. */
export const MAX_ECHO_DELAY_S = 10;
const MIN_ECHO_DELAY_S = 0.01;

/** Flanger length in bars (#331): no meter model yet — every bar is 4/4. */
export const BEATS_PER_BAR = 4;

/** Flanger LFO period in wall seconds. The shared BEAT ◄ ► value reads as
 * bars ('bars': 1 = BEATS_PER_BAR beats) or beats. No DelayNode ceiling
 * applies — the period only sets an oscillator rate. */
export function flangerPeriodSeconds(
  length: number,
  beatSeconds: number,
  unit: FlangerLengthUnit,
): number {
  const beat = Number.isFinite(beatSeconds) && beatSeconds > 0 ? beatSeconds : BEAT_SECONDS_DEFAULT;
  return Math.max(MIN_ECHO_DELAY_S, length * (unit === 'bars' ? BEATS_PER_BAR : 1) * beat);
}

/** Unit the BEAT ◄ ► value is shown in for the selected effect. */
export function beatFxLengthUnit(
  selected: BeatFxEffectId | null,
  flangerUnit: FlangerLengthUnit,
): FlangerLengthUnit {
  return selected === 'flanger' ? flangerUnit : 'beats';
}

/** 120 BPM stand-in until the channel's Deck reports a tempo. */
export const BEAT_SECONDS_DEFAULT = 0.5;

/** Enable/disable and LEVEL/DEPTH declick ramp. */
const DECLICK_S = 0.05;
/** Beat-grid/BPM retarget ramp — smooth, not stepped (issue #272). */
const RETARGET_S = 0.25;

export const REVERB_SECONDS = DEFAULT_BEAT_FX_SETTINGS.reverbDecay;

/** Walk the beat ladder one step (BEAT ◄ ► — 3/4 breaks pure doubling, so
 * the ladder is an ordered list, not arithmetic). Off-ladder inputs snap
 * to the nearest rung first. */
export function stepEchoBeats(beats: number, change: 'halve' | 'double'): number {
  let nearest = 0;
  for (let i = 1; i < ECHO_BEAT_LADDER.length; i++) {
    if (Math.abs(ECHO_BEAT_LADDER[i] - beats) < Math.abs(ECHO_BEAT_LADDER[nearest] - beats)) {
      nearest = i;
    }
  }
  const index = Math.max(
    0,
    Math.min(ECHO_BEAT_LADDER.length - 1, nearest + (change === 'double' ? 1 : -1))
  );
  return ECHO_BEAT_LADDER[index];
}

/** Echo delay in wall seconds: beats × seconds-per-beat, clamped to the
 * DelayNode's range. beatSeconds already composes grid and play rate. */
export function echoDelaySeconds(beats: number, beatSeconds: number): number {
  const raw = beats * (Number.isFinite(beatSeconds) && beatSeconds > 0 ? beatSeconds : BEAT_SECONDS_DEFAULT);
  return Math.max(MIN_ECHO_DELAY_S, Math.min(MAX_ECHO_DELAY_S, raw));
}

/**
 * Wet/dry balance for the bipolar UI/Mixer coordinate requested for manadj:
 * -1 = original only, 0 = balance midpoint, +1 = effect only. GRV6 MIDI is
 * unsigned; dispatch maps its full 0..1 throw to this -1..1 coordinate.
 * Pioneer documents LEVEL/DEPTH as original/effect balance but assigns no
 * negative-side semantics, so this is a coordinate around that midpoint,
 * not polarity reversal or a center bypass.
 *
 * The transition law keeps dry at unity through the negative half and wet
 * at unity through the positive half. This avoids a center dip and supports
 * the full-wet echo-out move at +1.
 */
export function beatFxMixGains(depth: number): { dry: number; wet: number } {
  const m = (Math.max(-1, Math.min(1, depth)) + 1) / 2;
  return {
    dry: Math.min(1, 2 * (1 - m)),
    wet: Math.min(1, 2 * m),
  };
}

/** Effective state for one channel after section ON + assignment + SELECT. */
export interface EffectiveBeatFxState {
  echo: boolean;
  reverb: boolean;
  flanger: boolean;
  depth: number;
}

/** Deterministic PRNG (mulberry32) — IR tests need reproducible noise. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Synthesized reverb impulse response (issue #272): exponential-decay
 * white noise, ~2.5 s, no pre-delay, stereo-decorrelated (independent
 * noise per side). Energy-normalized per channel (Σir² = 1) so full-wet
 * convolution lands near the dry loudness.
 */
export function reverbImpulseResponse(
  sampleRate: number,
  seconds: number = REVERB_SECONDS,
  dampingHz: number = DEFAULT_BEAT_FX_SETTINGS.reverbDampingHz,
  stereoWidth: number = DEFAULT_BEAT_FX_SETTINGS.reverbStereoWidth,
): { left: Float32Array; right: Float32Array } {
  const length = Math.max(1, Math.round(sampleRate * seconds));
  // -60 dB at the tail: amplitude e-folding time T/ln(1000).
  const tau = seconds / Math.log(1000);
  const independent = [mulberry32(0xbeef), mulberry32(0xcafe)];
  const width = Math.max(0, Math.min(1, stereoWidth));
  const smoothing = Math.exp(-2 * Math.PI * Math.min(dampingHz, sampleRate * 0.49) / sampleRate);
  const make = (channel: number): Float32Array => {
    const ir = new Float32Array(length);
    let energy = 0;
    let filtered = 0;
    // Shared noise is generated deterministically per sample for both sides.
    const sharedRandom = mulberry32(0xface);
    for (let i = 0; i < length; i++) {
      const mono = sharedRandom() * 2 - 1;
      const side = independent[channel]() * 2 - 1;
      const noise = mono * (1 - width) + side * width;
      filtered = (1 - smoothing) * noise + smoothing * filtered;
      const sample = filtered * Math.exp(-(i / sampleRate) / tau);
      ir[i] = sample;
      energy += sample * sample;
    }
    const norm = 1 / Math.sqrt(energy || 1);
    for (let i = 0; i < length; i++) ir[i] *= norm;
    return ir;
  };
  return { left: make(0), right: make(1) };
}

/** tanh soft-clip in the echo feedback path (matches the sweepFilter drive
 * branch's character). Unity small-signal slope keeps loop gain at
 * ECHO_FEEDBACK for ordinary levels; hot repeats saturate instead of
 * runaway. */
function echoClipCurve(amount: number): Float32Array<ArrayBuffer> {
  const drive = Math.max(0, amount);
  if (drive === 0) return Float32Array.from(
    { length: 4097 }, (_, i) => (2 * i) / 4096 - 1
  ) as Float32Array<ArrayBuffer>;
  const norm = Math.tanh(drive);
  return Float32Array.from({ length: 4097 }, (_, i) =>
    Math.tanh(drive * ((2 * i) / 4096 - 1)) / norm
  ) as Float32Array<ArrayBuffer>;
}

/** One shared IR AudioBuffer per context (4 strips, one buffer). */
const impulseBuffers = new WeakMap<BaseAudioContext, { key: string; buffer: AudioBuffer }>();

function reverbImpulseBuffer(ctx: BaseAudioContext, settings: Readonly<BeatFxSettings>): AudioBuffer {
  const key = `${settings.reverbDecay}:${settings.reverbDampingHz}:${settings.reverbStereoWidth}`;
  const cached = impulseBuffers.get(ctx);
  if (cached?.key === key) return cached.buffer;
  const { left, right } = reverbImpulseResponse(
    ctx.sampleRate,
    settings.reverbDecay,
    settings.reverbDampingHz,
    settings.reverbStereoWidth,
  );
  const buffer = ctx.createBuffer(2, left.length, ctx.sampleRate);
  buffer.copyToChannel(left as Float32Array<ArrayBuffer>, 0);
  buffer.copyToChannel(right as Float32Array<ArrayBuffer>, 1);
  impulseBuffers.set(ctx, { key, buffer });
  return buffer;
}

/**
 * Owned per-channel post-fader processor: parallel echo + reverb branches
 * over one dry path. Disabling an effect ramps its SEND to zero
 * and leaves the branch connected, so tails ring out naturally (no click);
 * all-off settles to dry at unity (bit-transparent but for the pass-through
 * gain nodes).
 */
export function createBeatFxInsert(ctx: BaseAudioContext) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  input.connect(dry).connect(output);

  // Echo: send -> delay -> safety soft clip -> (feedback -> delay,
  // wet -> output). Normal Pioneer ECHO stays full-band: LOW CUT ECHO is a
  // separate GRV6 selection, and official docs do not specify reverb or
  // damping inside ECHO (docs/research/pioneer-beat-fx-behavior.md).
  const echoSend = ctx.createGain();
  echoSend.gain.value = 0;
  const delay = ctx.createDelay(MAX_ECHO_DELAY_S);
  delay.delayTime.value = echoDelaySeconds(ECHO_BEATS_DEFAULT, BEAT_SECONDS_DEFAULT);
  const clip = ctx.createWaveShaper();
  clip.curve = echoClipCurve(DEFAULT_BEAT_FX_SETTINGS.echoSaturation);
  clip.oversample = '2x';
  const feedback = ctx.createGain();
  feedback.gain.value = ECHO_FEEDBACK;
  const echoWet = ctx.createGain();
  echoWet.gain.value = 0;
  input.connect(echoSend).connect(delay).connect(clip);
  clip.connect(feedback).connect(delay);
  clip.connect(echoWet).connect(output);

  // Reverb: send -> convolver (shared synthesized stereo IR) -> wet.
  const reverbSend = ctx.createGain();
  reverbSend.gain.value = 0;
  const convolver = ctx.createConvolver();
  convolver.buffer = reverbImpulseBuffer(ctx, DEFAULT_BEAT_FX_SETTINGS);
  const reverbWet = ctx.createGain();
  reverbWet.gain.value = 0;
  input.connect(reverbSend).connect(convolver).connect(reverbWet).connect(output);

  // Flanger: short delay swept by a beat-synchronized sine LFO, with
  // regeneration. Pioneer documents one LFO cycle per selected beat span;
  // delay/width/feedback are manadj tuning parameters.
  const flangerSend = ctx.createGain();
  flangerSend.gain.value = 0;
  const flangerDelay = ctx.createDelay(0.05);
  const flangerFeedback = ctx.createGain();
  const flangerWet = ctx.createGain();
  flangerWet.gain.value = 0;
  const flangerLfo = ctx.createOscillator();
  flangerLfo.type = 'sine';
  const flangerLfoDepth = ctx.createGain();
  input.connect(flangerSend).connect(flangerDelay);
  flangerDelay.connect(flangerFeedback).connect(flangerDelay);
  flangerDelay.connect(flangerWet).connect(output);
  flangerLfo.connect(flangerLfoDepth).connect(flangerDelay.delayTime);
  flangerLfo.start();

  const nodes: AudioNode[] = [
    input, output, dry,
    echoSend, delay, clip, feedback, echoWet,
    reverbSend, convolver, reverbWet,
    flangerSend, flangerDelay, flangerFeedback, flangerWet,
    flangerLfo, flangerLfoDepth,
  ];
  let disposed = false;

  function ramp(param: AudioParam, target: number, immediate: boolean, seconds: number): void {
    if (immediate) {
      param.cancelScheduledValues(ctx.currentTime);
      param.value = target;
      return;
    }
    // rampGain's cancel-after-read contract (mixer.ts).
    const current = param.value;
    const now = ctx.currentTime;
    param.cancelScheduledValues(now);
    param.setValueAtTime(current, now);
    param.linearRampToValueAtTime(target, now + seconds);
  }

  function updateSettings(settings: Readonly<BeatFxSettings>, immediate = false): void {
    ramp(feedback.gain, settings.echoFeedback, immediate, DECLICK_S);
    clip.curve = echoClipCurve(settings.echoSaturation);
    convolver.buffer = reverbImpulseBuffer(ctx, settings);
    const center = settings.flangerDelayMs / 1000;
    const amplitude = Math.min(settings.flangerWidthMs / 2000, Math.max(0, center - 0.0001));
    ramp(flangerDelay.delayTime, center, immediate, DECLICK_S);
    ramp(flangerLfoDepth.gain, amplitude, immediate, DECLICK_S);
    ramp(flangerFeedback.gain, settings.flangerFeedback, immediate, DECLICK_S);
  }

  updateSettings(DEFAULT_BEAT_FX_SETTINGS, true);

  return {
    input,
    output,
    /** Apply the channel's effective section state. SEND gating preserves
     * existing tails: closing the channel fader or section/channel ON state
     * stops excitation without disconnecting the return. */
    update(state: EffectiveBeatFxState, immediate = false): void {
      if (disposed) return;
      const mix = beatFxMixGains(state.depth);
      ramp(echoSend.gain, state.echo ? 1 : 0, immediate, DECLICK_S);
      ramp(echoWet.gain, mix.wet, immediate, DECLICK_S);
      ramp(reverbSend.gain, state.reverb ? 1 : 0, immediate, DECLICK_S);
      ramp(reverbWet.gain, mix.wet, immediate, DECLICK_S);
      ramp(flangerSend.gain, state.flanger ? 1 : 0, immediate, DECLICK_S);
      ramp(flangerWet.gain, mix.wet, immediate, DECLICK_S);
      ramp(dry.gain, state.echo || state.reverb || state.flanger ? mix.dry : 1, immediate, DECLICK_S);
    },
    updateSettings,
    /** Retarget the echo's delay time (ramped — beat grid/BPM changes
     * glide instead of stepping). */
    setDelaySeconds(seconds: number, immediate = false): void {
      if (disposed) return;
      ramp(delay.delayTime, seconds, immediate, RETARGET_S);
    },
    setFlangerPeriodSeconds(seconds: number, immediate = false): void {
      if (disposed) return;
      ramp(flangerLfo.frequency, 1 / Math.max(0.01, seconds), immediate, RETARGET_S);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      flangerLfo.stop();
      for (const node of nodes) node.disconnect();
    },
  };
}
