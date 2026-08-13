/**
 * Handover detector (transition-takes 02) — pure, under vitest.
 *
 * A reducer over CaptureEvents (transport.ts house style): feed it the
 * shared surface's event stream and it emits DetectedTakes when a
 * Handover settles. The glossary definition is the contract:
 *
 * - Audibility = playing AND (channel-fader gain × crossfader gain) ≥
 *   `audibleGain`, on the Master bus only — PFL/cue is invisible.
 * - An ENGAGEMENT opens when the incoming deck becomes audible while the
 *   incumbent is audible (overlap), or within `cutGapMaxS` of its
 *   cessation (hard cut).
 * - The Handover COMPLETES when the outgoing stays silent for
 *   `settleHorizonS`; returns within it fold (cross-cuts), and incoming
 *   silences shorter than the horizon fold too (tease continues).
 * - A tease where the incoming stays silent past the horizon while the
 *   outgoing plays on dissolves with no Take.
 *
 * Settlement is time-driven: the ~1 Hz tick events advance the clock, so
 * the reducer never needs a timer.
 */
import { channelCrossfaderGain, channelFaderToGain, trimToGain } from '../playback/mixerMath';
import type { CrossfaderAssignment } from '../playback/crossfaderAssignmentStore';
import {
  DEFAULT_DETECTOR_PARAMS,
  DETECTOR_VERSION,
} from './events';
import type {
  CaptureChannel,
  CaptureDeck,
  CaptureEvent,
  DetectorParams,
  DetectedTake,
} from './events';

interface DeckCapture {
  trackId: number | null;
  playing: boolean;
  fader: number;
  trim: number;
  eq: { low: number; mid: number; high: number };
  filter: number;
  /** This deck's crossfader side (Sessions PRD, ADR 0033: tracked for all
   * four decks so the >2-audible self-gate is computed from the log). */
  assignment: CrossfaderAssignment;
  /** Varispeed percent (bends excluded — momentary by definition). */
  pitch: number;
  audible: boolean;
  /** Time of the last audibility flip. */
  since: number;
}

export interface CaptureState {
  params: DetectorParams;
  /** Rolling event log (pruned; Take slices are cut from it). */
  log: CaptureEvent[];
  /** All four decks (ADR 0033): the pair machine trades on A/B, but C/D
   * audibility is tracked for the >2-audible self-gate. */
  decks: Record<CaptureDeck, DeckCapture>;
  crossfader: number;
  crossfaderEnabled: boolean;
  /** A machine holds the shared surface (tenure marker; ADR 0033) — the
   * old recorder surface gate, now log-driven. */
  tenureHeld: boolean;
  /** Verdicts suspended: tenure held OR more than two decks audible (ADR
   * 0033). While suspended the log still grows — only the pair machine
   * stands down; an in-flight engagement is discarded on entry and the
   * incumbent re-established on exit. Derived each event from tenureHeld +
   * the audible-deck count; stored to detect the entry/exit edges. */
  suspended: boolean;
  /** The audible-first deck — outgoing candidate. */
  incumbent: CaptureChannel | null;
  /** Engagement start (first trading instant), null = not engaged. */
  engagedSince: number | null;
  /** Track pair snapshotted when the engagement opened. */
  outgoingTrackId: number | null;
  incomingTrackId: number | null;
  /** Tease clock: incoming currently silent since (while engaged). */
  incomingSilentSince: number | null;
  /** Settle clock: outgoing (or lone incumbent) silent since. */
  outSilentSince: number | null;
  /** The incumbent's Track AT its cessation — the hard-cut engagement
   * snapshots this, so a Load onto the stopped deck within the cut gap
   * can't mis-attribute the outgoing Track. */
  outTrackAtCessation: number | null;
  /** Engagement-open snapshot, stamped into the Take slice as its `init`
   * event (vectorization starts from known state, not defaults). */
  openSnapshot: Extract<CaptureEvent, { kind: 'init' }> | null;
}

const OTHER: Record<CaptureChannel, CaptureChannel> = { A: 'B', B: 'A' };
const ALL_DECKS: CaptureDeck[] = ['A', 'B', 'C', 'D'];

function freshDeck(assignment: CrossfaderAssignment): DeckCapture {
  // Mixer channel-strip defaults: fader up, trim/EQ centered, filter off.
  return {
    trackId: null,
    playing: false,
    fader: 1,
    trim: 0.5,
    eq: { low: 0.5, mid: 0.5, high: 0.5 },
    filter: 0,
    assignment,
    pitch: 0,
    audible: false,
    since: 0,
  };
}

