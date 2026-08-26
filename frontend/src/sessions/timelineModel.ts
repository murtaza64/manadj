/**
 * Session timeline read model (sessions 04, ADR 0033) — pure, under vitest.
 *
 * A reducer over one Session's whole event log deriving everything the
 * timeline draws; graduated from the sessions-03 prototype:
 *
 * - per-Deck track spans (loads), playing spans (transport), audibility
 *   spans (via the SHARED audibility reducer, capture/audibilityReducer —
 *   the very reducer the detector runs, same params, so the bands are
 *   what the detector heard by construction), playhead traces (ticks +
 *   transport, broken at discontinuities — these also map session time to
 *   track time for waveform rendering)
 * - tenure holds (a machine held the Audible surface: honest gaps;
 *   audibility is masked beneath them — the shared surface was displaced)
 * - idle stretches (no audible deck, no tenure) → collapse candidates
 * - a piecewise time axis that collapses idle to fixed-width markers
 * - state reconstruction at an arbitrary T (the scrub readout; the replay
 *   planner builds on the same reducer, sessions 05)
 */
import type { CrossfaderAssignment } from '../playback/crossfaderAssignmentStore';
import {
  ALL_DECKS,
  applyEvent,
  cloneAudibilityState,
  deckGain,
  initialAudibilityState,
  maskedDeckAudible,
} from '../capture/audibilityReducer';
import type { AudibilityState } from '../capture/audibilityReducer';
import { DEFAULT_DETECTOR_PARAMS } from '../capture/events';
import type { CaptureDeck, CaptureEvent, DetectorParams } from '../capture/events';

export { ALL_DECKS };

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
 * `gain` to Master (0 while inaudible/tenure-masked). The area-chart fill.
 * Also reused for the raw per-control step series (`controlSteps`), where
 * `gain` holds the recorded control POSITION (0..1), not a gain. */
export interface GainStep {
  t: number;
  gain: number;
}

/** The channel-strip controls the waveform modulation reads (sessions 19).
 * Filter is excluded deliberately: a swept filter's audible effect isn't a
 * per-band gain, and its kills already gate audibility. */
export const DECK_CONTROL_IDS = ['fader', 'trim', 'eqLow', 'eqMid', 'eqHigh'] as const;
export type DeckControlId = (typeof DECK_CONTROL_IDS)[number];

/** Channel-strip defaults — same values `freshDeck` seeds the reducer with. */
export const DECK_CONTROL_DEFAULTS: Record<DeckControlId, number> = {
  fader: 1,
  trim: 0.5,
  eqLow: 0.5,
  eqMid: 0.5,
  eqHigh: 0.5,
};

/** Per-control step series (raw recorded positions, seeded with the
 * defaults at session start) — binary-searchable via `gainAt`. */
export type DeckControlSteps = Record<DeckControlId, GainStep[]>;

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
  /** Raw recorded control positions (waveform modulation, sessions 19) —
   * unlike gainSteps these are NOT audibility-masked: the waveform only
   * exists where traces do, and the modulation wants the mixer state the
   * deck was actually played through. */
  controlSteps: DeckControlSteps;
  /** Largest trace playhead (lane vertical scale) — precomputed here so
   * the render path never flattens every trace point per frame. */
  maxPlayhead: number;
}

