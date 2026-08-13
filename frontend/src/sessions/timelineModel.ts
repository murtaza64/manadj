/**
 * Session timeline read model (sessions 04, ADR 0033) — pure, under vitest.
 *
 * A reducer over one Session's whole event log deriving everything the
 * timeline draws; graduated from the sessions-03 prototype:
 *
 * - per-Deck track spans (loads), playing spans (transport), audibility
 *   spans (capture/audibility — the detector's own definition, so the
 *   bands are what the detector heard), playhead traces (ticks +
 *   transport, broken at discontinuities — these also map session time to
 *   track time for waveform rendering)
 * - tenure holds (a machine held the Audible surface: honest gaps;
 *   audibility is masked beneath them — the shared surface was displaced)
 * - suspended stretches (>2 decks audible: the detector self-gated)
 * - idle stretches (no audible deck, no tenure) → collapse candidates
 * - a piecewise time axis that collapses idle to fixed-width markers
 * - state reconstruction at an arbitrary T (the scrub readout; the replay
 *   planner builds on the same reducer, sessions 05)
 */
import type { CrossfaderAssignment } from '../playback/crossfaderAssignmentStore';
import { deckMasterGain, isDeckAudible } from '../capture/audibility';
import { DEFAULT_DETECTOR_PARAMS } from '../capture/events';
import type { CaptureDeck, CaptureEvent } from '../capture/events';

export const ALL_DECKS: CaptureDeck[] = ['A', 'B', 'C', 'D'];

export interface Span {
  start: number;
  end: number;
}

export interface TrackSpan extends Span {
  trackId: number;
}

export interface TenureSpan extends Span {
  holder: string;
  /** An unclosed hold (session ended / crashed inside it). */
  open: boolean;
}

/** One polyline of (t, playhead) samples — broken at seeks/loads/pauses.
 * Doubles as the session-time → track-time map for waveform rendering:
 * within a trace, track time interpolates linearly between samples. */
export type PlayheadTrace = { t: number; playhead: number }[];

export interface DeckTimeline {
  deck: CaptureDeck;
  trackSpans: TrackSpan[];
  playingSpans: Span[];
  audibleSpans: Span[];
  traces: PlayheadTrace[];
}

export interface TimelineModel {
  start: number;
  end: number;
  decks: Record<CaptureDeck, DeckTimeline>;
  tenures: TenureSpan[];
  /** >2 decks Master-audible: the detector stood down over these. */
  suspended: Span[];
  /** No audible deck AND no tenure hold — collapse candidates. */
  idle: Span[];
  /** ≥2 decks simultaneously audible (trading material). */
  overlaps: Span[];
  /** Every trackId that appeared in a load event. */
  trackIds: number[];
  eventCount: number;
}

// ── Reducer state (all four decks; audibility inputs + playheads) ────────

interface DeckState {
  trackId: number | null;
  playing: boolean;
  fader: number;
  trim: number;
  eq: { low: number; mid: number; high: number };
  filter: number;
  assignment: CrossfaderAssignment;
  pitch: number;
  /** Last known playhead (track seconds) and the capture time we knew it. */
  playhead: number;
  playheadAt: number;
}

interface ReducerState {
  decks: Record<CaptureDeck, DeckState>;
  crossfader: number;
  crossfaderEnabled: boolean;
  tenureHolder: string | null;
}