export function initialCaptureState(params: DetectorParams = DEFAULT_DETECTOR_PARAMS): CaptureState {
  return {
    params,
    log: [],
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
    tenureHeld: false,
    suspended: false,
    incumbent: null,
    engagedSince: null,
    outgoingTrackId: null,
    incomingTrackId: null,
    incomingSilentSince: null,
    outSilentSince: null,
    outTrackAtCessation: null,
    openSnapshot: null,
  };
}

function deckAudible(s: CaptureState, ch: CaptureDeck): boolean {
  const d = s.decks[ch];
  if (!d.playing) return false;
  // Kill-style mix-outs never touch the fader: an EQ full-kill or a sweep
  // filter ridden to an end silences the deck just as finally.
  const { eqKillBelow, filterKillBeyond } = s.params;
  if (d.eq.low <= eqKillBelow && d.eq.mid <= eqKillBelow && d.eq.high <= eqKillBelow) return false;
  if (Math.abs(d.filter) >= filterKillBeyond) return false;
  const xfGain = channelCrossfaderGain(d.assignment, s.crossfaderEnabled ? s.crossfader : 0);
  const gain = trimToGain(d.trim) * channelFaderToGain(d.fader) * xfGain;
  return gain >= s.params.audibleGain;
}

/** How many decks are Master-audible right now (all four; ADR 0033). */
function audibleDeckCount(s: CaptureState): number {
  return ALL_DECKS.filter((ch) => deckAudible(s, ch)).length;
}

/** Apply the raw event to deck/mixer state (audibility inputs only —
 * everything else just rides the log as evidence). */
function assignmentFromValue(value: number): CrossfaderAssignment {
  return value < 0 ? 'left' : value > 0 ? 'right' : 'thru';
}

function applyEvent(s: CaptureState, e: CaptureEvent): void {
  switch (e.kind) {
    case 'control': {
      const d = e.channel ? s.decks[e.channel] : null;
      if (e.control === 'fader' && d) d.fader = e.value;
      else if (e.control === 'trim' && d) d.trim = e.value;
      else if (e.control === 'eqLow' && d) d.eq = { ...d.eq, low: e.value };
      else if (e.control === 'eqMid' && d) d.eq = { ...d.eq, mid: e.value };
      else if (e.control === 'eqHigh' && d) d.eq = { ...d.eq, high: e.value };
      else if (e.control === 'filter' && d) d.filter = e.value;
      else if (e.control === 'crossfaderAssignment' && d) d.assignment = assignmentFromValue(e.value);
      else if (e.control === 'crossfader') s.crossfader = e.value;
      else if (e.control === 'crossfaderEnabled') s.crossfaderEnabled = e.value !== 0;
      break;
    }
    case 'transport':
      if (e.action === 'play') s.decks[e.channel].playing = true;
      else if (e.action === 'pause' || e.action === 'cue') s.decks[e.channel].playing = false;
      // PHASE-1 PREVIEW BOUNDARY (ADR 0033 cue-stab capture): previewStart/
      // previewEnd bracket a Master-audible CUE stab in the log, but the
      // phase-1 pair detector deliberately ignores them — a stab does NOT
      // flip `playing`, count toward audibility/engagements, or trip the
      // >2-audible self-gate. This keeps detection byte-identical to before
      // preview evidence existed. Revisiting preview audibility semantics is
      // a follow-up grill, not this issue. (seek/jumpBeats/hotCue likewise
      // ride the log as evidence without touching detection state.)
      break;
    case 'load':
      s.decks[e.channel].trackId = e.trackId;
      break;
    case 'pitch':
      s.decks[e.channel].pitch = e.value;
      break;
    default:
      break;
  }
}

function dissolve(s: CaptureState): void {
  s.engagedSince = null;
  s.outgoingTrackId = null;
  s.incomingTrackId = null;
  s.incomingSilentSince = null;
  s.outSilentSince = null;
  s.outTrackAtCessation = null;
  s.openSnapshot = null;
}

function openEngagement(s: CaptureState, at: number): void {
  const inc = s.incumbent!;
  s.engagedSince = at;
  // Hard-cut path: the incumbent already ceased — its Track was
  // snapshotted then, so a Load within the cut gap can't mis-attribute.
  s.outgoingTrackId = s.outTrackAtCessation ?? s.decks[inc].trackId;
  s.incomingTrackId = s.decks[OTHER[inc]].trackId;
  s.incomingSilentSince = null;
  const snapDeck = (d: DeckCapture) => ({
    trackId: d.trackId,
    playing: d.playing,
    fader: d.fader,
    trim: d.trim,
    eq: { ...d.eq },
    filter: d.filter,
    pitch: d.pitch,
  });
  s.openSnapshot = {
    t: at,
    kind: 'init',
    outgoingChannel: inc,
    decks: { A: snapDeck(s.decks.A), B: snapDeck(s.decks.B) },
    crossfader: s.crossfader,
    crossfaderEnabled: s.crossfaderEnabled,
  };
}

