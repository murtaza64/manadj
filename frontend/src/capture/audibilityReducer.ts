/**
 * The audibility reducer (architecture-deepening 01) — THE one event
 * reducer over deck/mixer/tenure state, from which both the live Handover
 * detector (capture/detector.ts) and the Session timeline
 * (sessions/timelineModel.ts) derive. Both use the same mixer thresholds;
 * Sessions additionally count audible previews, which remain excluded from
 * Take detection. capture/audibility.ts holds the pure per-deck predicate.
 *
 * Semantics notes (the union of the two former copies):
 * - `playing` is transport-owned: a `load` never flips it (the recorder
 *   diffs the engine's own stop into an explicit pause event beside every
 *   real load, and the detector's re-seed replays load+play pairs whose
 *   order must not fabricate audibility edges). A load does clear
 *   `previewing` and zero the playhead.
 * - `previewStart`/`previewEnd` (CUE stabs, ADR 0033) flip `previewing`
 *   only — never `playing`, so preview stays invisible to Take detection.
 * - Transport events and ticks keep `playhead`/`playheadAt` current (the
 *   timeline's trace/extrapolation inputs; inert to detection).
 * - `tenure` markers track the holder: while a machine holds the shared
 *   surface, verdicts suspend, timeline audibility masks, and the recorder
 *   gates its feed — ONE rule, `surfaceDisplaced` (ADR 0022/0033).
 */
import type { CrossfaderAssignment } from '../playback/crossfaderAssignmentStore';
import { scratchPosition, scratchFilterAt, scratchSoundedBetween, effectiveScratchLoop } from '../playback/worklet/scratchMotion';
import type { ScratchMotion, ScratchFilter } from '../playback/worklet/scratchMotion';
import { deckMasterGain, isDeckAudible, isDeckSounding } from './audibility';
import { channelCrossfaderGain } from '../playback/mixerMath';
import { beatFxMixGains } from '../playback/beatFx';
import { DEFAULT_BEAT_FX_SETTINGS } from '../playback/beatFxSettings';
import { deckBeatSeconds, fxHasTail, fxTailSeconds } from './fxTail';
import { DEFAULT_DETECTOR_PARAMS } from './events';
import type { CaptureDeck, CaptureEvent, DetectorParams } from './events';
import type { BeatFxSectionState } from '../playback/beatFx';
import type { BeatFxSettings } from '../playback/beatFxSettings';

export const ALL_DECKS: CaptureDeck[] = ['A', 'B', 'C', 'D'];

/** One deck's reduced mixer/transport state (audibility inputs plus the
 * playhead sample the timeline's traces ride). */
export interface ReducerDeckState {
  trackId: number | null;
  trackDuration: number;
  playing: boolean;
  slipMode: boolean;
  slipLoopActive: boolean;
  vinylMode: boolean;
  /** Filter state at playheadAt; null = not scratching, zero = hold. */
  scratch: ScratchFilter | null;
  loop: { start: number; end: number } | null;
  /** A CUE stab in progress (previewStart..previewEnd, sessions 10): audio
   * runs and its playhead rides the ticks, but `playing` never flips. */
  previewing: boolean;
  fader: number;
  trim: number;
  eq: { low: number; mid: number; high: number };
  filter: number;
  /** This deck's crossfader side (Sessions PRD, ADR 0033: tracked for all
   * four decks so the log alone reconstructs audibility). */
  assignment: CrossfaderAssignment;
  /** Per-stem enables (stems #212); all-on for stem-less tracks. */
  stems: { vocals: boolean; drums: boolean; bass: boolean; other: boolean };
  /** Varispeed percent (bends excluded — momentary by definition). */
  pitch: number;
  /** Last known playhead (track seconds) and the capture time we knew it. */
  playhead: number;
  playheadAt: number;
  /** Track BPM from the last Load (null = unknown) — the echo tail's beat. */
  bpm: number | null;
  /** The Beat FX voicing exciting this deck right now (#355), or null. */
  fxExcitedBy: FxExcitation | null;
  /** A ringing Beat FX tail (#355): audible until `until` (capture time),
   * crossfader-gated unless it rings on the Master insert. */
  fxTail: { start: number; until: number; master: boolean } | null;
}

