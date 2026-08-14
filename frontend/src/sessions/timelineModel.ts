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

/** A seek landing within this of the extrapolated pre-seek position is a
 * JOG scrub (rim-tick nudge), not a jump — it continues the trace without
 * a marker/break, so a busy scrub reads as one smooth move (perf: a set
 * with 10k+ jog seeks was rendering 10k markers + trace fragments). */
const JOG_SEEK_MAX_S = 2;
/** Minimum spacing between kept jog-trace samples (~20 Hz): rim ticks can
 * fire many times per frame; decimating bounds the point count. */
const JOG_DECIMATE_S = 0.05;

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

/** A discrete transport gesture worth a marker (seek / beat jump / hot
 * cue): handler-only evidence the lane renders as glyphs (sessions 04
 * iteration). `playhead` is the post-gesture track position. */
export interface GestureMark {
  t: number;
  action: 'seek' | 'jumpBeats' | 'hotCue' | 'cue';
  playhead: number;
  detail?: number;
}

/** A held loop: engage/resize → release/cancel (region null). */
export interface LoopSpan extends Span {
  /** The last region held (track seconds). */
  region: { start: number; end: number };
  /** Unclosed at log end. */
  open: boolean;
}

/** One step of the audibility-gain series: from `t`, this deck contributes
 * `gain` to Master (0 while inaudible/tenure-masked). The area-chart fill. */
export interface GainStep {
  t: number;
  gain: number;
}

export interface DeckTimeline {
  deck: CaptureDeck;
  trackSpans: TrackSpan[];
  playingSpans: Span[];
  audibleSpans: Span[];
  traces: PlayheadTrace[];
  gestures: GestureMark[];
  loops: LoopSpan[];
  /** Step series (event-aligned) of audible Master gain; 0 = silent. */
  gainSteps: GainStep[];
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
  /** Distinct Tracks that became Master-audible during the Session (any
   * audibility span overlapped that Track's tenure on its deck). Repeated
   * audible plays count once; loaded-only, cue/PFL-only, and
   * tenure-masked Tracks are absent (audibleSpans already exclude them).
   * The Sessions-list "Tracks" count. */
  audibleTrackIds: number[];
  eventCount: number;
}

// ── Reducer state (all four decks; audibility inputs + playheads) ────────

interface DeckState {
  trackId: number | null;
  playing: boolean;
  /** A CUE stab in progress (previewStart..previewEnd, sessions 10): audio
   * runs and its playhead rides the ticks, but `playing` never flips. */
  previewing: boolean;
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
      d.playing = false;
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

  const gestures = perDeck<GestureMark[]>(() => []);
  const loops = perDeck<LoopSpan[]>(() => []);
  const openLoop = perDeck<{ since: number; region: { start: number; end: number } } | null>(
    () => null
  );
  const gainSteps = perDeck<GainStep[]>(() => []);
  const lastGain = perDeck<number>(() => 0);

  const tenures: TenureSpan[] = [];
  let openTenure: { holder: string; since: number } | null = null;

  const trackIds = new Set<number>();