export interface TimelineModel {
  start: number;
  end: number;
  decks: Record<CaptureDeck, DeckTimeline>;
  tenures: TenureSpan[];
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

// ── Reducer state ────────────────────────────────────────────────────────
//
// The event reducer over deck/mixer/tenure state is the SHARED audibility
// reducer (capture/audibilityReducer.ts) — the same one the Handover
// detector runs, so the bands drawn here are exactly what detection heard,
// under the same params. This module only layers derivation (spans,
// traces, gestures, the axis) on top.

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

/** Derive the whole timeline read model. `params` are the detector params
 * the Session was captured under — audibility bands must be computed with
 * the SAME thresholds detection ran with (today the recorder always
 * captures under DEFAULT_DETECTOR_PARAMS; if per-Session tuning ever
 * lands, the persisted params thread through here). */
export function deriveTimeline(
  events: CaptureEvent[],
  params: DetectorParams = DEFAULT_DETECTOR_PARAMS
): TimelineModel {
  const s = initialAudibilityState(params);
  const start = events.length > 0 ? events[0].t : 0;
  const end = events.length > 0 ? events[events.length - 1].t : 0;

  const perDeck = <T>(make: () => T): Record<CaptureDeck, T> =>
    Object.fromEntries(ALL_DECKS.map((d) => [d, make()])) as Record<CaptureDeck, T>;

  const audible = perDeck(() => new SpanBuilder());
  const playing = perDeck(() => new SpanBuilder());
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

  // Per-control step series, seeded with the channel-strip defaults at the
  // session start so a lookup at any in-session T always lands on a step.
  const controlSteps = perDeck<DeckControlSteps>(() => ({
    fader: [],
    trim: [],
    eqLow: [],
    eqMid: [],
    eqHigh: [],
  }));
  if (events.length > 0) {
    for (const ch of ALL_DECKS) {
      for (const id of DECK_CONTROL_IDS) {
        controlSteps[ch][id].push({ t: start, gain: DECK_CONTROL_DEFAULTS[id] });
      }
    }
  }

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

    // Per-control step series (waveform modulation): record moves of the
    // modulating controls, deduped against the last step.
    if (
      e.kind === 'control' &&
      e.channel &&
      (DECK_CONTROL_IDS as readonly string[]).includes(e.control)
    ) {
      const series = controlSteps[e.channel][e.control as DeckControlId];
      const lastStep = series[series.length - 1];
      if (!lastStep || lastStep.gain !== e.value) {
        series.push({ t: e.t, gain: e.value });
      }
    }

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

    // Boolean lanes, re-evaluated after every event. Audibility is the
    // shared reducer's tenure-masked read: a machine tenure displaces the
    // whole surface, so nothing is audible beneath it (the detector
    // suspends identically — one gate, audibilityReducer.ts).
    let audibleCount = 0;
    for (const ch of ALL_DECKS) {
      const a = maskedDeckAudible(s, ch);
      if (a) audibleCount += 1;
      audible[ch].set(a, e.t);
      playing[ch].set(s.decks[ch].playing, e.t);
      // Audible-gain step series (the area-chart fill): the deck's Master
      // contribution, zero while silent or tenure-masked.
      const gain = a ? deckGain(s, ch) : 0;
      if (gain !== lastGain[ch]) {
        gainSteps[ch].push({ t: e.t, gain });
        lastGain[ch] = gain;
      }
    }
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
  overlap.close(end);
  idle.close(end);
  if (openTenure !== null) {
    tenures.push({ start: openTenure.since, end, holder: openTenure.holder, open: true });
  }

  const decks = Object.fromEntries(
    ALL_DECKS.map((ch) => {
      let maxPlayhead = 1;
      for (const trace of traces[ch]) {
        for (const p of trace) {
          if (p.playhead > maxPlayhead) maxPlayhead = p.playhead;
        }
      }
      return [
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
          controlSteps: controlSteps[ch],
          maxPlayhead,
        },
      ];
    })
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

/** Reduce the log up to T. O(n) per call — fine for a one-shot lookup
 * (the replay planner); interactive scrubbing goes through
 * `createStateIndex`, which reduces only the tail past a checkpoint. */
export function stateAt(
  events: CaptureEvent[],
  t: number,
  params: DetectorParams = DEFAULT_DETECTOR_PARAMS
): StateAtT {
  const s = initialAudibilityState(params);
  let before = 0;
  for (const e of events) {
    if (e.t > t) break;
    applyEvent(s, e);
    before += 1;
  }
  return snapshotState(s, t, before, events.length);
}

/** Reader-facing snapshot of a reduced state (shared by `stateAt` and the
 * checkpoint index — one derivation, no divergence). */
function snapshotState(
  s: AudibilityState,
  t: number,
  before: number,
  total: number
): StateAtT {
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
          audible: maskedDeckAudible(s, ch),
          gain: deckGain(s, ch),
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
    eventsAfter: total - before,
  };
}

// ── Checkpointed state index (scrub at O(checkpoint interval)) ──────────

/** Checkpoint every this-many events: a 100k-event Session carries ~50
 * checkpoints and a scrub reduces at most 2048 events instead of the whole
 * log per mousemove. */
const CHECKPOINT_EVERY = 2048;

export interface StateIndex {
  /** `stateAt` semantics, from the nearest checkpoint. */
  at(t: number): StateAtT;
}

/** Build once per log (O(n)); each `at()` is a binary search plus at most
 * CHECKPOINT_EVERY event applications. Capture clocks are monotonic
 * (performance.now), which the upper-bound binary search relies on. */
export function createStateIndex(
  events: CaptureEvent[],
  checkpointEvery: number = CHECKPOINT_EVERY,
  params: DetectorParams = DEFAULT_DETECTOR_PARAMS
): StateIndex {
  // checkpoints[k] = reducer state after events[0 .. k*checkpointEvery).
  const checkpoints: AudibilityState[] = [initialAudibilityState(params)];
  {
    const s = initialAudibilityState(params);
    for (let i = 0; i < events.length; i++) {
      applyEvent(s, events[i]);
      if ((i + 1) % checkpointEvery === 0) checkpoints.push(cloneAudibilityState(s));
    }
  }

  return {
    at(t: number): StateAtT {
      // Upper bound: first index with events[idx].t > t.
      let lo = 0;
      let hi = events.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (events[mid].t <= t) lo = mid + 1;
        else hi = mid;
      }
      const before = lo;
      const ck = Math.min(checkpoints.length - 1, Math.floor(before / checkpointEvery));
      const s = cloneAudibilityState(checkpoints[ck]);
      for (let i = ck * checkpointEvery; i < before; i++) applyEvent(s, events[i]);
      return snapshotState(s, t, before, events.length);
    },
  };
}