/** What is feeding a deck's tail-producing Beat FX (#355). */
export interface FxExcitation {
  effect: 'echo' | 'reverb';
  beats: number;
  /** Master-insert FX (post-crossfader) rather than the channel insert. */
  master: boolean;
}

export interface AudibilityState {
  params: DetectorParams;
  /** All four decks (ADR 0033). */
  decks: Record<CaptureDeck, ReducerDeckState>;
  crossfader: number;
  crossfaderEnabled: boolean;
  /** The machine holding the shared surface (tenure marker, ADR 0033);
   * null while the shared surface itself is audible. */
  tenureHolder: string | null;
  /** Beat FX section (#351): the last logged snapshot, or null = never
   * logged (Sessions captured before #351 carry no FX evidence). Replaced,
   * never mutated — retainers may share it. */
  beatFx: BeatFxSectionState | null;
  /** Beat FX voicing preferences at this moment (#351); null = unlogged. */
  beatFxSettings: BeatFxSettings | null;
  /** Capture time of the last applied event / clock advance — the instant
   * the audibility reads answer for (Beat FX tails are time-bounded). */
  now: number;
}

export function freshDeck(assignment: CrossfaderAssignment): ReducerDeckState {
  // Mixer channel-strip defaults: fader up, trim/EQ centered, filter off.
  return {
    trackId: null,
    trackDuration: Infinity,
    playing: false,
    slipMode: false,
    slipLoopActive: false,
    vinylMode: true,
    scratch: null,
    loop: null,
    previewing: false,
    fader: 1,
    trim: 0.5,
    eq: { low: 0.5, mid: 0.5, high: 0.5 },
    filter: 0,
    assignment,
    stems: { vocals: true, drums: true, bass: true, other: true },
    pitch: 0,
    playhead: 0,
    playheadAt: 0,
    bpm: null,
    fxExcitedBy: null,
    fxTail: null,
  };
}

export function initialAudibilityState(
  params: DetectorParams = DEFAULT_DETECTOR_PARAMS
): AudibilityState {
  return {
    params,
    // Default crossfader sides mirror the mixer (A/C left, B/D right); the
    // recorder re-seeds the real assignments via crossfaderAssignment events.
    decks: {
      A: freshDeck('left'),
      B: freshDeck('right'),
      C: freshDeck('left'),
      D: freshDeck('right'),
    },
    crossfader: 0,
    crossfaderEnabled: true,
    tenureHolder: null,
    beatFx: null,
    beatFxSettings: null,
    now: -Infinity,
  };
}

export function cloneAudibilityState(s: AudibilityState): AudibilityState {
  return {
    ...s,
    decks: Object.fromEntries(
      ALL_DECKS.map((ch) => [ch, {
        ...s.decks[ch], eq: { ...s.decks[ch].eq }, stems: { ...s.decks[ch].stems },
        scratch: s.decks[ch].scratch ? { ...s.decks[ch].scratch } : null,
        loop: s.decks[ch].loop ? { ...s.decks[ch].loop } : null,
      }])
    ) as Record<CaptureDeck, ReducerDeckState>,
  };
}

function assignmentFromValue(value: number): CrossfaderAssignment {
  return value < 0 ? 'left' : value > 0 ? 'right' : 'thru';
}

/** Apply one raw event to deck/mixer/tenure state (mutates `s`) —
 * everything else just rides the log as evidence. */