  const breakTrace = (ch: CaptureDeck) => {
    const tr = openTrace[ch];
    if (tr && tr.length >= 2) traces[ch].push(tr);
    openTrace[ch] = null;
  };
  const sampleTrace = (ch: CaptureDeck, t: number, playhead: number, jog = false) => {
    let tr = openTrace[ch];
    if (tr && tr.length > 0) {
      const last = tr[tr.length - 1];
      const dt = t - last.t;
      const dp = playhead - last.playhead;
      // Jog scrub: a smooth, possibly-reversing move. Skip the
      // discontinuity check (it would shatter the scrub into fragments),
      // and DECIMATE — a rim tick can fire many times a frame; keep at
      // most ~20 Hz so a busy scrub is a handful of points, not thousands.
      if (jog) {
        if (dt < JOG_DECIMATE_S) return;
        tr.push({ t, playhead });
        return;
      }
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
    // Pre-event playhead for the affected deck: seek-class gestures must
    // CLOSE the old trace at the jump instant (extrapolated), not at the
    // last tick — otherwise every jump leaves an up-to-1s waveform gap.
    // preJump: the moving playhead just before a discontinuity, to close
    // the outgoing trace at the jump instant (only meaningful while
    // playing/previewing — a paused deck's trace is already closed).
    let preJump: number | null = null;
    // jogRef: the position a seek is measured against to tell a jog scrub
    // (tiny nudge) from a jump — valid even while paused (a paused scrub
    // is common and must not emit thousands of markers).
    let jogRef: number | null = null;
    if (
      e.kind === 'transport' &&
      (e.action === 'seek' || e.action === 'jumpBeats' || e.action === 'hotCue')
    ) {
      const d = s.decks[e.channel];
      if (d.playing || d.previewing) {
        preJump = d.playhead + (e.t - d.playheadAt) * (1 + d.pitch / 100);
        jogRef = preJump;
      } else {
        jogRef = d.playhead;
      }
    }

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
    // A CUE stab (sessions 10) rides the same mechanism: previewStart opens
    // a trace, its ticks sample it, previewEnd closes it — the stab's
    // waveform renders like any playing stretch.
    if (e.kind === 'tick') {
      for (const ch of ALL_DECKS) {
        const p = e.playheads[ch];
        if (p !== undefined && (s.decks[ch].playing || s.decks[ch].previewing)) {
          sampleTrace(ch, e.t, p);
        }
      }
    } else if (e.kind === 'transport') {
      if (e.action === 'play' || e.action === 'previewStart') {
        sampleTrace(e.channel, e.t, e.playhead);
        // Cue-press marker (sessions 11): a main-cue stab launch IS a CUE
        // press — mark it like return-to-cue (▲). Hot-cue stabs already get
        // their ◆slot mark from the launch hotCue gesture (detail = slot).
        if (e.action === 'previewStart' && e.detail === undefined) {
          gestures[e.channel].push({ t: e.t, action: 'cue', playhead: e.playhead });
        }
      } else if (e.action === 'pause' || e.action === 'cue' || e.action === 'previewEnd') {
        sampleTrace(e.channel, e.t, e.playhead);
        breakTrace(e.channel);
        if (e.action === 'cue') {
          gestures[e.channel].push({ t: e.t, action: 'cue', playhead: e.playhead });
        }
      } else {
        // seek / jumpBeats / hotCue: a discontinuity gesture. BUT a jog
        // scrub emits a continuous stream of tiny seeks (one per rim tick
        // — thousands in a busy set); rendering a marker + trace break per
        // tick shatters the lane into thousands of fragments and tanks the
        // frame rate. A jog seek is a smooth move, not a jump: treat a
        // SMALL seek as a trace continuation (no marker, no break). Only a
        // genuine discontinuity — a jumpBeats/hotCue, or a seek that
        // actually leaps — marks and breaks.
        const isJog =
          e.action === 'seek' &&
          jogRef !== null &&
          Math.abs(e.playhead - jogRef) <= JOG_SEEK_MAX_S;
        if (isJog) {
          if (s.decks[e.channel].playing || s.decks[e.channel].previewing) {
            sampleTrace(e.channel, e.t, e.playhead, true);
          }
        } else {
          gestures[e.channel].push({
            t: e.t,
            action: e.action,
            playhead: e.playhead,
            detail: e.detail,
          });
          // A gesture that lands where the playhead already is (a stab
          // launch's hotCue at the just-opened previewStart position) is
          // not a leap: don't close/reopen the trace around it (that would
          // fragment the stab's waveform). Only a real jump breaks.
          const leaps = preJump === null || Math.abs(e.playhead - preJump) > 0.01;
          if (leaps) {
            if (preJump !== null) sampleTrace(e.channel, e.t, preJump);
            breakTrace(e.channel);
            // Re-open for playing/previewing decks (sessions 11): the
            // hot-cue stab launch fires previewStart then its hotCue
            // gesture — without this the gesture would sever the
            // just-opened trace until the first tick (leading gap).
            if (s.decks[e.channel].playing || s.decks[e.channel].previewing) {
              sampleTrace(e.channel, e.t, e.playhead);
            }
          }
        }
      }
    }

    // Held loops (looping 06 evidence): engage/resize carry a region,
    // release/cancel/Load-clear carry null.
    if (e.kind === 'loop') {
      const open = openLoop[e.channel];
      if (e.region !== null) {
        if (open === null) openLoop[e.channel] = { since: e.t, region: e.region };
        else open.region = e.region; // resize: keep the span, update region
      } else if (open !== null) {
        loops[e.channel].push({ start: open.since, end: e.t, region: open.region, open: false });
        openLoop[e.channel] = null;
      }
    }
    if (e.kind === 'load') {
      const open = openLoop[e.channel];
      if (open !== null) {
        // A Load clears the loop (DeckEngine semantics).
        loops[e.channel].push({ start: open.since, end: e.t, region: open.region, open: false });
        openLoop[e.channel] = null;
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
      // Audible-gain step series (the area-chart fill): the deck's Master
      // contribution, zero while silent or tenure-masked.
      const gain = a ? deckMasterGain(s.decks[ch], mixerInputs(s)) : 0;
      if (gain !== lastGain[ch]) {
        gainSteps[ch].push({ t: e.t, gain });
        lastGain[ch] = gain;
      }
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
    const loop = openLoop[ch];
    if (loop) loops[ch].push({ start: loop.since, end, region: loop.region, open: true });
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
        gestures: gestures[ch],
        loops: loops[ch],
        gainSteps: gainSteps[ch],
      },
    ])
  ) as Record<CaptureDeck, DeckTimeline>;