function freshDeck(assignment: CrossfaderAssignment): DeckState {
  // Mixer channel-strip defaults — same as the detector's freshDeck.
  return {
    trackId: null,
    playing: false,
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

function initialState(): ReducerState {
  return {
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

function assignmentFromValue(value: number): CrossfaderAssignment {
  return value < 0 ? 'left' : value > 0 ? 'right' : 'thru';
}

function mixerInputs(s: ReducerState) {
  return { crossfader: s.crossfader, crossfaderEnabled: s.crossfaderEnabled };
}

/** Master-audible under the shared surface: a machine tenure displaces the
 * whole surface, so nothing is audible beneath it regardless of mixer math
 * (graduated decision — the detector gates identically). */
function deckAudible(s: ReducerState, ch: CaptureDeck): boolean {
  if (s.tenureHolder !== null) return false;
  return isDeckAudible(s.decks[ch], mixerInputs(s), DEFAULT_DETECTOR_PARAMS);
}

function applyEvent(s: ReducerState, e: CaptureEvent): void {
  switch (e.kind) {
    case 'control': {
      const d = e.channel ? s.decks[e.channel] : null;
      if (e.control === 'fader' && d) d.fader = e.value;
      else if (e.control === 'trim' && d) d.trim = e.value;
      else if (e.control === 'eqLow' && d) d.eq = { ...d.eq, low: e.value };
      else if (e.control === 'eqMid' && d) d.eq = { ...d.eq, mid: e.value };
      else if (e.control === 'eqHigh' && d) d.eq = { ...d.eq, high: e.value };
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
      d.playing = false;
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

// ── Derivation ───────────────────────────────────────────────────────────

/** Interval builder: flip a boolean over time, harvest closed spans. */
class SpanBuilder {
  spans: Span[] = [];
  private openAt: number | null = null;

  set(on: boolean, t: number): void {
    if (on && this.openAt === null) this.openAt = t;
    else if (!on && this.openAt !== null) {
      if (t > this.openAt) this.spans.push({ start: this.openAt, end: t });
      this.openAt = null;
    }
  }

  close(t: number): void {
    this.set(false, t);
  }
}

export function deriveTimeline(events: CaptureEvent[]): TimelineModel {
  const s = initialState();
  const start = events.length > 0 ? events[0].t : 0;
  const end = events.length > 0 ? events[events.length - 1].t : 0;

  const perDeck = <T>(make: () => T): Record<CaptureDeck, T> =>
    Object.fromEntries(ALL_DECKS.map((d) => [d, make()])) as Record<CaptureDeck, T>;

  const audible = perDeck(() => new SpanBuilder());
  const playing = perDeck(() => new SpanBuilder());
  const suspended = new SpanBuilder();
  const idle = new SpanBuilder();
  const overlap = new SpanBuilder();

  const trackSpans = perDeck<TrackSpan[]>(() => []);
  const openTrack = perDeck<{ trackId: number; since: number } | null>(() => null);

  const traces = perDeck<PlayheadTrace[]>(() => []);
  const openTrace = perDeck<PlayheadTrace | null>(() => null);

  const tenures: TenureSpan[] = [];
  let openTenure: { holder: string; since: number } | null = null;

  const trackIds = new Set<number>();

  const breakTrace = (ch: CaptureDeck) => {
    const tr = openTrace[ch];
    if (tr && tr.length >= 2) traces[ch].push(tr);
    openTrace[ch] = null;
  };
  const sampleTrace = (ch: CaptureDeck, t: number, playhead: number) => {
    let tr = openTrace[ch];
    if (tr && tr.length > 0) {
      const last = tr[tr.length - 1];
      const dt = t - last.t;
      const dp = playhead - last.playhead;
      // Discontinuity: jumped (seek/hot cue) or reversed or a long silence.
      if (dp < -0.75 || Math.abs(dp - dt) > Math.max(2, dt * 0.5) || dt > 4) {
        breakTrace(ch);
        tr = null;
      }
    }
    if (!tr) {
      tr = [];
      openTrace[ch] = tr;
    }
    tr.push({ t, playhead });
  };

  for (const e of events) {
    applyEvent(s, e);

    // Track spans (loads).
    if (e.kind === 'load') {
      const open = openTrack[e.channel];
      if (open) {
        trackSpans[e.channel].push({ start: open.since, end: e.t, trackId: open.trackId });
        openTrack[e.channel] = null;
      }
      if (e.trackId !== null) {
        openTrack[e.channel] = { trackId: e.trackId, since: e.t };
        trackIds.add(e.trackId);
      }
      breakTrace(e.channel);
    }

    // Playhead traces: sample on ticks and transport; break on stops.
    if (e.kind === 'tick') {
      for (const ch of ALL_DECKS) {
        const p = e.playheads[ch];
        if (p !== undefined && s.decks[ch].playing) sampleTrace(ch, e.t, p);
      }
    } else if (e.kind === 'transport') {
      if (e.action === 'play') sampleTrace(e.channel, e.t, e.playhead);
      else if (e.action === 'pause' || e.action === 'cue') {
        sampleTrace(e.channel, e.t, e.playhead);
        breakTrace(e.channel);
      } else {
        // seek / jumpBeats / hotCue: close the old line, start anew.
        breakTrace(e.channel);
        if (s.decks[e.channel].playing) sampleTrace(e.channel, e.t, e.playhead);
      }
    }

    // Tenure holds.
    if (e.kind === 'tenure') {
      if (e.edge === 'start' && openTenure === null) {
        openTenure = { holder: e.holder, since: e.t };
      } else if (e.edge === 'end' && openTenure !== null) {
        tenures.push({ start: openTenure.since, end: e.t, holder: openTenure.holder, open: false });
        openTenure = null;
      }
    }

    // Boolean lanes, re-evaluated after every event.
    let audibleCount = 0;
    for (const ch of ALL_DECKS) {
      const a = deckAudible(s, ch);
      if (a) audibleCount += 1;
      audible[ch].set(a, e.t);
      playing[ch].set(s.decks[ch].playing, e.t);
    }
    suspended.set(audibleCount > 2, e.t);
    overlap.set(audibleCount >= 2, e.t);
    idle.set(audibleCount === 0 && s.tenureHolder === null, e.t);
  }

  // Close everything at the log's end.
  for (const ch of ALL_DECKS) {
    audible[ch].close(end);
    playing[ch].close(end);
    const open = openTrack[ch];
    if (open) trackSpans[ch].push({ start: open.since, end, trackId: open.trackId });
    breakTrace(ch);
  }
  suspended.close(end);
  overlap.close(end);
  idle.close(end);
  if (openTenure !== null) {
    tenures.push({ start: openTenure.since, end, holder: openTenure.holder, open: true });
  }

  const decks = Object.fromEntries(
    ALL_DECKS.map((ch) => [
      ch,
      {
        deck: ch,
        trackSpans: trackSpans[ch],
        playingSpans: playing[ch].spans,
        audibleSpans: audible[ch].spans,
        traces: traces[ch],
      },
    ])
  ) as Record<CaptureDeck, DeckTimeline>;

  return {
    start,
    end,
    decks,
    tenures,
    suspended: suspended.spans,
    idle: idle.spans,
    overlaps: overlap.spans,
    trackIds: [...trackIds],
    eventCount: events.length,
  };
}

// ── State reconstruction at T (scrub readout; replay seeds on this) ─────

export interface DeckStateAtT {
  trackId: number | null;
  playing: boolean;
  audible: boolean;
  /** Master-bus gain right now. */
  gain: number;
  /** Track-time playhead, extrapolated from the last sample if playing. */
  playhead: number;
  fader: number;
  trim: number;
  eq: { low: number; mid: number; high: number };
  filter: number;
  assignment: CrossfaderAssignment;
  pitch: number;
}

export interface StateAtT {
  t: number;
  decks: Record<CaptureDeck, DeckStateAtT>;
  crossfader: number;
  crossfaderEnabled: boolean;
  tenureHolder: string | null;
  /** Events at or before T / strictly after T (replay fires the latter). */
  eventsBefore: number;
  eventsAfter: number;
}

/** Reduce the log up to T. O(n) per call — fine for scrubbing a few
 * thousand events; index by checkpoint if Sessions grow to hours. */
export function stateAt(events: CaptureEvent[], t: number): StateAtT {
  const s = initialState();
  let before = 0;
  for (const e of events) {
    if (e.t > t) break;
    applyEvent(s, e);
    before += 1;
  }
  const decks = Object.fromEntries(
    ALL_DECKS.map((ch) => {
      const d = s.decks[ch];
      const extrapolated = d.playing ? d.playhead + (t - d.playheadAt) : d.playhead;
      return [
        ch,
        {
          trackId: d.trackId,
          playing: d.playing,
          audible: deckAudible(s, ch),
          gain: deckMasterGain(d, mixerInputs(s)),
          playhead: Math.max(0, extrapolated),
          fader: d.fader,
          trim: d.trim,
          eq: { ...d.eq },
          filter: d.filter,
          assignment: d.assignment,
          pitch: d.pitch,
        },
      ];
    })
  ) as Record<CaptureDeck, DeckStateAtT>;
  return {
    t,
    decks,
    crossfader: s.crossfader,
    crossfaderEnabled: s.crossfaderEnabled,
    tenureHolder: s.tenureHolder,
    eventsBefore: before,
    eventsAfter: events.length - before,
  };
}

// ── Piecewise time axis with idle collapse ───────────────────────────────

export interface AxisSegment extends Span {
  collapsed: boolean;
  /** x extent in [0..1] of the drawable width. */
  x0: number;
  x1: number;
}

export interface TimeAxis {
  segments: AxisSegment[];
  /** Capture time → x in [0..1]. */
  tToX(t: number): number;
  /** x in [0..1] → capture time (collapsed markers map to their start). */
  xToT(x: number): number;
  /** Sum of un-collapsed duration (drives tick/zoom decisions). */
  visibleDurationS: number;
}

/** Collapsed idle stretches get this fraction of the drawable width each
 * (clamped so pathological sessions still render). */
const COLLAPSED_FRACTION = 0.02;

export function buildTimeAxis(
  model: TimelineModel,
  opts: { collapseIdle: boolean; thresholdS: number; expanded?: ReadonlySet<number> }
): TimeAxis {
  const { start, end } = model;
  const collapsible = opts.collapseIdle
    ? model.idle.filter(
        (sp, i) => sp.end - sp.start >= opts.thresholdS && !(opts.expanded?.has(i) ?? false)
      )
    : [];

  // Alternating segments over [start, end].
  const segments: AxisSegment[] = [];
  let cursor = start;
  for (const sp of collapsible) {
    if (sp.start > cursor) {
      segments.push({ start: cursor, end: sp.start, collapsed: false, x0: 0, x1: 0 });
    }
    segments.push({ start: sp.start, end: sp.end, collapsed: true, x0: 0, x1: 0 });
    cursor = sp.end;
  }
  if (end > cursor || segments.length === 0) {
    segments.push({ start: cursor, end: Math.max(end, cursor), collapsed: false, x0: 0, x1: 0 });
  }

  const collapsedCount = segments.filter((seg) => seg.collapsed).length;
  const collapsedFraction = Math.min(0.3, collapsedCount * COLLAPSED_FRACTION);
  const perCollapsed = collapsedCount > 0 ? collapsedFraction / collapsedCount : 0;
  const visibleDurationS = segments
    .filter((seg) => !seg.collapsed)
    .reduce((acc, seg) => acc + (seg.end - seg.start), 0);
  const scale = visibleDurationS > 0 ? (1 - collapsedFraction) / visibleDurationS : 0;

  let x = 0;
  for (const seg of segments) {
    seg.x0 = x;
    x += seg.collapsed ? perCollapsed : (seg.end - seg.start) * scale;
    seg.x1 = x;
  }
  if (segments.length > 0) segments[segments.length - 1].x1 = 1;

  const tToX = (t: number): number => {
    if (segments.length === 0) return 0;
    if (t <= segments[0].start) return 0;
    for (const seg of segments) {
      if (t <= seg.end) {
        if (seg.collapsed) return seg.x0 + (seg.x1 - seg.x0) / 2;
        const dur = seg.end - seg.start;
        return dur <= 0 ? seg.x0 : seg.x0 + ((t - seg.start) / dur) * (seg.x1 - seg.x0);
      }
    }
    return 1;
  };

  const xToT = (xq: number): number => {
    if (segments.length === 0) return 0;
    if (xq <= 0) return segments[0].start;
    for (const seg of segments) {
      if (xq <= seg.x1) {
        if (seg.collapsed) return seg.start;
        const w = seg.x1 - seg.x0;
        return w <= 0 ? seg.start : seg.start + ((xq - seg.x0) / w) * (seg.end - seg.start);
      }
    }
    return segments[segments.length - 1].end;
  };

  return { segments, tToX, xToT, visibleDurationS };
}

// ── Trace lookup (session time → track time; waveform mapping) ──────────

/** The track time playing on `ch` at session time `t`, or null if the deck
 * wasn't producing a trace there (stopped / no samples). Linear between
 * samples — exact enough at the ~1 Hz tick cadence. */
export function trackTimeAt(deck: DeckTimeline, t: number): number | null {
  for (const trace of deck.traces) {
    if (trace.length < 2) continue;
    if (t < trace[0].t || t > trace[trace.length - 1].t) continue;
    // Binary search for the surrounding pair.
    let lo = 0;
    let hi = trace.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (trace[mid].t <= t) lo = mid;
      else hi = mid;
    }
    const a = trace[lo];
    const b = trace[hi];
    const dur = b.t - a.t;
    if (dur <= 0) return a.playhead;
    return a.playhead + ((t - a.t) / dur) * (b.playhead - a.playhead);
  }
  return null;
}