export function applyEvent(s: AudibilityState, e: CaptureEvent): void {
  advanceClock(s, e.t);
  switch (e.kind) {
    case 'control': {
      const d = e.channel ? s.decks[e.channel] : null;
      if (e.control === 'fader' && d) d.fader = e.value;
      else if (e.control === 'slipMode' && d) d.slipMode = e.value !== 0;
      else if (e.control === 'vinylMode' && d) d.vinylMode = e.value !== 0;
      else if (e.control === 'trim' && d) d.trim = e.value;
      // Mutate the eq band in place (capture spine 02): the reducer owns
      // `s`, and every retainer (checkpoints, timeline snapshots) already
      // deep-clones `eq`, so an in-place band write can't leak.
      else if (e.control === 'eqLow' && d) d.eq.low = e.value;
      else if (e.control === 'eqMid' && d) d.eq.mid = e.value;
      else if (e.control === 'eqHigh' && d) d.eq.high = e.value;
      else if (e.control === 'filter' && d) d.filter = e.value;
      // Stems mutate in place like eq: retainers deep-clone `stems` too.
      else if (e.control === 'stemVocals' && d) d.stems.vocals = e.value !== 0;
      else if (e.control === 'stemDrums' && d) d.stems.drums = e.value !== 0;
      else if (e.control === 'stemBass' && d) d.stems.bass = e.value !== 0;
      else if (e.control === 'stemOther' && d) d.stems.other = e.value !== 0;
      else if (e.control === 'crossfaderAssignment' && d)
        d.assignment = assignmentFromValue(e.value);
      else if (e.control === 'crossfader') s.crossfader = e.value;
      else if (e.control === 'crossfaderEnabled') s.crossfaderEnabled = e.value !== 0;
      break;
    }
    case 'transport': {
      const d = s.decks[e.channel];
      if (e.trackDuration !== undefined) d.trackDuration = e.trackDuration;
      if (e.action === 'play') d.playing = true;
      else if (e.action === 'pause' || e.action === 'cue') d.playing = false;
      // A stab (previewStart/previewEnd, ADR 0033) flips `previewing`, never
       // `playing` — counted by Sessions, not Take detection.
      // seek/jumpBeats/hotCue ride the log as evidence; only the playhead
      // sample below reaches the state.
      else if (e.action === 'previewStart') d.previewing = true;
      else if (e.action === 'previewEnd') d.previewing = false;
      else if (e.action === 'scratchBegin') d.scratch = { drive: 0, rate: 0 };
      else if (e.action === 'scratchMove') {
        if (e.filter && Number.isFinite(e.filter.drive) && Number.isFinite(e.filter.rate)) d.scratch = { ...e.filter };
      } else if (e.action === 'scratchEnd') d.scratch = null;
      d.playhead = e.playhead;
      d.playheadAt = e.t;
      break;
    }
    case 'pitch': {
      const d = s.decks[e.channel];
      d.playhead = deckPlayheadAt(d, e.t);
      d.playheadAt = e.t;
      d.pitch = e.value;
      break;
    }
    case 'load': {
      const d = s.decks[e.channel];
      d.trackId = e.trackId;
      d.bpm = e.bpm;
      d.trackDuration = Infinity;
      // A Load re-premises the deck: detection treats any ringing tail as
      // ended here (the detector settles the outgoing at this instant).
      d.fxTail = null;
      // NOT d.playing — transport-owned (see the header note).
      d.previewing = false;
      d.scratch = null;
      d.loop = null;
      d.slipLoopActive = false;
      d.playhead = 0;
      d.playheadAt = e.t;
      break;
    }
    case 'loop': {
      const d = s.decks[e.channel];
      d.loop = e.region ? { ...e.region } : null;
      d.slipLoopActive = Boolean(e.region && e.slip);
      d.playhead = e.playhead;
      d.playheadAt = e.t;
      break;
    }
    case 'tick':
      for (const ch of ALL_DECKS) {
        const p = e.playheads[ch];
        // Scratch was advanced analytically above; coarse telemetry may
        // have been sampled before the timestamp's audio quantum.
        if (p !== undefined && !s.decks[ch].scratch) {
          s.decks[ch].playhead = p;
          s.decks[ch].playheadAt = e.t;
        }
      }
      break;
    case 'tenure':
      s.tenureHolder = e.edge === 'start' ? e.holder : null;
      break;
    case 'beatFx': {
      const { selected, target, on, depth, beats } = e;
      s.beatFx = { selected, target, on, depth, beats };
      break;
    }
    case 'beatFxSettings':
      s.beatFxSettings = e.settings;
      break;
    default:
      break;
  }
  updateFxTails(s, e.t);
}

/** Beat FX excitation of one deck (#355): a tail-producing effect is ON,
 * routed to this deck's channel insert (pre-crossfader send) or the Master
 * insert, its return audible, and the deck feeding it at an audible level.
 * Excitation is transport-gated like Take detection (cue stabs excluded). */
