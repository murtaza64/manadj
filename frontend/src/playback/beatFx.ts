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
import { createBeatFxRepeatNode } from './worklet/beatFxRepeatNode';
import type { BeatFxRepeatCommand } from './worklet/beatFxRepeatProtocol';
import type { RepeatSettings, RepeatState } from './worklet/beatFxRepeatKernel';

export type BeatFxEffectId = 'echo' | 'lowCutEcho' | 'reverb' | 'flanger' | 'trans' | 'roll';
/** GRV6 SELECT panel order (MIDI list E1 detents 33, 34, 37, 38, 41, 43). */
export const BEAT_FX_EFFECTS: readonly BeatFxEffectId[] = [
  'echo', 'lowCutEcho', 'reverb', 'flanger', 'trans', 'roll',
];
/** Strip SELECT / compact labels. */
export const BEAT_FX_SHORT_LABELS: Readonly<Record<BeatFxEffectId, string>> = {
  echo: 'ECH', lowCutEcho: 'LCE', reverb: 'RVB', flanger: 'FLG', trans: 'TRS', roll: 'ROL',
};
/** Full Pioneer names. */
export const BEAT_FX_LABELS: Readonly<Record<BeatFxEffectId, string>> = {
  echo: 'ECHO', lowCutEcho: 'LOW CUT ECHO', reverb: 'REVERB', flanger: 'FLANGER', trans: 'TRANS', roll: 'ROLL',
};
/** TRANS/ROLL replace the dry signal (worklet kernel); the rest are
 * parallel returns over it. */
export function isReplacementEffect(effect: BeatFxEffectId | null): effect is 'trans' | 'roll' {
  return effect === 'trans' || effect === 'roll';
}
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
  /** Channels held on by a per-deck momentary (GRV6 DRUM RELEASE paddle,
   * #361): each runs the SELECTED effect at this depth regardless of ON
   * and CH SELECT. Absent = none (additive to the #351 snapshot shape). */
  held?: readonly BeatFxChannel[];
}

export type BeatFxChannel = 'A' | 'B' | 'C' | 'D';

/** A plain section snapshot (capture/replay): copies `held` only when
 * non-empty, so pre-#361 shapes stay byte-identical. */
export function beatFxSnapshot(section: Readonly<BeatFxSectionState>): BeatFxSectionState {
  const { selected, target, on, depth, beats, held } = section;
  return { selected, target, on, depth, beats, ...(held && held.length ? { held: [...held] } : {}) };
}

/** Value equality of two section snapshots, `held` included. */
export function sameBeatFxSection(a: Readonly<BeatFxSectionState>, b: Readonly<BeatFxSectionState>): boolean {
  return a.selected === b.selected && a.target === b.target && a.on === b.on
    && a.depth === b.depth && a.beats === b.beats
    && (a.held ?? []).join() === (b.held ?? []).join();
}

/** Is `channel` engaged: the section's ON + CH SELECT, or a held paddle. */
export function beatFxChannelEngaged(section: Readonly<BeatFxSectionState>, channel: BeatFxTarget): boolean {
  if (section.selected === null) return false;
  if (section.on && section.target === channel) return true;
  return channel !== 'master' && channel !== 'sampler' && (section.held?.includes(channel) ?? false);
}

/** The GRV6 BEAT ◄ ► ladder every effect's length quantizes to (#272;
 * 1/16 and 1/8 added for TRANS/ROLL, #360). */
export const ECHO_BEAT_LADDER: readonly number[] = [0.0625, 0.125, 0.25, 0.5, 0.75, 1, 2, 4, 8];

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

/** BEAT ◄ ► display: ladder fractions as n/d, else the number. */
export function formatBeatFxLength(beats: number): string {
  const frac: Record<number, string> = { 0.0625: '1/16', 0.125: '1/8', 0.25: '1/4', 0.5: '1/2', 0.75: '3/4' };
  return frac[beats] ?? String(beats);
}

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

/** LEVEL/DEPTH law for the replacement effects (TRANS, ROLL, #360): a
 * linear crossfade — -1 original only, 0 half/half (TRANS = half duck),
 * +1 effect only. The parallel law above would double the level of a
 * signal that is the dry itself. */
export function replacementMixGains(depth: number): { dry: number; wet: number } {
  const m = (Math.max(-1, Math.min(1, depth)) + 1) / 2;
  return { dry: 1 - m, wet: m };
}

/** Effective state for one channel after section ON + assignment + SELECT. */
export interface EffectiveBeatFxState {
  echo: boolean;
  lowCutEcho?: boolean;
  reverb: boolean;
  flanger: boolean;
  trans?: boolean;
  roll?: boolean;
  depth: number;
  /** Shared BEAT ◄ ► value (TRANS/ROLL cell length). */
  beats?: number;
}