  // Distinct Master-audible Tracks (the Sessions-list "Tracks" count): a
  // Track counts iff its tenure on a deck overlapped that deck's
  // audibility (which already excludes cue/PFL, loaded-silent, kills, and
  // tenure-masked stretches). One definition, reused — no divergence.
  const audibleTrackIds = new Set<number>();
  for (const ch of ALL_DECKS) {
    for (const span of trackSpans[ch]) {
      if (audibleTrackIds.has(span.trackId)) continue;
      if (audible[ch].spans.some((a) => a.start < span.end && a.end > span.start)) {
        audibleTrackIds.add(span.trackId);
      }
    }
  }

  return {
    start,
    end,
    decks,
    tenures,
    suspended: suspended.spans,
    idle: idle.spans,
    overlaps: overlap.spans,
    trackIds: [...trackIds],
    audibleTrackIds: [...audibleTrackIds],
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
      // Pitch-aware extrapolation: a deck at +4.6% advances 1.046 track-sec
      // per wall-sec. Rate-blind extrapolation seeded replays with a
      // per-deck phase error ∝ (T − last tick) × pitch — the "blend isn't
      // beatmatched, differently every time" bug.
      const rate = 1 + d.pitch / 100;
      const extrapolated = d.playing ? d.playhead + (t - d.playheadAt) * rate : d.playhead;
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

// ── Piecewise time axis with idle collapse (pixel space) ────────────────

export interface AxisSegment extends Span {
  collapsed: boolean;
  /** Pixel extent within the total timeline width. */
  px0: number;
  px1: number;
}

export interface TimeAxis {
  segments: AxisSegment[];
  /** Capture time → timeline px. */
  tToPx(t: number): number;
  /** Timeline px → capture time (collapsed markers map to their start). */
  pxToT(x: number): number;
  /** Total timeline width in px. */
  totalPx: number;
  /** Sum of un-collapsed duration (drives tick/zoom decisions). */
  visibleDurationS: number;
  /** The zoom this axis was built at. */
  pxPerSec: number;
}

/** Collapsed idle stretches are FIXED pixels regardless of zoom — a
 * zoom-scaling marker inflates around the cursor and makes the content
 * visibly jump during zoom gestures (04 iteration bug). */
export const COLLAPSED_MARKER_PX = 28;

export function buildTimeAxis(
  model: TimelineModel,
  opts: {
    collapseIdle: boolean;
    thresholdS: number;
    expanded?: ReadonlySet<number>;
    /** Zoom: pixels per un-collapsed second. */
    pxPerSec: number;
  }
): TimeAxis {
  const { start, end } = model;
  const pxPerSec = Math.max(0.0001, opts.pxPerSec);
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
      segments.push({ start: cursor, end: sp.start, collapsed: false, px0: 0, px1: 0 });
    }
    segments.push({ start: sp.start, end: sp.end, collapsed: true, px0: 0, px1: 0 });
    cursor = sp.end;
  }
  if (end > cursor || segments.length === 0) {
    segments.push({ start: cursor, end: Math.max(end, cursor), collapsed: false, px0: 0, px1: 0 });
  }

  const visibleDurationS = segments
    .filter((seg) => !seg.collapsed)
    .reduce((acc, seg) => acc + (seg.end - seg.start), 0);

  let x = 0;
  for (const seg of segments) {
    seg.px0 = x;
    x += seg.collapsed ? COLLAPSED_MARKER_PX : (seg.end - seg.start) * pxPerSec;
    seg.px1 = x;
  }
  const totalPx = x;

  const tToPx = (t: number): number => {
    if (segments.length === 0) return 0;
    if (t <= segments[0].start) return 0;
    for (const seg of segments) {
      if (t <= seg.end) {
        if (seg.collapsed) return (seg.px0 + seg.px1) / 2;
        const dur = seg.end - seg.start;
        return dur <= 0 ? seg.px0 : seg.px0 + ((t - seg.start) / dur) * (seg.px1 - seg.px0);
      }
    }
    return totalPx;
  };

  const pxToT = (xq: number): number => {
    if (segments.length === 0) return 0;
    if (xq <= 0) return segments[0].start;
    for (const seg of segments) {
      if (xq <= seg.px1) {
        if (seg.collapsed) return seg.start;
        const w = seg.px1 - seg.px0;
        return w <= 0 ? seg.start : seg.start + ((xq - seg.px0) / w) * (seg.end - seg.start);
      }
    }
    return segments[segments.length - 1].end;
  };

  return { segments, tToPx, pxToT, totalPx, visibleDurationS, pxPerSec };
}

// ── Trace lookup (session time → track time; waveform mapping) ──────────

/** The deck's audible Master gain at session time `t` (step lookup;
 * binary search — the render path calls this per pixel column). */
export function gainAt(steps: GainStep[], t: number): number {
  if (steps.length === 0 || t < steps[0].t) return 0;
  let lo = 0;
  let hi = steps.length - 1;
  while (hi - lo > 0) {
    const mid = (lo + hi + 1) >> 1;
    if (steps[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  return steps[lo].gain;
}

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