function fxExcitation(s: AudibilityState, ch: CaptureDeck): FxExcitation | null {
  const fx = s.beatFx;
  if (!fx || !fx.on || !fxHasTail(fx.selected)) return null;
  const master = fx.target === 'master';
  if (!master && fx.target !== ch) return null;
  if (beatFxMixGains(fx.depth).wet < s.params.audibleGain) return null;
  const d = s.decks[ch];
  const feeding = master
    ? isDeckAudible(d, mixerInputs(s), s.params)
    : isDeckAudible({ ...d, assignment: 'thru' }, mixerInputs(s), s.params);
  return feeding ? { effect: fx.selected, beats: fx.beats, master } : null;
}

/** Excitation edges → tails (#355). Excitation ending starts a tail sized
 * by the voicing that was ringing and the LEVEL/DEPTH now; renewed
 * excitation supersedes it; LEVEL/DEPTH to full dry silences it. */
function updateFxTails(s: AudibilityState, t: number): void {
  const fxLive = s.beatFx !== null && s.beatFx.on;
  const wetDead = s.beatFx !== null && beatFxMixGains(s.beatFx.depth).wet < s.params.audibleGain;
  for (const ch of ALL_DECKS) {
    const d = s.decks[ch];
    if (!fxLive && d.fxExcitedBy === null && (d.fxTail === null || !wetDead)) continue;
    const excited = fxLive ? fxExcitation(s, ch) : null;
    if (excited) {
      d.fxTail = null;
    } else if (d.fxExcitedBy) {
      const ex = d.fxExcitedBy;
      const seconds = fxTailSeconds(
        ex.effect, ex.beats, s.beatFx?.depth ?? -1,
        s.beatFxSettings ?? DEFAULT_BEAT_FX_SETTINGS,
        deckBeatSeconds(d.bpm, d.pitch), s.params.audibleGain
      );
      d.fxTail = seconds > 0 ? { start: t, until: t + seconds, master: ex.master } : null;
    } else if (d.fxTail && wetDead) {
      d.fxTail = null;
    }
    d.fxExcitedBy = excited;
  }
}

/** Advance the reducer clock to `t` (scratch motion + the instant
 * time-bounded reads answer for). */
export function advanceClock(s: AudibilityState, t: number): void {
  advanceScratch(s, t);
  if (t > s.now) s.now = t;
}

/** Is this deck's Beat FX tail audible at the reducer clock (#355)? */
export function fxTailAudible(s: AudibilityState, ch: CaptureDeck): boolean {
  const d = s.decks[ch];
  const tail = d.fxTail;
  if (!tail || s.now >= tail.until) return false;
  if (tail.master) return true;
  const xf = channelCrossfaderGain(d.assignment, s.crossfaderEnabled ? s.crossfader : 0);
  return xf >= s.params.audibleGain;
}

/** The next instant a ringing tail falls silent after the reducer clock
 * (Infinity = none) — consumers evaluate audibility there so a tail's end
 * lands exactly, not at the next logged event. */
export function nextFxTailEnd(s: AudibilityState): number {
  let next = Infinity;
  for (const ch of ALL_DECKS) {
    const tail = s.decks[ch].fxTail;
    if (tail && tail.until > s.now && tail.until < next) next = tail.until;
  }
  return next;
}

export function deckPlayheadAt(d: ReducerDeckState, t: number): number {
  const dt = Math.max(0, t - d.playheadAt);
  const motion = d.scratch;
  if (motion) {
    return scratchPosition(deckScratchMotion(d), t);
  }
  const position = d.playhead + (d.playing || d.previewing ? dt * (1 + d.pitch / 100) : 0);
  if (d.loop && d.playhead >= d.loop.start && d.playhead < d.loop.end && position >= d.loop.end) {
    return d.loop.start + (position - d.loop.start) % (d.loop.end - d.loop.start);
  }
  return position;
}

export function deckScratchMotion(d: ReducerDeckState): ScratchMotion {
  return { position: d.playhead, time: d.playheadAt, trackDuration: d.trackDuration,
    drive: d.scratch?.drive ?? 0, rate: d.scratch?.rate ?? 0,
    loop: effectiveScratchLoop(d.loop, d.trackDuration) };
}

