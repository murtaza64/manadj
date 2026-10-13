/**
 * Beat FX tails (#355): how long an echo/reverb return keeps a deck
 * audible after its excitation stops. The insert is post-fader with an
 * independent return (playback/beatFx.ts), so closing the channel fader,
 * killing it, stopping the deck, or switching the FX off stops excitation
 * without silencing what is already ringing. An echo-out is audible until
 * the tail decays below `audibleGain`.
 *
 * KEPT IN LOCKSTEP with backend/session_audibility.py (_fx_tail_seconds).
 */
import { BEAT_SECONDS_DEFAULT, beatFxMixGains, echoDelaySeconds } from '../playback/beatFx';
import type { BeatFxEffectId } from '../playback/beatFx';
import type { BeatFxSettings } from '../playback/beatFxSettings';

/** Effects whose return outlives its input. Flanger regenerates over a
 * few milliseconds only: no tail worth modelling. */
export function fxHasTail(effect: BeatFxEffectId | null): effect is 'echo' | 'reverb' {
  return effect === 'echo' || effect === 'reverb';
}

/** Wall seconds per beat for a deck: the Track's BPM at its varispeed;
 * the mixer's 120 BPM stand-in when the BPM is unknown. */
export function deckBeatSeconds(bpm: number | null, pitchPercent: number): number {
  if (bpm === null || !Number.isFinite(bpm) || bpm <= 0) return BEAT_SECONDS_DEFAULT;
  const rate = 1 + pitchPercent / 100;
  return rate > 0 ? 60 / bpm / rate : BEAT_SECONDS_DEFAULT;
}

/**
 * Seconds from excitation end until the tail falls below `audibleGain`,
 * assuming the excitation was at unity (the wet return then starts at the
 * LEVEL/DEPTH wet gain).
 * - Echo: repeats every `beats` × beat length; repeat k sounds at
 *   wet × feedback^(k-1). The tail ends with the last audible repeat.
 * - Reverb: exponential IR reaching -60 dB at `reverbDecay`; the tail
 *   ends where wet × envelope crosses `audibleGain` (capped at the IR).
 */
export function fxTailSeconds(
  effect: 'echo' | 'reverb',
  beats: number,
  depth: number,
  settings: Readonly<Pick<BeatFxSettings, 'echoFeedback' | 'reverbDecay'>>,
  beatSeconds: number,
  audibleGain: number
): number {
  const { wet } = beatFxMixGains(depth);
  if (wet < audibleGain || wet <= 0) return 0;
  if (effect === 'echo') {
    const delay = echoDelaySeconds(beats, beatSeconds);
    const fb = settings.echoFeedback;
    const extra = fb > 0 && fb < 1 ? Math.floor(Math.log(audibleGain / wet) / Math.log(fb)) : 0;
    return (1 + Math.max(0, extra)) * delay;
  }
  const decay = settings.reverbDecay;
  const tau = decay / Math.log(1000);
  return Math.min(decay, tau * Math.log(wet / audibleGain));
}