function emitTake(s: CaptureState): DetectedTake | null {
  if (s.outgoingTrackId === null || s.incomingTrackId === null) return null;
  const windowStartS = s.engagedSince!;
  const windowEndS = s.outSilentSince!;
  const incoming = OTHER[s.incumbent!];
  const overlap = windowEndS - windowStartS;
  const confidence = !s.decks[incoming].audible ? 0.5 : overlap < 1 ? 0.7 : 0.9;
  const lo = windowStartS - s.params.padS;
  const hi = windowEndS + s.params.padS;
  return {
    outgoingTrackId: s.outgoingTrackId,
    incomingTrackId: s.incomingTrackId,
    windowStartS,
    windowEndS,
    confidence,
    detectorVersion: DETECTOR_VERSION,
    params: s.params,
    // now may exceed hi (settlement lags the window by the horizon);
    // slice by window+pad regardless — the horizon tail is not evidence.
    // The synthetic init head carries engagement-open state + deck roles.
    // Pre-window pad events ARE included (context); the init state already
    // reflects them, and that's safe: control events carry absolute values
    // (set, not delta), so replaying them over init is idempotent.
    events: [
      ...(s.openSnapshot ? [s.openSnapshot] : []),
      ...s.log.filter((ev) => ev.t >= lo && ev.t <= hi),
    ],
  };
}

/**
 * Feed one event; returns the next state and any settled Takes (0 or 1).
 */
export function reduceCapture(
  state: CaptureState,
  e: CaptureEvent
): [CaptureState, DetectedTake[]] {
  // The input state is never mutated: everything below works on this
  // deck-deep clone (imperative onEdge/applyEvent helpers mutate the
  // clone, not the caller's state — externally the reducer stays pure).
  const s: CaptureState = {
    ...state,
    decks: {
      A: { ...state.decks.A },
      B: { ...state.decks.B },
      C: { ...state.decks.C },
      D: { ...state.decks.D },
    },
    log: [...state.log, e],
  };
  const takes: DetectedTake[] = [];
  const now = e.t;

  applyEvent(s, e);

  // Tenure markers (ADR 0033) move the old recorder surface gate into the
  // log: a machine holding the surface suspends the pair machine's verdicts
  // exactly as the surface gate did — the log keeps growing regardless.
  if (e.kind === 'tenure') s.tenureHeld = e.edge === 'start';

  // Keep C/D audibility current for the >2-audible count (the pair machine
  // ignores them; only the self-gate reads their audibility).
  for (const ch of ['C', 'D'] as CaptureDeck[]) {
    const audible = deckAudible(s, ch);
    if (audible !== s.decks[ch].audible) {
      s.decks[ch].audible = audible;
      s.decks[ch].since = now;
    }
  }

  // Suspension edge (tenure held OR >2 decks audible; ADR 0033). `audibleDeckCount`
  // recomputes all four live, so it's correct before the A/B `.audible`
  // fields are written by the edge loop below. Entering discards any
  // in-flight engagement and clears incumbency; leaving re-establishes the
  // incumbent from current A/B audibility (the recorder re-seeds in step).
  const suspendedNow = s.tenureHeld || audibleDeckCount(s) > 2;
  if (suspendedNow && !s.suspended) {
    dissolve(s);
    s.incumbent = null;
    s.outSilentSince = null;
    s.outTrackAtCessation = null;
    s.incomingSilentSince = null;
  } else if (!suspendedNow && s.suspended) {
    // Re-seed: the audible-first A/B deck becomes incumbent (or nobody).
    // No Handover spans the suspended gap.
    s.decks.A.audible = deckAudible(s, 'A');
    s.decks.B.audible = deckAudible(s, 'B');
    s.incumbent = s.decks.A.audible ? 'A' : s.decks.B.audible ? 'B' : null;
  }
  s.suspended = suspendedNow;

  if (s.suspended) {
    // Log grows (already pushed); pair machine stands down. Prune and return.
    pruneLog(s, now);
    return [s, takes];
  }

  // A Load re-premises the deck: the track being traded no longer exists
  // on it, so an open engagement's pair snapshot must not outlive the
  // decks it described (the sets-13 rehearsal-reload mis-attribution).
  // - Outgoing already ceased → the Handover was complete; its comeback
  //   is now impossible, so settle it immediately instead of waiting out
  //   the horizon (an eager next-track Load must not lose the Take).
  // - Otherwise → bail: abandoning a blend by loading fresh tracks is
  //   not a Handover; dissolve with no Take.
  // A Load onto a LIVE incumbent also resets incumbency — its audible run
  // ended by replacement, not by mix-out. (A Load onto an already-ceased
  // incumbent keeps the cut-gap defense: outTrackAtCessation still
  // attributes the outgoing.)
  if (e.kind === 'load') {
    if (s.engagedSince !== null) {
      if (s.outSilentSince !== null) {
        const take = emitTake(s);
        if (take) takes.push(take);
        const incoming = OTHER[s.incumbent!];
        s.incumbent = s.decks[incoming].audible ? incoming : null;
      }
      dissolve(s);
    }
    if (s.incumbent === e.channel && s.outSilentSince === null) {
      s.incumbent = null;
    }
  }

  // Audibility edges — CESSATIONS FIRST: an event flipping both decks at
  // once (a crossfader flick) must anchor as a cut at the cessation, on
  // either incumbency, not ride whichever deck the loop visited first.
  const edges = (['A', 'B'] as CaptureChannel[])
    .map((ch) => ({ ch, audible: deckAudible(s, ch) }))
    .filter(({ ch, audible }) => audible !== s.decks[ch].audible)
    .sort((a, b) => Number(a.audible) - Number(b.audible));
  for (const { ch, audible } of edges) {
    s.decks[ch].audible = audible;
    s.decks[ch].since = now;
    onEdge(s, ch, audible, now);
  }

  // Time-driven settlement / dissolution.
  if (s.outSilentSince !== null && now - s.outSilentSince >= s.params.settleHorizonS) {
    if (s.engagedSince !== null) {
      const take = emitTake(s);
      if (take) takes.push(take);
      // The incoming deck inherits incumbency (it may itself already be
      // silent — then nobody is incumbent).
      const incoming = OTHER[s.incumbent!];
      s.incumbent = s.decks[incoming].audible ? incoming : null;
      dissolve(s);
    } else {
      // Lone incumbent stopped and nothing came in: not a Handover.
      s.incumbent = null;
      s.outSilentSince = null;
      s.outTrackAtCessation = null;
    }
  }
  if (
    s.engagedSince !== null &&
    s.incomingSilentSince !== null &&
    now - s.incomingSilentSince >= s.params.settleHorizonS
  ) {
    // Tease-and-bail: the outgoing survived; no Take.
    dissolve(s);
  }

  pruneLog(s, now);

  return [s, takes];
}