// ── Viewport culling (the SVG scene renders only the visible window) ────

/** The slice of a (time-sorted) trace intersecting [t0, t1], padded one
 * sample either side so the polyline runs off both viewport edges instead
 * of visibly starting inside them. Returns the original array when it is
 * fully inside (no copy), null when fully outside. */
export function traceWindow(
  trace: PlayheadTrace,
  t0: number,
  t1: number
): PlayheadTrace | null {
  if (trace.length === 0) return null;
  if (trace[trace.length - 1].t < t0 || trace[0].t > t1) return null;
  if (trace[0].t >= t0 && trace[trace.length - 1].t <= t1) return trace;
  // Lower bound: last index with t < t0 (start one sample before the window).
  let lo = 0;
  let hi = trace.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (trace[mid].t < t0) lo = mid;
    else hi = mid - 1;
  }
  const from = lo;
  // Upper bound: first index with t > t1 (end one sample past the window).
  lo = 0;
  hi = trace.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (trace[mid].t <= t1) lo = mid + 1;
    else hi = mid;
  }
  const to = Math.min(trace.length - 1, lo);
  return trace.slice(from, to + 1);
}

// ── Piecewise time axis with idle collapse (pixel space) ────────────────

/** A stretch the axis may collapse to a fixed marker: silence (idle) or a
 * machine tenure (sessions 14 — a 4-hour replay hold stretches the axis
 * exactly like 4 hours of silence). The two never overlap: idle is defined
 * as no-audible-deck AND no-tenure. */
export interface CollapseCandidate extends Span {
  kind: 'idle' | 'tenure';
  /** The holding surface, for tenure markers ("‖ 34m replay held"). */
  holder?: string;
}

/** The axis's collapse-candidate list, sorted by start. Indices into THIS
 * list are the stable keys of the expanded set. */
