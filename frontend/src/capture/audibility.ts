/**
 * Deck audibility — THE one definition (glossary: Audibility), extracted
 * from the Handover detector (sessions 04) so the detector and the Session
 * timeline agree by construction: the bands the timeline draws are exactly
 * what the detector heard.
 *
 * Audibility = playing AND not EQ-full-killed AND not filter-killed AND
 * Master-bus gain (trim × channel fader × crossfader) ≥ `audibleGain`.
 * PFL/cue is invisible — Master only.
 */
import {
  channelCrossfaderGain,
  channelFaderToGain,
  trimToGain,
} from '../playback/mixerMath';
import type { CrossfaderAssignment } from '../playback/crossfaderAssignmentStore';
import type { DetectorParams } from './events';

/** The mixer inputs audibility reads — a structural subset of the
 * detector's DeckCapture and the timeline's deck state. */
export interface AudibleDeckInputs {
  playing: boolean;
  fader: number;
  trim: number;
  eq: { low: number; mid: number; high: number };
  filter: number;
  assignment: CrossfaderAssignment;
}

export interface AudibleMixerInputs {
  crossfader: number;
  crossfaderEnabled: boolean;
}

/** This deck's Master-bus gain right now (kills NOT applied — gain only). */
export function deckMasterGain(d: AudibleDeckInputs, mixer: AudibleMixerInputs): number {
  const xfGain = channelCrossfaderGain(
    d.assignment,
    mixer.crossfaderEnabled ? mixer.crossfader : 0
  );
  return trimToGain(d.trim) * channelFaderToGain(d.fader) * xfGain;
}

/** Is this deck Master-audible? The detector's own test, verbatim. */
export function isDeckAudible(
  d: AudibleDeckInputs,
  mixer: AudibleMixerInputs,
  params: Pick<DetectorParams, 'audibleGain' | 'eqKillBelow' | 'filterKillBeyond'>
): boolean {
  if (!d.playing) return false;
  // Kill-style mix-outs never touch the fader: an EQ full-kill or a sweep
  // filter ridden to an end silences the deck just as finally.
  const { eqKillBelow, filterKillBeyond } = params;
  if (d.eq.low <= eqKillBelow && d.eq.mid <= eqKillBelow && d.eq.high <= eqKillBelow) return false;
  if (Math.abs(d.filter) >= filterKillBeyond) return false;
  return deckMasterGain(d, mixer) >= params.audibleGain;
}

/** Is this deck emitting ANY Master-bus signal — audibility with a zero
 * gain threshold? The detector's entry-onset backdating clock (#178) keys
 * on this: a play-then-fader-slam entry's window must start where the
 * deck first SOUNDED, not where its rising gain happened to cross
 * `audibleGain` (mid-ramp, 1–2 beats late). Audible ⊆ sounding. */
export function isDeckSounding(
  d: AudibleDeckInputs,
  mixer: AudibleMixerInputs,
  params: Pick<DetectorParams, 'eqKillBelow' | 'filterKillBeyond'>
): boolean {
  if (!d.playing) return false;
  const { eqKillBelow, filterKillBeyond } = params;
  if (d.eq.low <= eqKillBelow && d.eq.mid <= eqKillBelow && d.eq.high <= eqKillBelow) return false;
  if (Math.abs(d.filter) >= filterKillBeyond) return false;
  return deckMasterGain(d, mixer) > 0;
}