/** Prune the rolling log to the current retention horizon. */
function pruneLog(s: CaptureState, now: number): void {
  const keepFrom =
    s.engagedSince !== null
      ? s.engagedSince - s.params.padS
      : (s.outSilentSince ?? now) - s.params.idleKeepS;
  if (s.log.length > 0 && s.log[0].t < keepFrom) {
    s.log = s.log.filter((ev) => ev.t >= keepFrom);
  }
}

/** An audibility edge on one deck. */
function onEdge(s: CaptureState, ch: CaptureChannel, audible: boolean, now: number): void {
  if (s.incumbent === null) {
    if (audible) s.incumbent = ch;
    return;
  }

  const incumbent = s.incumbent;
  const isIncumbent = ch === incumbent;

  if (!isIncumbent) {
    // The OTHER deck (incoming candidate).
    if (audible) {
      if (s.engagedSince !== null) {
        s.incomingSilentSince = null; // fold a tease gap
      } else if (s.decks[incumbent].audible) {
        openEngagement(s, now); // overlap onset
      } else if (
        s.outSilentSince !== null &&
        now - s.outSilentSince <= s.params.cutGapMaxS
      ) {
        openEngagement(s, s.outSilentSince); // hard cut: window is the cut instant
      } else {
        // Incumbent long gone: fresh incumbency, no Handover.
        s.incumbent = ch;
        s.outSilentSince = null;
        s.outTrackAtCessation = null;
      }
    } else if (s.engagedSince !== null && s.outSilentSince === null) {
      s.incomingSilentSince = now; // tease clock (outgoing still here)
    }
    return;
  }

  // The incumbent (outgoing candidate).
  if (!audible) {
    s.outSilentSince = now;
    s.outTrackAtCessation = s.decks[incumbent].trackId;
  } else if (s.outSilentSince !== null) {
    s.outSilentSince = null; // cross-cut fold / lone-incumbent return
    s.outTrackAtCessation = null;
  }
}