/** Beat clock for TRANS/ROLL phase lock: the Deck's beat coordinate at
 * AudioContext time `time` (null = tempo only, no grid phase). */
export interface BeatFxClock {
  time: number;
  beat: number | null;
  beatSeconds: number;
}

/** Effect state from the section + one channel's engagement. */
export function effectiveBeatFxState(
  selected: BeatFxEffectId | null, engaged: boolean, depth: number, beats: number,
): EffectiveBeatFxState {
  const is = (effect: BeatFxEffectId) => engaged && selected === effect;
  return {
    echo: is('echo'), lowCutEcho: is('lowCutEcho'), reverb: is('reverb'), flanger: is('flanger'),
    trans: is('trans'), roll: is('roll'), depth, beats,
  };
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
export function createBeatFxInsert(
  ctx: BaseAudioContext,
  options: { repeatNode?: typeof createBeatFxRepeatNode } = {},
) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  // TRANS/ROLL (#360) sit in series ahead of everything else: the worklet
  // is spliced between `input` and `mid` once its module loads.
  const mid = ctx.createGain();
  input.connect(mid);
  mid.connect(dry).connect(output);

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
  mid.connect(echoSend).connect(delay).connect(clip);
  clip.connect(feedback).connect(delay);
  clip.connect(echoWet).connect(output);

  // LOW CUT ECHO (#360): the echo loop with a high-pass ahead of the delay
  // on both the send and the feedback, so repeat k has passed it k times —
  // the low end thins out repeat by repeat and the kick never piles up.
  // Feedback/saturation are Echo's.
  const lceSend = ctx.createGain();
  lceSend.gain.value = 0;
  const lceCut = ctx.createBiquadFilter();
  lceCut.type = 'highpass';
  lceCut.Q.value = Math.SQRT1_2;
  lceCut.frequency.value = DEFAULT_BEAT_FX_SETTINGS.lowCutEchoHz;
  const lceDelay = ctx.createDelay(MAX_ECHO_DELAY_S);
  lceDelay.delayTime.value = echoDelaySeconds(ECHO_BEATS_DEFAULT, BEAT_SECONDS_DEFAULT);
  const lceClip = ctx.createWaveShaper();
  lceClip.curve = echoClipCurve(DEFAULT_BEAT_FX_SETTINGS.echoSaturation);
  lceClip.oversample = '2x';
  const lceFeedback = ctx.createGain();
  lceFeedback.gain.value = ECHO_FEEDBACK;
  const lceWet = ctx.createGain();
  lceWet.gain.value = 0;
  mid.connect(lceSend).connect(lceCut).connect(lceDelay).connect(lceClip);
  lceClip.connect(lceFeedback).connect(lceCut);
  lceClip.connect(lceWet).connect(output);

  // Reverb: send -> convolver (shared synthesized stereo IR) -> wet.
  const reverbSend = ctx.createGain();
  reverbSend.gain.value = 0;
  const convolver = ctx.createConvolver();
  convolver.buffer = reverbImpulseBuffer(ctx, DEFAULT_BEAT_FX_SETTINGS);
  const reverbWet = ctx.createGain();
  reverbWet.gain.value = 0;
  mid.connect(reverbSend).connect(convolver).connect(reverbWet).connect(output);

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
  mid.connect(flangerSend).connect(flangerDelay);
  flangerDelay.connect(flangerFeedback).connect(flangerDelay);
  flangerDelay.connect(flangerWet).connect(output);
  flangerLfo.connect(flangerLfoDepth).connect(flangerDelay.delayTime);
  flangerLfo.start();

  const nodes: AudioNode[] = [
    input, output, dry, mid,
    echoSend, delay, clip, feedback, echoWet,
    lceSend, lceCut, lceDelay, lceClip, lceFeedback, lceWet,
    reverbSend, convolver, reverbWet,
    flangerSend, flangerDelay, flangerFeedback, flangerWet,
    flangerLfo, flangerLfoDepth,
  ];
  let disposed = false;

  // TRANS/ROLL worklet: the last state/clock/settings are replayed once it
  // loads (commands before that have nothing to drive).
  let repeat: { node: AudioNode; post: (command: BeatFxRepeatCommand) => void } | null = null;
  let repeatState: RepeatState = { mode: 'off', beats: ECHO_BEATS_DEFAULT, dry: 1, wet: 0 };
  let repeatClock: BeatFxClock | null = null;
  let repeatSettings: RepeatSettings = repeatSettingsOf(DEFAULT_BEAT_FX_SETTINGS);
  void (options.repeatNode ?? createBeatFxRepeatNode)(ctx).then((created) => {
    if (!created || disposed) return;
    repeat = created;
    input.disconnect(mid);
    input.connect(created.node).connect(mid);
    created.post({ type: 'settings', settings: repeatSettings });
    if (repeatClock) created.post({ type: 'clock', ...repeatClock });
    created.post({ type: 'state', state: repeatState, time: ctx.currentTime });
  }).catch(() => { /* stays pass-through */ });

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
    ramp(lceFeedback.gain, settings.echoFeedback, immediate, DECLICK_S);
    clip.curve = echoClipCurve(settings.echoSaturation);
    lceClip.curve = echoClipCurve(settings.echoSaturation);
    ramp(lceCut.frequency, settings.lowCutEchoHz, immediate, DECLICK_S);
    convolver.buffer = reverbImpulseBuffer(ctx, settings);
    const center = settings.flangerDelayMs / 1000;
    const amplitude = Math.min(settings.flangerWidthMs / 2000, Math.max(0, center - 0.0001));
    ramp(flangerDelay.delayTime, center, immediate, DECLICK_S);
    ramp(flangerLfoDepth.gain, amplitude, immediate, DECLICK_S);
    ramp(flangerFeedback.gain, settings.flangerFeedback, immediate, DECLICK_S);
    repeatSettings = repeatSettingsOf(settings);
    repeat?.post({ type: 'settings', settings: repeatSettings });
  }

  updateSettings(DEFAULT_BEAT_FX_SETTINGS, true);

  return {
    input,
    output,
    /** Apply the channel's effective section state. SEND gating preserves
     * existing tails: closing the channel fader or section/channel ON state
     * stops excitation without disconnecting the return. TRANS/ROLL have no
     * tail: their kernel ramps straight back to the live program. */
    update(state: EffectiveBeatFxState, immediate = false): void {
      if (disposed) return;
      const mix = beatFxMixGains(state.depth);
      const parallel = state.echo || state.lowCutEcho || state.reverb || state.flanger;
      ramp(echoSend.gain, state.echo ? 1 : 0, immediate, DECLICK_S);
      ramp(echoWet.gain, mix.wet, immediate, DECLICK_S);
      ramp(lceSend.gain, state.lowCutEcho ? 1 : 0, immediate, DECLICK_S);
      ramp(lceWet.gain, mix.wet, immediate, DECLICK_S);
      ramp(reverbSend.gain, state.reverb ? 1 : 0, immediate, DECLICK_S);
      ramp(reverbWet.gain, mix.wet, immediate, DECLICK_S);
      ramp(flangerSend.gain, state.flanger ? 1 : 0, immediate, DECLICK_S);
      ramp(flangerWet.gain, mix.wet, immediate, DECLICK_S);
      ramp(dry.gain, parallel ? mix.dry : 1, immediate, DECLICK_S);
      const replace = replacementMixGains(state.depth);
      const next: RepeatState = {
        mode: state.trans ? 'trans' : state.roll ? 'roll' : 'off',
        beats: state.beats ?? repeatState.beats,
        dry: replace.dry,
        wet: replace.wet,
      };
      if (next.mode === repeatState.mode && next.beats === repeatState.beats
        && next.dry === repeatState.dry && next.wet === repeatState.wet) return;
      repeatState = next;
      repeat?.post({ type: 'state', state: next, time: ctx.currentTime });
    },
    updateSettings,
    /** Retarget the echo's delay time (ramped — beat grid/BPM changes
     * glide instead of stepping). */
    setDelaySeconds(seconds: number, immediate = false): void {
      if (disposed) return;
      ramp(delay.delayTime, seconds, immediate, RETARGET_S);
      ramp(lceDelay.delayTime, seconds, immediate, RETARGET_S);
    },
    setFlangerPeriodSeconds(seconds: number, immediate = false): void {
      if (disposed) return;
      ramp(flangerLfo.frequency, 1 / Math.max(0.01, seconds), immediate, RETARGET_S);
    },
    /** TRANS/ROLL phase source (the tempo Deck's beat clock). */
    setClock(clock: BeatFxClock): void {
      if (disposed) return;
      repeatClock = clock;
      repeat?.post({ type: 'clock', ...clock });
    },
    /** Kernel-facing state, for tests and diagnostics. */
    getRepeatState(): Readonly<RepeatState> {
      return repeatState;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      flangerLfo.stop();
      for (const node of nodes) node.disconnect();
      repeat?.node.disconnect();
    },
  };
}

function repeatSettingsOf(settings: Readonly<BeatFxSettings>): RepeatSettings {
  return {
    transDuty: settings.transDuty,
    transSlopeMs: settings.transSlopeMs,
    rollFadeMs: settings.rollFadeMs,
  };
}