export function collapseCandidates(model: TimelineModel): CollapseCandidate[] {
  return [
    ...model.idle.map((sp): CollapseCandidate => ({ start: sp.start, end: sp.end, kind: 'idle' })),
    ...model.tenures.map(
      (sp): CollapseCandidate => ({ start: sp.start, end: sp.end, kind: 'tenure', holder: sp.holder })
    ),
  ].sort((a, b) => a.start - b.start);
}

export interface AxisSegment extends Span {
  collapsed: boolean;
  /** Pixel extent within the total timeline width. */
  px0: number;
  px1: number;
  /** Collapsed segments: what kind of stretch this marker stands for and
   * its index into `collapseCandidates(model)` (the expand toggle key). */
  kind?: 'idle' | 'tenure';
  holder?: string;
  candidateIdx?: number;
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
    ? collapseCandidates(model)
        .map((sp, i) => ({ sp, i }))
        .filter(
          ({ sp, i }) => sp.end - sp.start >= opts.thresholdS && !(opts.expanded?.has(i) ?? false)
        )
    : [];

  // Alternating segments over [start, end].
  const segments: AxisSegment[] = [];
  let cursor = start;
  for (const { sp, i } of collapsible) {
    if (sp.start < cursor) continue; // defensive: candidates never overlap
    if (sp.start > cursor) {
      segments.push({ start: cursor, end: sp.start, collapsed: false, px0: 0, px1: 0 });
    }
    segments.push({
      start: sp.start,
      end: sp.end,
      collapsed: true,
      px0: 0,
      px1: 0,
      kind: sp.kind,
      holder: sp.holder,
      candidateIdx: i,
    });
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

// ── Take → deck resolution (chip coloring) ───────────────────────────────

/** A Take side resolved against the log: the deck and the track span
 * (tenure) that carried it. */
export interface TakeSpanRef {
  deck: CaptureDeck;
  start: number;
  end: number;
}

interface TakeWindow {
  a_track_id: number;
  b_track_id: number;
  window_start_s: number;
  window_end_s: number;
}

/** The track spans a Take's outgoing (a) and incoming (b) Tracks occupied
 * during its window — chip coloring + hover spotlight (sessions 22). A
 * Track is matched by its tenure overlapping the window; when the same
 * Track sits loaded on multiple decks (one copy silent), the AUDIBLE
 * copy wins — the deck the Take's events actually rode, not whichever
 * deck happens first in A–D order (gh#184). Null when the log doesn't
 * show it (e.g. a manual Take against a truncated log). */
export function takeSpanPair(
  model: TimelineModel,
  take: TakeWindow
): { from: TakeSpanRef | null; to: TakeSpanRef | null } {
  const find = (trackId: number): TakeSpanRef | null => {
    let best: TakeSpanRef | null = null;
    let bestAudible = -1;
    for (const ch of ALL_DECKS) {
      for (const span of model.decks[ch].trackSpans) {
        if (
          span.trackId === trackId &&
          span.start < take.window_end_s &&
          span.end > take.window_start_s
        ) {
          // Audible seconds this copy contributed inside the window ∩ span:
          // the copy that actually sounded through the transition wins.
          const w0 = Math.max(span.start, take.window_start_s);
          const w1 = Math.min(span.end, take.window_end_s);
          let audible = 0;
          for (const a of model.decks[ch].audibleSpans) {
            audible += Math.max(0, Math.min(a.end, w1) - Math.max(a.start, w0));
          }
          if (audible > bestAudible) {
            bestAudible = audible;
            best = { deck: ch, start: span.start, end: span.end };
          }
        }
      }
    }
    return best;
  };
  return { from: find(take.a_track_id), to: find(take.b_track_id) };
}

/** Deck-only view of `takeSpanPair` (the chip gradient's endpoints). */
export function takeDeckPair(
  model: TimelineModel,
  take: TakeWindow
): { from: CaptureDeck | null; to: CaptureDeck | null } {
  const pair = takeSpanPair(model, take);
  return { from: pair.from?.deck ?? null, to: pair.to?.deck ?? null };
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
