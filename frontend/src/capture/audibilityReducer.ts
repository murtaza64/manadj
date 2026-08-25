/**
 * The audibility reducer (architecture-deepening 01) — THE one event
 * reducer over deck/mixer/tenure state, from which both the live Handover
 * detector (capture/detector.ts) and the Session timeline
 * (sessions/timelineModel.ts) derive. "What was audible" has exactly one
 * implementation: the detector layers verdict machinery (pair machines,
 * engagement/settlement) on top; the timeline layers band/marker
 * derivation on top. Params-parameterized — the same DetectorParams the
 * detector runs under drive the audibility thresholds here, so bands and
 * verdicts agree by construction (the modules' stated invariant;
 * capture/audibility.ts holds the pure per-deck predicate).
 *
 * Semantics notes (the union of the two former copies):
 * - `playing` is transport-owned: a `load` never flips it (the recorder
 *   diffs the engine's own stop into an explicit pause event beside every
 *   real load, and the detector's re-seed replays load+play pairs whose
 *   order must not fabricate audibility edges). A load does clear
 *   `previewing` and zero the playhead — inert to audibility.
 * - `previewStart`/`previewEnd` (CUE stabs, ADR 0033) flip `previewing`
 *   only — never `playing`, so preview stays invisible to audibility
 *   (deliberate, detection v1).
 * - Transport events and ticks keep `playhead`/`playheadAt` current (the
 *   timeline's trace/extrapolation inputs; inert to detection).
 * - `tenure` markers track the holder: while a machine holds the shared
 *   surface, verdicts suspend, timeline audibility masks, and the recorder
 *   gates its feed — ONE rule, `surfaceDisplaced` (ADR 0022/0033).
 */
import type { CrossfaderAssignment } from '../playback/crossfaderAssignmentStore';
import { deckMasterGain, isDeckAudible } from './audibility';
import { DEFAULT_DETECTOR_PARAMS } from './events';
import type { CaptureDeck, CaptureEvent, DetectorParams } from './events';

export const ALL_DECKS: CaptureDeck[] = ['A', 'B', 'C', 'D'];

/** One deck's reduced mixer/transport state (audibility inputs plus the
 * playhead sample the timeline's traces ride). */
export interface ReducerDeckState {
  trackId: number | null;
  playing: boolean;
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
  /** Varispeed percent (bends excluded — momentary by definition). */
  pitch: number;
  /** Last known playhead (track seconds) and the capture time we knew it. */
  playhead: number;
  playheadAt: number;
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
}

export function freshDeck(assignment: CrossfaderAssignment): ReducerDeckState {
  // Mixer channel-strip defaults: fader up, trim/EQ centered, filter off.
  return {
    trackId: null,
    playing: false,
    previewing: false,
    fader: 1,
    trim: 0.5,
    eq: { low: 0.5, mid: 0.5, high: 0.5 },
    filter: 0,
    assignment,
    pitch: 0,
    playhead: 0,
    playheadAt: 0,
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
  };
}

export function cloneAudibilityState(s: AudibilityState): AudibilityState {
  return {
    ...s,
    decks: Object.fromEntries(
      ALL_DECKS.map((ch) => [ch, { ...s.decks[ch], eq: { ...s.decks[ch].eq } }])
    ) as Record<CaptureDeck, ReducerDeckState>,
  };
}

function assignmentFromValue(value: number): CrossfaderAssignment {
  return value < 0 ? 'left' : value > 0 ? 'right' : 'thru';
}

/** Apply one raw event to deck/mixer/tenure state (mutates `s`) —
 * everything else just rides the log as evidence. */
export function applyEvent(s: AudibilityState, e: CaptureEvent): void {
  switch (e.kind) {
    case 'control': {
      const d = e.channel ? s.decks[e.channel] : null;
      if (e.control === 'fader' && d) d.fader = e.value;
      else if (e.control === 'trim' && d) d.trim = e.value;
      // Mutate the eq band in place (capture spine 02): the reducer owns
      // `s`, and every retainer (checkpoints, timeline snapshots) already
      // deep-clones `eq`, so an in-place band write can't leak.
      else if (e.control === 'eqLow' && d) d.eq.low = e.value;
      else if (e.control === 'eqMid' && d) d.eq.mid = e.value;
      else if (e.control === 'eqHigh' && d) d.eq.high = e.value;
      else if (e.control === 'filter' && d) d.filter = e.value;
      else if (e.control === 'crossfaderAssignment' && d)
        d.assignment = assignmentFromValue(e.value);
      else if (e.control === 'crossfader') s.crossfader = e.value;
      else if (e.control === 'crossfaderEnabled') s.crossfaderEnabled = e.value !== 0;
      break;
    }
    case 'transport': {
      const d = s.decks[e.channel];
      if (e.action === 'play') d.playing = true;
      else if (e.action === 'pause' || e.action === 'cue') d.playing = false;
      // A stab (previewStart/previewEnd, ADR 0033) flips `previewing`, never
      // `playing` — Master-audible in reality, deliberately invisible to
      // audibility/detection v1 (revisiting that is a follow-up grill).
      // seek/jumpBeats/hotCue ride the log as evidence; only the playhead
      // sample below reaches the state.
      else if (e.action === 'previewStart') d.previewing = true;
      else if (e.action === 'previewEnd') d.previewing = false;
      d.playhead = e.playhead;
      d.playheadAt = e.t;
      break;
    }
    case 'pitch':
      s.decks[e.channel].pitch = e.value;
      break;
    case 'load': {
      const d = s.decks[e.channel];
      d.trackId = e.trackId;
      // NOT d.playing — transport-owned (see the header note).
      d.previewing = false;
      d.playhead = 0;
      d.playheadAt = e.t;
      break;
    }
    case 'tick':
      for (const ch of ALL_DECKS) {
        const p = e.playheads[ch];
        if (p !== undefined) {
          s.decks[ch].playhead = p;
          s.decks[ch].playheadAt = e.t;
        }
      }
      break;
    case 'tenure':
      s.tenureHolder = e.edge === 'start' ? e.holder : null;
      break;
    default:
      break;
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
  return isDeckAudible(s.decks[ch], mixerInputs(s), s.params);
}

/** Master-audible under the shared surface: a machine tenure displaces the
 * whole surface, so nothing is audible beneath it regardless of mixer math.
 * The timeline's bands (and the Session lifecycle) read this. */
export function maskedDeckAudible(s: AudibilityState, ch: CaptureDeck): boolean {
  return !tenureHeld(s) && deckAudible(s, ch);
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
  return !tenureHeld(s) && anyDeckAudible(s);
}
