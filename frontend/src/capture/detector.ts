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
import { channelFaderToGain, crossfaderGains, trimToGain } from '../playback/mixerMath';
import {
  DEFAULT_DETECTOR_PARAMS,
  DETECTOR_VERSION,
} from './events';
import type {
  CaptureChannel,
  CaptureEvent,
  DetectedTake,
  DetectorParams,
} from './events';

interface DeckCapture {
  trackId: number | null;
  playing: boolean;
  fader: number;
  trim: number;
  eq: { low: number; mid: number; high: number };
  filter: number;
  audible: boolean;
  /** Time of the last audibility flip. */
  since: number;
}

export interface CaptureState {
  params: DetectorParams;
  /** Rolling event log (pruned; Take slices are cut from it). */
  log: CaptureEvent[];
  decks: Record<CaptureChannel, DeckCapture>;
  crossfader: number;
  crossfaderEnabled: boolean;
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
}

const OTHER: Record<CaptureChannel, CaptureChannel> = { A: 'B', B: 'A' };

function freshDeck(): DeckCapture {
  // Mixer channel-strip defaults: fader up, trim/EQ centered, filter off.
  return {
    trackId: null,
    playing: false,
    fader: 1,
    trim: 0.5,
    eq: { low: 0.5, mid: 0.5, high: 0.5 },
    filter: 0,
    audible: false,
    since: 0,
  };
}

export function initialCaptureState(params: DetectorParams = DEFAULT_DETECTOR_PARAMS): CaptureState {
  return {
    params,
    log: [],
    decks: { A: freshDeck(), B: freshDeck() },
    crossfader: 0,
    crossfaderEnabled: true,
    incumbent: null,
    engagedSince: null,
    outgoingTrackId: null,
    incomingTrackId: null,
    incomingSilentSince: null,
    outSilentSince: null,
    outTrackAtCessation: null,
  };
}

function deckAudible(s: CaptureState, ch: CaptureChannel): boolean {
  const d = s.decks[ch];
  if (!d.playing) return false;
  // Kill-style mix-outs never touch the fader: an EQ full-kill or a sweep
  // filter ridden to an end silences the deck just as finally.
  const { eqKillBelow, filterKillBeyond } = s.params;
  if (d.eq.low <= eqKillBelow && d.eq.mid <= eqKillBelow && d.eq.high <= eqKillBelow) return false;
  if (Math.abs(d.filter) >= filterKillBeyond) return false;
  const xf = crossfaderGains(s.crossfaderEnabled ? s.crossfader : 0);
  const gain =
    trimToGain(d.trim) * channelFaderToGain(d.fader) * (ch === 'A' ? xf.a : xf.b);
  return gain >= s.params.audibleGain;
}

/** Apply the raw event to deck/mixer state (audibility inputs only —
 * everything else just rides the log as evidence). */
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
      else if (e.control === 'crossfader') s.crossfader = e.value;
      else if (e.control === 'crossfaderEnabled') s.crossfaderEnabled = e.value !== 0;
      break;
    }
    case 'transport':
      if (e.action === 'play') s.decks[e.channel].playing = true;
      else if (e.action === 'pause' || e.action === 'cue') s.decks[e.channel].playing = false;
      break;
    case 'load':
      s.decks[e.channel].trackId = e.trackId;
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
}

function openEngagement(s: CaptureState, at: number): void {
  const inc = s.incumbent!;
  s.engagedSince = at;
  // Hard-cut path: the incumbent already ceased — its Track was
  // snapshotted then, so a Load within the cut gap can't mis-attribute.
  s.outgoingTrackId = s.outTrackAtCessation ?? s.decks[inc].trackId;
  s.incomingTrackId = s.decks[OTHER[inc]].trackId;
  s.incomingSilentSince = null;
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
    events: s.log.filter((ev) => ev.t >= lo && ev.t <= hi),
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
    decks: { A: { ...state.decks.A }, B: { ...state.decks.B } },
    log: [...state.log, e],
  };
  const takes: DetectedTake[] = [];
  const now = e.t;

  applyEvent(s, e);

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

  // Prune the rolling log.
  const keepFrom =
    s.engagedSince !== null
      ? s.engagedSince - s.params.padS
      : (s.outSilentSince ?? now) - s.params.idleKeepS;
  if (s.log.length > 0 && s.log[0].t < keepFrom) {
    s.log = s.log.filter((ev) => ev.t >= keepFrom);
  }

  return [s, takes];
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