/** Replace, never mutate, retained motion objects (detector checkpoints). */
export function advanceScratch(s: AudibilityState, t: number): void {
  for (const ch of ALL_DECKS) {
    const d = s.decks[ch];
    const motion = d.scratch;
    if (!motion) continue;
    const remaining = scratchFilterAt(deckScratchMotion(d), t);
    d.playhead = deckPlayheadAt(d, t);
    d.playheadAt = t;
    d.scratch = remaining;
  }
}

export function mixerInputs(s: AudibilityState): { crossfader: number; crossfaderEnabled: boolean } {
  return { crossfader: s.crossfader, crossfaderEnabled: s.crossfaderEnabled };
}

// ── Suspension / tenure gating — defined ONCE ────────────────────────────

/** THE suspension rule (ADR 0022/0033): the shared surface is displaced
 * while any non-'shared' holder has it. Consumed three ways — the detector
 * suspends every pair machine's verdicts, the timeline masks audibility
 * beneath the hold, and the recorder gates its feed (surfaceGated). */
export function surfaceDisplaced(holder: string | null): boolean {
  return holder !== null && holder !== 'shared';
}

/** The log-state form of the gate: a tenure marker opened a hold. */
export function tenureHeld(s: AudibilityState): boolean {
  return surfaceDisplaced(s.tenureHolder);
}

// ── Audibility reads ─────────────────────────────────────────────────────

/** Raw mixer audibility of one deck (capture/audibility.ts, under this
 * state's params) — ignores tenure. The detector reads this: its machines
 * suspend as a whole under tenure, and the exit re-seed needs reality. */
export function deckAudible(s: AudibilityState, ch: CaptureDeck): boolean {
  return isDeckAudible(s.decks[ch], mixerInputs(s), s.params) || fxTailAudible(s, ch);
}

/** Raw mixer "sounding" of one deck — audibility with a zero gain
 * threshold (any Master-bus signal at all; audibility.ts). The detector's
 * entry-onset backdating clock (#178) reads this. */
export function deckSounding(s: AudibilityState, ch: CaptureDeck): boolean {
  return isDeckSounding(s.decks[ch], mixerInputs(s), s.params) || fxTailAudible(s, ch);
}

/** Master-audible under the shared surface: a machine tenure displaces the
 * whole surface, so nothing is audible beneath it regardless of mixer math.
 * Played-track accounting reads this; Take detection reads deckAudible. */
export function maskedDeckAudible(s: AudibilityState, ch: CaptureDeck): boolean {
  return !tenureHeld(s) && deckAudible(s, ch);
}

/** Session evidence includes Master-audible cue stabs, unlike Take detection
 * and Played-track accounting. Mixer kills and scratch holds still apply. */
export function sessionDeckAudible(s: AudibilityState, ch: CaptureDeck): boolean {
  if (tenureHeld(s)) return false;
  const d = s.decks[ch];
  return isDeckAudible(d.previewing ? { ...d, playing: true } : d, mixerInputs(s), s.params)
    || fxTailAudible(s, ch);
}

/** This deck's Master-bus gain right now (kills/tenure NOT applied). */
export function deckGain(s: AudibilityState, ch: CaptureDeck): number {
  return deckMasterGain(s.decks[ch], mixerInputs(s));
}

/** Is ANY deck mixer-audible right now? Recomputed live from the state's
 * audibility inputs. */
export function anyDeckAudible(s: AudibilityState): boolean {
  return ALL_DECKS.some((ch) => deckAudible(s, ch));
}

/** Is the Master bus audible — any deck audible AND the shared surface in
 * place? (A tenure is non-performance, silent by definition.) The recorder
 * drives the Session lifecycle (activation + the ten-minute split) off this. */
export function masterAudible(s: AudibilityState): boolean {
  return ALL_DECKS.some((ch) => sessionDeckAudible(s, ch));
}

export function scratchSoundedBefore(s: AudibilityState, t: number): boolean {
  return !tenureHeld(s) && ALL_DECKS.some(ch => {
    const d = s.decks[ch];
    return d.scratch && isDeckAudible({ ...d, playing: true, scratch: null }, mixerInputs(s), s.params)
      && scratchSoundedBetween(deckScratchMotion(d), t);
  });
}
